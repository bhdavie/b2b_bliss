package com.bliss.b2b.integration.pms;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Runnable smoke test for {@link MewsAdapter} against the public Mews demo
 * environment. Exercises every interface method and prints the results so the
 * adapter can be verified without wiring it into the app or the scheduler.
 *
 * <p>Deliberately a {@code main} rather than a JUnit test: it makes live
 * network calls to api.mews-demo.com, and a network-dependent test would fail
 * offline and in CI. Run with (the pom pins {@code mainClass} to
 * {@code ${main.class}}, so override that property):
 *
 * <pre>
 *   mvn -o compile \
 *     org.codehaus.mojo:exec-maven-plugin:3.5.0:java \
 *     -Dmain.class=com.bliss.b2b.integration.pms.MewsAdapterDemo
 * </pre>
 *
 * With no config file it uses the demo credentials baked into
 * {@link MewsPmsConfig} defaults (the Gross pricing UK demo property).
 *
 * <p>Steps 1-3 read config, customer, and stored cards. Step 4 creates a card
 * collection request and writes a throwaway browser page (in the JVM temp dir,
 * outside the repo) that loads Mews Payments Checkout for that request. Step 5
 * charges the first vaulted card if one exists; otherwise it prints how to
 * complete card entry in a browser and rerun.
 */
public final class MewsAdapterDemo {

    /** Charge amount for the demo, in integer minor units (1.00 in the property currency). */
    private static final long DEMO_AMOUNT_MINOR_UNITS = 100;

    private MewsAdapterDemo() {
    }

    public static void main(String[] args) {
        // Defaults on MewsPmsConfig are the public Mews demo credentials.
        MewsPmsConfig config = new MewsPmsConfig();
        MewsAdapter adapter = new MewsAdapter(config);

        System.out.println("== Mews PMS adapter demo ==");
        System.out.println("platformUrl = " + config.getPlatformUrl());
        System.out.println();

        System.out.println("[1] getPropertyConfiguration()");
        PmsPropertyConfiguration cfg = adapter.getPropertyConfiguration();
        System.out.println("    enterpriseId = " + cfg.enterpriseId());
        System.out.println("    name         = " + cfg.name());
        System.out.println("    currency     = " + cfg.defaultCurrency());
        System.out.println("    country      = " + cfg.countryCode());
        System.out.println("    pricing      = " + cfg.pricing());
        System.out.println("    timeZone     = " + cfg.timeZoneIdentifier());
        System.out.println();

        System.out.println("[2] findOrCreateCustomer(search-first)");
        PmsCustomerRef ref = new PmsCustomerRef(
                "bliss.pms.demo@example.com", "Bliss", "Demo");
        PmsCustomer customer = adapter.findOrCreateCustomer(ref);
        System.out.println("    id        = " + customer.id());
        System.out.println("    firstName = " + customer.firstName());
        System.out.println("    lastName  = " + customer.lastName());
        System.out.println("    email     = " + customer.email());
        System.out.println();

        System.out.println("[3] getStoredCards(customerId)");
        List<PmsStoredCard> cards = adapter.getStoredCards(customer.id());
        System.out.println("    " + cards.size() + " card(s)");
        for (PmsStoredCard card : cards) {
            System.out.printf(
                    "    - %s  %s  %s  exp=%s-%s  active=%s%n",
                    card.id(),
                    card.obfuscatedNumber(),
                    card.kind(),
                    card.expiryYear(),
                    card.expiryMonth(),
                    card.active());
        }
        System.out.println();

        System.out.println("[4] createCardCollectionRequest(customerId)");
        Instant expiration = Instant.now().plus(Duration.ofDays(7));
        PmsCardCollectionRequest request = adapter.createCardCollectionRequest(
                customer.id(), expiration, "Save a card for your Bliss plan");
        System.out.println("    requestId   = " + request.requestId());
        System.out.println("    expires     = " + request.expiration());
        // Payments Checkout must resolve the request against the SAME Mews
        // environment that minted it. The api host maps to the app host
        // (api.mews-demo.com -> app.mews-demo.com); without this the widget
        // hits production and rejects the card as invalid.
        String dataBaseUrl = checkoutBaseUrl(config.getPlatformUrl());
        Path helperPage = writeCheckoutHelper(request.requestId(), dataBaseUrl);
        System.out.println("    dataBaseUrl = " + dataBaseUrl);
        System.out.println("    helperPage  = " + helperPage);
        printServeInstructions(helperPage);
        System.out.println();

        String currency = cfg.defaultCurrency() == null ? "GBP" : cfg.defaultCurrency();

        System.out.println("[5] chargeStoredCard(firstCard)");
        if (cards.isEmpty()) {
            System.out.println("    no vaulted card yet - nothing to charge.");
            System.out.println();
            System.out.println("    To finish the flow:");
            System.out.println("      1. Serve the helper page and open it over http");
            System.out.println("         (file:// hangs the checkout embed) - see the");
            System.out.println("         serve command printed in step [4] above.");
            System.out.println("      2. Enter a Mews demo test card and submit it.");
            System.out.println("      3. Rerun this demo. Step [3] will list the vaulted");
            System.out.println("         card and step [5] will charge it.");
            System.out.println();
            System.out.println("== done (awaiting card entry) ==");
            return;
        }

        PmsStoredCard target = cards.get(0);
        System.out.println("    charging card " + target.id()
                + " for " + DEMO_AMOUNT_MINOR_UNITS + " minor units " + currency);
        try {
            PmsChargeResult result = adapter.chargeStoredCard(
                    customer.id(), target.id(), DEMO_AMOUNT_MINOR_UNITS, currency,
                    null, "Bliss demo charge");
            System.out.println("    paymentId = " + result.paymentId());
            System.out.println("    status    = " + result.status()
                    + " (rawState=" + result.rawState() + ")");
            System.out.println("    amount    = " + result.amountMinorUnits()
                    + " minor units " + result.currency());
            System.out.println("    succeeded = " + result.status().succeeded());
            if (result.status().declined()) {
                System.out.println("    NOTE: declined at the payment level; "
                        + "returned as a status, not thrown.");
            }
        } catch (PmsAdapterException e) {
            // Protocol/transport error (per the adapter's contract these throw,
            // unlike a payment-level decline). Print it rather than dumping a
            // stack trace so the demo still exits cleanly.
            System.out.println("    adapter error (not a payment decline): " + e.getMessage());
        }
        System.out.println();
        System.out.println("== done ==");
    }

