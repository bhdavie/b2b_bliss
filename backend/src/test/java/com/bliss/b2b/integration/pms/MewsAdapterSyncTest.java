package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.integration.pms.MewsAdapterChargeTest.FakeHttp;
import com.bliss.b2b.payments.BookingType;
import com.bliss.b2b.payments.CancellationTerms;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The Mews calls behind auto-sync and the fee line, against response shapes
 * captured from the Gross UK demo enterprise on 2026-10-01.
 */
class MewsAdapterSyncTest {

    private static MewsAdapter adapter(FakeHttp http) {
        MewsPmsConfig config = new MewsPmsConfig();
        config.setPlatformUrl("https://api.mews-demo.com");
        config.setClientToken("ct");
        config.setAccessToken("at");
        return new MewsAdapter(config, http,
                new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS));
    }

    @Test
    void ratesCarryTheirRateGroup() {
        FakeHttp http = new FakeHttp().then(200, """
                {"Rates":[{"Id":"221075f6","GroupId":"fd0f8993","Name":"Siestify Pricing ","Type":"Private",
                  "IsPublic":false,"IsEnabled":true,"IsActive":true}],"Cursor":null}
                """);

        assertThat(adapter(http).getRates("svc").get(0).groupId()).isEqualTo("fd0f8993");
    }

    @Test
    void cancellationPoliciesAreGroupedByRateGroup_andInactiveOnesSkipped() {
        FakeHttp http = new FakeHttp().then(200, """
                {"CancellationPolicies":[
                  {"Id":"416852eb","RateGroupId":"c2dd3409","Applicability":"Creation","FeeExtent":["TimeUnits"],
                   "ApplicabilityOffset":"P0M0DT0H0M0S","FeeMaximumTimeUnits":null,
                   "AbsoluteFee":{"Currency":"GBP","Value":50.0},"RelativeFee":0.5,"IsActive":true},
                  {"Id":"old","RateGroupId":"c2dd3409","Applicability":"Creation","FeeExtent":["TimeUnits"],
                   "ApplicabilityOffset":"P0M0DT0H0M0S","RelativeFee":1.0,"IsActive":false}
                ],"Cursor":null}
                """);

        Map<String, List<CancellationTerms.Step>> policies =
                adapter(http).getCancellationPolicies("svc", List.of("c2dd3409", "fd0f8993"));

        assertThat(http.requests.get(0)).contains("\"ServiceIds\":[\"svc\"]")
                .contains("\"RateGroupIds\":[\"c2dd3409\",\"fd0f8993\"]");
        assertThat(policies).containsOnlyKeys("c2dd3409");
        CancellationTerms.Step step = policies.get("c2dd3409").get(0);
        assertThat(step.applicability()).isEqualTo("Creation");
        assertThat(step.feeExtent()).isEqualTo("TimeUnits");
        assertThat(step.relativeFee()).isEqualByComparingTo(new BigDecimal("0.5"));
        assertThat(step.absoluteFeeMinor()).isEqualTo(5_000L);
        assertThat(new CancellationTerms(policies.get("c2dd3409")).derivedType()).isEqualTo(BookingType.REFUNDABLE);
    }

    @Test
    void additionalServicesAreTheOnesThatTakeOrders() {
        FakeHttp http = new FakeHttp().then(200, """
                {"Services":[
                  {"Id":"stay","Name":"API HOTEL","IsActive":true,"Data":{"Discriminator":"Bookable","Value":{}}},
                  {"Id":"bliss","Name":"Bliss","IsActive":true,"Data":{"Discriminator":"Additional","Value":{}}}
                ],"Cursor":null}
                """);

        assertThat(adapter(http).getAdditionalServices())
                .containsExactly(new MewsCatalog.AdditionalService("bliss", "Bliss", true));
    }

    @Test
    void theFeeLinePostsAsOneUntaxedCustomItemLinkedToTheReservation() {
        FakeHttp http = new FakeHttp().then(200, """
                {"OrderId":"2648b297","ChargeId":"2648b297"}
                """);

        String orderId = adapter(http).addOrderItem("svc-bliss", "cust-1", "res-1", "Bliss service fee",
                11_421, "GBP", null, null, "fee_line:plan-1", "Bliss payment plan fee");

        assertThat(orderId).isEqualTo("2648b297");
        String body = http.requests.get(0);
        assertThat(body).contains("\"ServiceId\":\"svc-bliss\"").contains("\"AccountId\":\"cust-1\"")
                .contains("\"LinkedReservationId\":\"res-1\"").contains("\"Name\":\"Bliss service fee\"")
                .contains("\"GrossValue\":114.21").contains("\"ExternalIdentifier\":\"fee_line:plan-1\"")
                .doesNotContain("TaxCodes").doesNotContain("AccountingCategoryId");
    }

    @Test
    void aChosenTaxCodeAndAccountingCategoryAreSent() {
        FakeHttp http = new FakeHttp().then(200, "{\"OrderId\":\"o2\"}");

        adapter(http).addOrderItem("svc-bliss", "cust-1", "res-1", "Bliss service fee", 1_000, "GBP",
                "UK-2022-20%", "cat-fees", "fee_line:plan-2", null);

        assertThat(http.requests.get(0)).contains("\"TaxCodes\":[\"UK-2022-20%\"]")
                .contains("\"AccountingCategoryId\":\"cat-fees\"");
    }

    @Test
    void aNetPricingPropertyGetsTheAmountAsANetValue() {
        // On the Net Pricing demo a taxed GrossValue is refused ("Invalid
        // NetValue"); a NetValue is taken and Mews adds the tax on top.
        FakeHttp http = new FakeHttp().then(200, "{\"OrderId\":\"o-net\"}");

        adapter(http).addOrderItem("svc-bliss", "cust-1", "res-1", "Bliss service fee", 11_421, "USD",
                "US-DC-2023-6%", null, "fee_line:plan-3", null, true);

        assertThat(http.requests.get(0)).contains("\"NetValue\":114.21").doesNotContain("GrossValue")
                .contains("\"TaxCodes\":[\"US-DC-2023-6%\"]");
    }

    @Test
    void aGrossPricingPropertyGetsTheAmountAsAGrossValue() {
        FakeHttp http = new FakeHttp().then(200, "{\"OrderId\":\"o-gross\"}");

        adapter(http).addOrderItem("svc-bliss", "cust-1", "res-1", "Bliss service fee", 11_421, "GBP",
                null, null, "fee_line:plan-4", null, false);

        assertThat(http.requests.get(0)).contains("\"GrossValue\":114.21").doesNotContain("NetValue");
    }

    @Test
    void anEarlierFeeLineIsFoundByItsExternalIdentifier_ignoringCanceledOnes() {
        FakeHttp http = new FakeHttp().then(200, """
                {"OrderItems":[
                  {"Id":"i1","ServiceOrderId":"other-order","ExternalIdentifier":"fee_line:plan-9","CanceledUtc":null},
                  {"Id":"i2","ServiceOrderId":"canceled-order","ExternalIdentifier":"fee_line:plan-1",
                   "CanceledUtc":"2026-10-01T22:30:00Z"},
                  {"Id":"i3","ServiceOrderId":"2648b297","ExternalIdentifier":"fee_line:plan-1","CanceledUtc":null}
                ],"Cursor":null}
                """);

        java.util.Optional<String> found = adapter(http).findOrderByExternalIdentifier("svc-bliss",
                java.time.Instant.parse("2026-10-01T22:00:00Z"), java.time.Instant.parse("2026-10-01T23:00:00Z"),
                "fee_line:plan-1");

        assertThat(found).contains("2648b297");
        assertThat(http.requests.get(0)).contains("\"ServiceIds\":[\"svc-bliss\"]")
                .contains("\"StartUtc\":\"2026-10-01T22:00:00Z\"").contains("\"EndUtc\":\"2026-10-01T23:00:00Z\"");
    }

    @Test
    void noEarlierFeeLineMeansNothingFound() {
        FakeHttp http = new FakeHttp().then(200, "{\"OrderItems\":[],\"Cursor\":null}");

        assertThat(adapter(http).findOrderByExternalIdentifier("svc-bliss", java.time.Instant.EPOCH,
                java.time.Instant.parse("2026-10-01T23:00:00Z"), "fee_line:plan-1")).isEmpty();
    }

    @Test
    void aReleaseIsRecordedAsALedgerPaymentOfTheChosenType() {
        FakeHttp http = new FakeHttp().then(200, "{\"ExternalPaymentId\":\"97ed1fc7\"}");

        String id = adapter(http).addExternalPayment("cust-1", "res-1", 27_160, "USD", "Unspecified",
                "ledger:rel-1", "Paid through Bliss");

        assertThat(id).isEqualTo("97ed1fc7");
        assertThat(http.requests.get(0)).contains("\"GrossValue\":271.6").contains("\"Type\":\"Unspecified\"")
                .contains("\"ExternalIdentifier\":\"ledger:rel-1\"").contains("\"ReservationId\":\"res-1\"");
    }

    @Test
    void anEarlierLedgerPaymentIsFoundByItsIdentifier() {
        // The shape payments/getAll returned on Gross UK for an external payment.
        FakeHttp http = new FakeHttp().then(200, """
                {"Payments":[
                  {"Id":"p-other","Data":{"Discriminator":"External","External":{"Type":"Cash",
                    "ExternalIdentifier":"ledger:rel-9"}}},
                  {"Id":"p-card","Data":{"Discriminator":"CreditCard","External":null}},
                  {"Id":"p-mine","Data":{"Discriminator":"External","External":{"Type":"Unspecified",
                    "ExternalIdentifier":"ledger:rel-1"}}}
                ],"Cursor":null}
                """);

        assertThat(adapter(http).findExternalPayment("cust-1", java.time.Instant.EPOCH,
                java.time.Instant.parse("2026-10-02T00:00:00Z"), "ledger:rel-1")).contains("p-mine");
        assertThat(http.requests.get(0)).contains("\"AccountIds\":[\"cust-1\"]");
    }
}
