package com.bliss.b2b;

import com.bliss.b2b.api.AuthResource;
import com.bliss.b2b.api.BookingsResource;
import com.bliss.b2b.api.HelloResource;
import com.bliss.b2b.api.MerchantsResource;
import com.bliss.b2b.api.StripeConnectResource;
import com.bliss.b2b.auth.JwtCookieAuthFilter;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MerchantAuthenticator;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailServiceFactory;
import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.observability.SentryBootstrap;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.JdbiBootstrap;
import com.bliss.b2b.persistence.MagicLinkTokenDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.service.BookingService;
import com.bliss.b2b.service.MagicLinkService;
import com.fasterxml.jackson.databind.SerializationFeature;
import io.dropwizard.auth.AuthDynamicFeature;
import io.dropwizard.auth.AuthValueFactoryProvider;
import io.dropwizard.configuration.EnvironmentVariableSubstitutor;
import io.dropwizard.configuration.SubstitutingSourceProvider;
import io.dropwizard.core.Application;
import io.dropwizard.core.setup.Bootstrap;
import io.dropwizard.core.setup.Environment;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.FilterRegistration;
import java.time.Clock;
import java.time.Duration;
import java.util.EnumSet;
import org.eclipse.jetty.servlets.CrossOriginFilter;
import org.flywaydb.core.Flyway;
import org.glassfish.jersey.server.filter.RolesAllowedDynamicFeature;
import org.jdbi.v3.core.Jdbi;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class BlissApplication extends Application<BlissConfiguration> {

    private static final Logger log = LoggerFactory.getLogger(BlissApplication.class);

    public static void main(String[] args) throws Exception {
        new BlissApplication().run(args);
    }

    @Override
    public String getName() {
        return "bliss-b2b";
    }

    @Override
    public void initialize(Bootstrap<BlissConfiguration> bootstrap) {
        bootstrap.setConfigurationSourceProvider(new SubstitutingSourceProvider(
                bootstrap.getConfigurationSourceProvider(),
                new EnvironmentVariableSubstitutor(false)
        ));
    }

    @Override
    public void run(BlissConfiguration config, Environment environment) {
        SentryBootstrap.init(config.getSentry());
        runMigrationsIfEnabled(config);
        registerCors(config, environment);

        // Emit Instants and LocalDates as ISO 8601 strings, not Jackson's
        // default array/numeric timestamp form. The frontend treats both as
        // strings and the data-model.md schema is ISO-shaped.
        environment.getObjectMapper().disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        Jdbi jdbi = JdbiBootstrap.build(config.getDatabase(), environment);
        MerchantDao merchantDao = jdbi.onDemand(MerchantDao.class);
        MagicLinkTokenDao tokenDao = jdbi.onDemand(MagicLinkTokenDao.class);
        BookingDao bookingDao = jdbi.onDemand(BookingDao.class);

        // Dev environments use long expiries to keep the inner loop frictionless:
        // a magic link survives an overnight pause and the session cookie keeps
        // you signed in for a month. Production uses the config defaults
        // (15-minute link, 1-hour session) so a leaked cookie has a short blast
        // radius. CLAUDE.md security defaults trump dev ergonomics in prod.
        Duration magicLinkTtl;
        int sessionTtlMinutes;
        if (config.isProduction()) {
            magicLinkTtl = Duration.ofMinutes(15);
            sessionTtlMinutes = config.getJwt().getTtlMinutes();
        } else {
            magicLinkTtl = Duration.ofHours(24);
            sessionTtlMinutes = 30 * 24 * 60;
        }
        Duration sessionTtl = Duration.ofMinutes(sessionTtlMinutes);

        EmailService emailService = EmailServiceFactory.build(config.getEmail());
        MagicLinkService magicLinkService = new MagicLinkService(
                merchantDao, tokenDao, emailService, config.getApp(), magicLinkTtl);
        StripeConnectService stripeService = new StripeConnectService(config.getStripe());
        BookingService bookingService = new BookingService(bookingDao);
        PlanEligibilityService eligibilityService = new PlanEligibilityService();
        Clock clock = Clock.systemUTC();

        JwtService jwtService = new JwtService(config.getJwt(), sessionTtl);

        log.info("Auth expiries: magic-link={} session={}min ({})",
                magicLinkTtl, sessionTtlMinutes,
                config.isProduction() ? "production" : "development");

        environment.jersey().register(new HelloResource());
        // Dev-login bypass is on whenever the env is not production. It
        // accepts any email at POST /api/v1/auth/dev-login and returns a
        // signed session immediately. Production deploys must set
        // BLISS_ENV=production.
        boolean devLoginEnabled = !config.isProduction();
        environment.jersey().register(new AuthResource(
                magicLinkService, jwtService, config.isProduction(),
                devLoginEnabled, sessionTtlMinutes));
        environment.jersey().register(new MerchantsResource(merchantDao, stripeService, emailService));
        environment.jersey().register(new StripeConnectResource(
                stripeService, merchantDao, emailService, config.getApp()));
        environment.jersey().register(new BookingsResource(
                bookingService, eligibilityService, stripeService, config.getApp(), clock));

        environment.jersey().register(new AuthDynamicFeature(
                new JwtCookieAuthFilter.Builder()
                        .setAuthenticator(new MerchantAuthenticator(jwtService, merchantDao))
                        .setPrefix("Bearer")
                        .setRealm("bliss-b2b")
                        .buildAuthFilter()));
        environment.jersey().register(RolesAllowedDynamicFeature.class);
        environment.jersey().register(new AuthValueFactoryProvider.Binder<>(MerchantPrincipal.class));

        log.info("Bliss B2B backend started env={}", config.getEnv());
    }

    private void registerCors(BlissConfiguration config, Environment environment) {
        String origins = config.getCors().getAllowedOrigins();
        FilterRegistration.Dynamic cors = environment.servlets().addFilter("CORS", CrossOriginFilter.class);
        cors.setInitParameter(CrossOriginFilter.ALLOWED_ORIGINS_PARAM, origins);
        cors.setInitParameter(CrossOriginFilter.ALLOWED_METHODS_PARAM, "GET,POST,PUT,PATCH,DELETE,OPTIONS");
        cors.setInitParameter(CrossOriginFilter.ALLOWED_HEADERS_PARAM, "Authorization,Content-Type,Accept,Origin");
        cors.setInitParameter(CrossOriginFilter.ALLOW_CREDENTIALS_PARAM, "true");
        cors.addMappingForUrlPatterns(EnumSet.allOf(DispatcherType.class), true, "/*");
        log.info("CORS enabled for origins: {}", origins);
    }

    private void runMigrationsIfEnabled(BlissConfiguration config) {
        BlissConfiguration.DatabaseConfig db = config.getDatabase();
        if (!db.isRunMigrations()) {
            log.info("Database migrations disabled by config; skipping Flyway");
            return;
        }
        log.info("Running Flyway migrations against {}", db.getUrl());
        Flyway flyway = Flyway.configure()
                .dataSource(db.getUrl(), db.getUser(), db.getPassword())
                .locations("classpath:db/migration")
                .load();
        flyway.migrate();
    }
}
