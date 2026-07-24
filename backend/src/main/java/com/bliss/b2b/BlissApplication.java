package com.bliss.b2b;

import com.bliss.b2b.api.AuthResource;
import com.bliss.b2b.api.BookingsResource;
import com.bliss.b2b.api.DemoResetResource;
import com.bliss.b2b.api.DevPlansResource;
import com.bliss.b2b.api.HelloResource;
import com.bliss.b2b.api.MerchantsResource;
import com.bliss.b2b.api.MewsController;
import com.bliss.b2b.api.PlanRulesResource;
import com.bliss.b2b.api.PropertyOnboardingResource;
import com.bliss.b2b.api.PlansResource;
import com.bliss.b2b.api.PublicBookingsResource;
import com.bliss.b2b.api.PublicAccountResource;
import com.bliss.b2b.api.PublicCheckoutResource;
import com.bliss.b2b.api.PublicMerchantsResource;
import com.bliss.b2b.api.PublicPlansPortalResource;
import com.bliss.b2b.api.PublicPlansResource;
import com.bliss.b2b.api.StripeConnectResource;
import com.bliss.b2b.api.StripeStandardConnectResource;
import com.bliss.b2b.auth.CookieOptions;
import com.bliss.b2b.auth.JwtCookieAuthFilter;
import com.bliss.b2b.auth.JwtService;
import com.bliss.b2b.auth.MerchantAuthenticator;
import com.bliss.b2b.auth.MerchantPrincipal;
import com.bliss.b2b.cli.SeedDemoCommand;
import com.bliss.b2b.integration.EmailService;
import com.bliss.b2b.integration.EmailServiceFactory;
import com.bliss.b2b.integration.MewsApiClient;
import com.bliss.b2b.integration.MewsConfig;
import com.bliss.b2b.integration.StripeConnectResolver;
import com.bliss.b2b.integration.StripeConnectService;
import com.bliss.b2b.integration.StripeConnectStandardService;
import com.bliss.b2b.integration.StripePaymentsService;
import com.bliss.b2b.observability.SentryBootstrap;
import com.bliss.b2b.payments.PlanEligibilityService;
import com.bliss.b2b.persistence.BookingDao;
import com.bliss.b2b.persistence.DatabaseUrlResolver;
import com.bliss.b2b.persistence.JdbiBootstrap;
import com.bliss.b2b.persistence.MagicLinkTokenDao;
import com.bliss.b2b.persistence.MerchantDao;
import com.bliss.b2b.persistence.MerchantPlanRulesDao;
import com.bliss.b2b.persistence.PaymentPlanDao;
import com.bliss.b2b.persistence.PaymentScheduleDao;
import com.bliss.b2b.service.BookingService;
import com.bliss.b2b.service.CancellationService;
import com.bliss.b2b.service.MagicLinkService;
import com.bliss.b2b.service.MewsSyncService;
import com.bliss.b2b.service.MerchantPlanRulesService;
import com.bliss.b2b.service.DemoResetService;
import com.bliss.b2b.service.PropertyOnboardingService;
import com.bliss.b2b.service.CustomerAuthService;
import com.bliss.b2b.service.PlanCreationService;
import com.bliss.b2b.service.PlanPortalService;
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

    /** Must stay in sync with the jwt.secret default in config.yml. */
    private static final String DEV_JWT_SECRET = "dev-secret-change-me-dev-secret-change-me";

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
        // Run explicitly via `java -jar <jar> seed-demo <config.yml>`; never on boot.
        bootstrap.addCommand(new SeedDemoCommand());
    }

    @Override
    public void run(BlissConfiguration config, Environment environment) {
        // Before anything reads the database or issues a token: fail fast on a
        // production deploy that is still carrying the dev signing key, and let
        // a platform-supplied DATABASE_URL replace the local-dev credentials.
        requireProductionJwtSecret(config);
        DatabaseUrlResolver.applyFromEnvironment(config.getDatabase());

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
        MerchantPlanRulesDao planRulesDao = jdbi.onDemand(MerchantPlanRulesDao.class);
        PaymentPlanDao paymentPlanDao = jdbi.onDemand(PaymentPlanDao.class);
        PaymentScheduleDao paymentScheduleDao = jdbi.onDemand(PaymentScheduleDao.class);

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
                merchantDao, tokenDao, emailService, config.getApp(), magicLinkTtl,
                config.isDemoLogin());
        StripeConnectService stripeService = new StripeConnectService(config.getStripe());
        // Demo charge cap threaded into both rails' execution points only.
        long chargeCapCents = config.getChargeCapCents();
        StripePaymentsService stripePaymentsService =
                new StripePaymentsService(config.getStripe(), chargeCapCents);
        // Per-property Stripe Connect Standard: onboarding service, connection
        // store, and the resolver that threads each property's connected account
        // into charges as a direct charge (empty -> platform key, current path).
        StripeConnectStandardService stripeConnectStandardService =
                new StripeConnectStandardService(config.getStripe());
        com.bliss.b2b.persistence.MerchantStripeConnectionDao stripeConnectionDao =
                jdbi.onDemand(com.bliss.b2b.persistence.MerchantStripeConnectionDao.class);
        StripeConnectResolver stripeConnectResolver = new StripeConnectResolver(jdbi);
        MewsApiClient mewsApiClient = new MewsApiClient(MewsConfig.load());
        BookingService bookingService = new BookingService(bookingDao);
        PlanEligibilityService eligibilityService = new PlanEligibilityService();
        MerchantPlanRulesService planRulesService = new MerchantPlanRulesService(planRulesDao);
        Clock clock = Clock.systemUTC();
        // Guest transactional emails at plan lifecycle transitions. Idempotent
        // (email_log) and fire-and-forget; a blank Postmark token makes emailService
        // the logging no-op, so every environment keeps working.
        com.bliss.b2b.service.PlanNotificationService planNotificationService =
                new com.bliss.b2b.service.PlanNotificationService(
                        jdbi, emailService, config.getApp().getConsumerBaseUrl());
        PlanCreationService planCreationService = new PlanCreationService(
                jdbi, eligibilityService, stripePaymentsService, stripeConnectResolver,
                emailService, planNotificationService, clock, config.getApp());
        MewsSyncService mewsSyncService = new MewsSyncService(
                mewsApiClient, jdbi, eligibilityService, planCreationService, clock);
        CancellationService cancellationService = new CancellationService(
                paymentPlanDao, paymentScheduleDao, bookingDao, planRulesService);
        PlanPortalService planPortalService = new PlanPortalService(
                jdbi, stripePaymentsService, stripeConnectResolver, cancellationService, clock);
        // Property onboarding + per-property Mews connection. The factory both
        // validates connections and resolves each property's charge credentials.
        com.bliss.b2b.persistence.MerchantMewsConnectionDao mewsConnectionDao =
                jdbi.onDemand(com.bliss.b2b.persistence.MerchantMewsConnectionDao.class);
        com.bliss.b2b.integration.pms.MewsAdapterFactory mewsAdapterFactory =
                new com.bliss.b2b.integration.pms.MewsAdapterFactory(jdbi, chargeCapCents);
        // Per-property Cloudbeds OAuth: connection store, OAuth client, and the
        // factory that resolves each property's tokens (transparent single-flight
        // refresh) and is the charge pass's Cloudbeds resolver.
        com.bliss.b2b.persistence.MerchantCloudbedsConnectionDao cloudbedsConnectionDao =
                jdbi.onDemand(com.bliss.b2b.persistence.MerchantCloudbedsConnectionDao.class);
        com.bliss.b2b.integration.cloudbeds.CloudbedsOAuthClient cloudbedsOAuthClient =
                new com.bliss.b2b.integration.cloudbeds.CloudbedsOAuthClient(config.getPms().getCloudbeds());
        com.bliss.b2b.integration.pms.CloudbedsAdapterFactory cloudbedsAdapterFactory =
                new com.bliss.b2b.integration.pms.CloudbedsAdapterFactory(
                        jdbi, cloudbedsOAuthClient, config.getPms().getCloudbeds(), chargeCapCents, clock);
        PropertyOnboardingService onboardingService = new PropertyOnboardingService(
                merchantDao, mewsConnectionDao, stripeConnectionDao, cloudbedsConnectionDao,
                mewsAdapterFactory, clock);
        // Mews guest card-capture seam (per-property credentials via the factory).
        com.bliss.b2b.service.MewsCheckoutService mewsCheckoutService =
                new com.bliss.b2b.service.MewsCheckoutService(
                        jdbi, mewsAdapterFactory, planNotificationService, clock);
        com.bliss.b2b.persistence.CustomerDao customerDao =
                jdbi.onDemand(com.bliss.b2b.persistence.CustomerDao.class);

        JwtService jwtService = new JwtService(config.getJwt(), sessionTtl);
        CustomerAuthService customerAuthService = new CustomerAuthService(
                customerDao, jwtService, clock);

        log.info("Auth expiries: magic-link={} session={}min ({})",
                magicLinkTtl, sessionTtlMinutes,
                config.isProduction() ? "production" : "development");

        environment.jersey().register(new HelloResource());
        environment.jersey().register(new MewsController(mewsSyncService, mewsApiClient));
        // Two separate gates, deliberately not one flag.
        //
        // Demo sign-in (POST /api/v1/auth/dev-login) accepts any email and
        // returns a signed session with no password. It is on outside
        // production, and BLISS_DEMO_LOGIN keeps it on in production for the
        // hosted demo — which is also what keeps the Marbrook funnel and the
        // Mews authorize simulation working, since both call it.
        boolean demoLoginEnabled = !config.isProduction() || config.isDemoLogin();
        // Everything else dev-only stays keyed to the environment alone.
        // DevPlansResource fabricates card declines and rewrites plan state, so
        // BLISS_DEMO_LOGIN must not reopen it: a demo needs a way to sign in,
        // not a way to forge payment failures.
        boolean devEndpointsEnabled = !config.isProduction();
        if (config.isProduction() && config.isDemoLogin()) {
            log.warn("BLISS_DEMO_LOGIN=true in production: POST /api/v1/auth/dev-login will issue a "
                    + "merchant session for any email, with no password. Intended for the hosted demo. "
                    + "Set BLISS_DEMO_LOGIN=false to make magic-link sign-in the only way in.");
        }
        // One CookieOptions for both session cookies (merchant and customer) so
        // their scope cannot drift apart. Secure tracks production; SameSite and
        // Domain come from config because they depend on whether the frontend
        // shares an origin with the API.
        CookieOptions cookieOptions = new CookieOptions(
                config.isProduction(),
                config.getCookies().getSameSite(),
                config.getCookies().getDomain());
        log.info("Session cookies: secure={} sameSite={} domain={}",
                cookieOptions.secure(), cookieOptions.sameSite(),
                cookieOptions.domain() == null ? "(host-only)" : cookieOptions.domain());
        environment.jersey().register(new AuthResource(
                magicLinkService, jwtService, cookieOptions,
                demoLoginEnabled, sessionTtlMinutes));
        environment.jersey().register(new MerchantsResource(merchantDao, stripeService, emailService));
        environment.jersey().register(new StripeConnectResource(
                stripeService, merchantDao, emailService, config.getApp(),
                stripeConnectionDao, onboardingService, clock));
        environment.jersey().register(new StripeStandardConnectResource(
                stripeConnectStandardService, stripeConnectionDao, onboardingService,
                config.getApp(), clock));
        // Booking modification + plan recalculation (rail-agnostic; schedule-level).
        com.bliss.b2b.service.BookingModificationService bookingModificationService =
                new com.bliss.b2b.service.BookingModificationService(jdbi, eligibilityService, clock);
        environment.jersey().register(new BookingsResource(
                bookingService, eligibilityService, planRulesService, stripeService,
                paymentPlanDao, bookingModificationService, config.getApp(), clock));
        environment.jersey().register(new PublicBookingsResource(
                bookingDao, merchantDao, eligibilityService, planRulesService,
                stripePaymentsService, stripeConnectResolver, clock));
        environment.jersey().register(new PublicPlansResource(planCreationService));
        environment.jersey().register(new PublicMerchantsResource(
                merchantDao, planRulesService, stripePaymentsService, stripeConnectResolver));
        environment.jersey().register(new PublicCheckoutResource(planCreationService));
        environment.jersey().register(new PublicPlansPortalResource(
                planPortalService, stripePaymentsService, stripeConnectResolver, mewsCheckoutService));
        environment.jersey().register(new PublicAccountResource(
                customerAuthService, paymentPlanDao, customerDao, clock, cookieOptions));
        environment.jersey().register(new PlanRulesResource(planRulesService, onboardingService));
        environment.jersey().register(new PropertyOnboardingResource(onboardingService));
        environment.jersey().register(new com.bliss.b2b.api.CloudbedsOAuthResource(
                cloudbedsOAuthClient, cloudbedsAdapterFactory, cloudbedsConnectionDao,
                onboardingService, config.getApp(), clock));
        environment.jersey().register(new PlansResource(
                paymentPlanDao, paymentScheduleDao, bookingDao, cancellationService));
        environment.jersey().register(new DevPlansResource(
                devEndpointsEnabled, paymentPlanDao, paymentScheduleDao, planRulesDao,
                bookingDao, cancellationService));

        // Demo reset kill switch, gated strictly on the demo flag (BLISS_DEMO_LOGIN):
        // 404 in every environment when off, so it cannot run outside demo mode.
        DemoResetService demoResetService = new DemoResetService(jdbi);
        environment.jersey().register(new DemoResetResource(config.isDemoLogin(), demoResetService));

        // Scheduled installment charge pass. Charges Mews-rail installments that
        // come due; Stripe rows are skipped and PROCESSING (in-flight) rows are
        // excluded, exactly as InstallmentChargeService already guards. The
        // MewsAdapterFactory resolves each property's own credentials. The
        // executor is lifecycle-managed (stops on shutdown).
        // One shared Ledger backs both Mews passes so the reconciliation pass
        // settles rows through exactly the charge pass's persistence + completion
        // machinery (markPaid / completePlanIfDone / markFailed), not a parallel one.
        com.bliss.b2b.service.InstallmentChargeService.JdbiLedger installmentLedger =
                new com.bliss.b2b.service.InstallmentChargeService.JdbiLedger(jdbi);
        // Stripe-rail installments auto-charge on the same timer, off-session,
        // through the existing firePaymentOffSession + recordAttempt path (on the
        // merchant's connected account when the resolver finds one, platform/demo
        // otherwise).
        com.bliss.b2b.service.JdbiStripeInstallmentCharger stripeInstallmentCharger =
                new com.bliss.b2b.service.JdbiStripeInstallmentCharger(
                        jdbi, stripePaymentsService, stripeConnectResolver, clock);
        com.bliss.b2b.service.InstallmentChargeService installmentChargeService =
                new com.bliss.b2b.service.InstallmentChargeService(
                        installmentLedger, mewsAdapterFactory, stripeInstallmentCharger,
                        cloudbedsAdapterFactory, planNotificationService, clock);
        // Reconciliation pass: settles installments left in PROCESSING once their
        // Mews payment resolves (payments/getAll, per-property credentials).
        com.bliss.b2b.service.MewsReconciliationService mewsReconciliationService =
                new com.bliss.b2b.service.MewsReconciliationService(
                        jdbi, mewsAdapterFactory, installmentLedger, planNotificationService, clock);
        // Both Mews passes share one single-thread executor, so they never run
        // concurrently; the initial delays offset them (charge at +60s, reconcile
        // at +90s) so they also never fire in the same instant.
        java.util.concurrent.ScheduledExecutorService chargeScheduler =
                environment.lifecycle().scheduledExecutorService("mews-charge-pass").threads(1).build();
        chargeScheduler.scheduleAtFixedRate(() -> {
            try {
                installmentChargeService.runDuePass(java.time.LocalDate.now(clock));
            } catch (RuntimeException e) {
                log.warn("Installment charge pass failed: {}", e.getMessage());
            }
        }, 60, 60, java.util.concurrent.TimeUnit.SECONDS);
        chargeScheduler.scheduleAtFixedRate(() -> {
            try {
                mewsReconciliationService.runReconcilePass();
            } catch (RuntimeException e) {
                log.warn("Mews reconciliation pass failed: {}", e.getMessage());
            }
        }, 90, 60, java.util.concurrent.TimeUnit.SECONDS);

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

    /**
     * Refuses to boot a production deploy still using the dev JWT secret. The
     * secret is env-overridable but nothing forced the override, so a forgotten
     * BLISS_JWT_SECRET would come up healthy while every session cookie it
     * issued was forgeable by anyone who has read config.yml.
     */
    private void requireProductionJwtSecret(BlissConfiguration config) {
        if (config.isProduction() && DEV_JWT_SECRET.equals(config.getJwt().getSecret())) {
            throw new IllegalStateException(
                    "BLISS_ENV=production but the JWT secret is still the development default from "
                            + "config.yml. Anyone who has seen the repo could forge a session. Set "
                            + "BLISS_JWT_SECRET to a unique random value of at least 32 characters "
                            + "(e.g. `openssl rand -base64 48`) and redeploy.");
        }
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