    /**
     * Writes a throwaway page that loads Mews Payments Checkout for the given
     * request id, into a dedicated subdirectory of the JVM temp dir (outside the
     * repo). {@code dataBaseUrl} pins the checkout to the right Mews
     * environment. Returns the file path.
     */
    private static Path writeCheckoutHelper(String requestId, String dataBaseUrl) {
        String html = CHECKOUT_HTML
                .replace("__REQUEST_ID__", requestId)
                .replace("__DATA_BASE_URL__", dataBaseUrl);
        try {
            Path dir = Path.of(System.getProperty("java.io.tmpdir"), "bliss-mews-checkout");
            Files.createDirectories(dir);
            Path file = dir.resolve("mews-card-checkout-" + requestId + ".html");
            Files.writeString(file, html);
            return file;
        } catch (IOException e) {
            throw new PmsAdapterException("Could not write checkout helper page: " + e.getMessage(), e);
        }
    }

    /**
     * Derives the Payments Checkout {@code dataBaseUrl} (the app host) from the
     * connector platform url (the api host), e.g.
     * {@code https://api.mews-demo.com -> https://app.mews-demo.com}.
     */
    private static String checkoutBaseUrl(String platformUrl) {
        if (platformUrl == null || platformUrl.isBlank()) {
            return "https://app.mews-demo.com";
        }
        return platformUrl.replace("://api.", "://app.");
    }

    /**
     * Prints how to serve the helper page over http. The checkout embed hangs
     * when loaded from a {@code file://} url, so it must come from a real http
     * origin; a throwaway static server over the temp subdir is enough.
     */
    private static void printServeInstructions(Path helperPage) {
        Path dir = helperPage.getParent();
        String fileName = helperPage.getFileName().toString();
        System.out.println("    serve with  = python3 -m http.server 8000 --directory " + dir);
        System.out.println("    then open   = http://localhost:8000/" + fileName);
    }

    private static final String CHECKOUT_HTML = """
            <!doctype html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <title>Mews card entry (Bliss demo)</title>
              <style>
                body { font-family: sans-serif; max-width: 480px; margin: 40px auto; padding: 0 16px; }
                #status { margin-top: 16px; color: #534AB7; }
              </style>
            </head>
            <body>
              <h1>Save a card</h1>
              <p>Payment method request: <code>__REQUEST_ID__</code></p>
              <div id="payment-checkout-container"></div>
              <p id="status"></p>
              <script src="https://cdn.mews.com/payments/checkout-embed.js"></script>
              <script>
                window.Mews.PaymentCheckout.load({
                  containerId: 'payment-checkout-container',
                  requestId: '__REQUEST_ID__',
                  // Pin the checkout to the same Mews environment that minted the
                  // request (app host of the demo), else the card reads invalid.
                  dataBaseUrl: '__DATA_BASE_URL__',
                  onSuccess: function (event) {
                    var pmId = (event && (event.paymentMethodId
                      || (event.data && event.data.paymentMethodId))) || '(not in payload)';
                    document.getElementById('status').textContent =
                      'Card collected (' + pmId + '). You can close this tab and rerun the demo.';
                  },
                  onFailure: function (event) {
                    document.getElementById('status').textContent =
                      'Card entry failed: ' + JSON.stringify(event);
                  }
                });
              </script>
            </body>
            </html>
            """;
}
