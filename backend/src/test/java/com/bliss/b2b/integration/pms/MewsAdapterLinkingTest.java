package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.bliss.b2b.integration.pms.MewsAdapterChargeTest.FakeHttp;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The reads that link a booking-engine reservation to a plan, against response
 * shapes captured from the Gross UK demo enterprise.
 */
class MewsAdapterLinkingTest {

    @Test
    void reservationTotalSumsLiveOrderItemsAndSkipsCanceledOnes() {
        FakeHttp http = new FakeHttp().then(200, """
                {"OrderItems":[
                  {"Id":"i1","Amount":{"Currency":"GBP","GrossValue":86.00},"CanceledUtc":null},
                  {"Id":"i2","Amount":{"Currency":"GBP","GrossValue":86.00},"CanceledUtc":null},
                  {"Id":"i3","Amount":{"Currency":"GBP","GrossValue":172.00},"CanceledUtc":null},
                  {"Id":"i4","Amount":{"Currency":"GBP","GrossValue":50.00},"CanceledUtc":"2026-09-01T00:00:00Z"}
                ],"Cursor":null}
                """);

        MewsAdapter.StayPrice total = adapter(http).getReservationTotal("res_1");

        assertThat(total.totalMinorUnits()).isEqualTo(34_400);
        assertThat(total.currency()).isEqualTo("GBP");
        assertThat(http.requests.get(0)).contains("\"ServiceOrderIds\":[\"res_1\"]");
    }

    @Test
    void reservationTotalRefusesMixedCurrenciesAndEmptyReservations() {
        FakeHttp mixed = new FakeHttp().then(200, """
                {"OrderItems":[
                  {"Id":"i1","Amount":{"Currency":"GBP","GrossValue":86.00}},
                  {"Id":"i2","Amount":{"Currency":"EUR","GrossValue":86.00}}
                ]}
                """);
        assertThatThrownBy(() -> adapter(mixed).getReservationTotal("res_1"))
                .isInstanceOf(PmsAdapterException.class).hasMessageContaining("GBP and EUR");

        FakeHttp empty = new FakeHttp().then(200, "{\"OrderItems\":[]}");
        assertThatThrownBy(() -> adapter(empty).getReservationTotal("res_1"))
                .isInstanceOf(PmsAdapterException.class).hasMessageContaining("no order items");
    }

    @Test
    void cardPaymentsCarryTheCardAndAPositiveAmount() {
        // Mews books payments as negative bill entries.
        FakeHttp http = new FakeHttp().then(200, """
                {"Payments":[
                  {"Id":"pay_1","Type":"CreditCardPayment","State":"Charged","ReservationId":"res_1",
                   "Amount":{"Currency":"GBP","GrossValue":-68.80},
                   "Data":{"Discriminator":"CreditCard","CreditCard":{"CreditCardId":"card_1"}},
                   "CreatedUtc":"2026-08-26T09:48:41Z"},
                  {"Id":"pay_2","Type":"CashPayment","State":"Charged","ReservationId":"res_1",
                   "Amount":{"Currency":"GBP","GrossValue":-10.00}},
                  {"Id":"pay_3","Type":"CreditCardPayment","State":"Charged","ReservationId":"res_other",
                   "Amount":{"Currency":"GBP","GrossValue":-5.00},
                   "Data":{"CreditCard":{"CreditCardId":"card_9"}}}
                ]}
                """);

        List<MewsAdapter.MewsCardPayment> payments = adapter(http).getReservationCardPayments("res_1");

        assertThat(payments).hasSize(1);
        MewsAdapter.MewsCardPayment p = payments.get(0);
        assertThat(p.id()).isEqualTo("pay_1");
        assertThat(p.state()).isEqualTo("Charged");
        assertThat(p.amountMinorUnits()).isEqualTo(6_880);
        assertThat(p.currency()).isEqualTo("GBP");
        assertThat(p.creditCardId()).isEqualTo("card_1");
        assertThat(p.createdUtc()).isEqualTo(Instant.parse("2026-08-26T09:48:41Z"));
        assertThat(http.requests.get(0)).contains("\"ReservationIds\":[\"res_1\"]");
    }

    @Test
    void reservationsUpdatedReadsTheFieldsLinkingUses() {
        FakeHttp http = new FakeHttp().then(200, """
                {"Reservations":[{"Id":"res_1","Number":"52","State":"Confirmed","ServiceId":"svc",
                  "RateId":"rate_m","AccountId":"cust_1","RequestedResourceCategoryId":"cat",
                  "Origin":"Distributor","ScheduledStartUtc":"2026-12-08T14:00:00Z",
                  "ScheduledEndUtc":"2026-12-10T11:00:00Z","CreatedUtc":"2026-09-27T10:00:00Z",
                  "UpdatedUtc":"2026-09-27T10:01:00Z","CreditCardId":null}],"Cursor":null}
                """);

        List<MewsAdapter.MewsReservation> rs = adapter(http).getReservationsUpdated(
                "svc", Instant.parse("2026-09-27T09:55:00Z"), Instant.parse("2026-09-27T10:05:00Z"));

        assertThat(rs).singleElement().satisfies(r -> {
            assertThat(r.id()).isEqualTo("res_1");
            assertThat(r.state()).isEqualTo("Confirmed");
            assertThat(r.rateId()).isEqualTo("rate_m");
            assertThat(r.accountId()).isEqualTo("cust_1");
            assertThat(r.startUtc()).isEqualTo(Instant.parse("2026-12-08T14:00:00Z"));
            assertThat(r.endUtc()).isEqualTo(Instant.parse("2026-12-10T11:00:00Z"));
        });
        assertThat(http.requests.get(0))
                .contains("\"ServiceIds\":[\"svc\"]")
                .contains("\"StartUtc\":\"2026-09-27T09:55:00Z\"")
                .contains("\"EndUtc\":\"2026-09-27T10:05:00Z\"");
    }

    private static MewsAdapter adapter(FakeHttp http) {
        MewsPmsConfig config = new MewsPmsConfig();
        config.setPlatformUrl("https://api.mews-demo.com");
        config.setClientToken("ct");
        config.setAccessToken("at");
        return new MewsAdapter(config, http,
                new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS));
    }
}
