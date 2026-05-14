package com.bliss.b2b.observability;

import com.bliss.b2b.BlissConfiguration.SentryConfig;
import io.sentry.Sentry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class SentryBootstrap {

    private static final Logger log = LoggerFactory.getLogger(SentryBootstrap.class);

    private SentryBootstrap() {}

    public static void init(SentryConfig config) {
        if (config == null || config.getDsn() == null || config.getDsn().isBlank()) {
            log.info("Sentry DSN not configured; error reporting disabled");
            return;
        }
        Sentry.init(options -> {
            options.setDsn(config.getDsn());
            options.setEnvironment(config.getEnvironment());
            options.setRelease(config.getRelease());
            options.setTracesSampleRate(config.getTracesSampleRate());
        });
        log.info("Sentry initialized env={} tracesSampleRate={}",
                config.getEnvironment(), config.getTracesSampleRate());
    }
}
