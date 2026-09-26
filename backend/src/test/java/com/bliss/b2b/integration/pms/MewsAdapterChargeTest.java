package com.bliss.b2b.integration.pms;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bliss.b2b.BlissConfiguration.PmsConfig.MewsPmsConfig;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.Authenticator;
import java.net.CookieHandler;
import java.net.ProxySelector;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.Flow;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSession;
import org.junit.jupiter.api.Test;

/**
 * creditCards/charge outcomes as Mews actually returns them. A gateway refusal
 * comes back as HTTP 403 "Transaction was declined (Refused)" rather than a
 * Failed payment, and must still read as a decline.
 */
class MewsAdapterChargeTest {

    @Test
    void gatewayRefusalIsADeclineNotAnError() {
        FakeHttp http = new FakeHttp()
                .then(403, "{\"Message\":\"Transaction was declined (Refused).\",\"RequestId\":\"r1\",\"Details\":null}");

        PmsChargeResult result = adapter(http).chargeStoredCard("cust", "card", 81_165, "USD", "res_1", "note");

        assertThat(result.status()).isEqualTo(PmsChargeStatus.FAILED);
        assertThat(result.rawState()).isEqualTo("Refused");
        assertThat(result.paymentId()).isNull();
        assertThat(result.amountMinorUnits()).isEqualTo(81_165);
        assertThat(http.requests).hasSize(1);
    }

    @Test
    void declineWithoutAReasonStillDeclines() {
        FakeHttp http = new FakeHttp().then(403, "{\"Message\":\"Transaction was declined.\"}");

        PmsChargeResult result = adapter(http).chargeStoredCard("cust", "card", 100, "USD", null, null);

        assertThat(result.status()).isEqualTo(PmsChargeStatus.FAILED);
        assertThat(result.rawState()).isEqualTo("Declined");
    }

    @Test
    void otherForbiddenResponsesStillThrow() {
        // A missing permission says nothing about the card; it must not be
        // recorded as a decline against the guest.
        FakeHttp http = new FakeHttp().then(403, "{\"Message\":\"Access token is not permitted to use this operation.\"}");

        assertThatThrownBy(() -> adapter(http).chargeStoredCard("cust", "card", 100, "USD", null, null))
                .isInstanceOf(PmsAdapterException.class)
                .satisfies(e -> assertThat(((PmsAdapterException) e).httpStatus()).isEqualTo(403));
    }

    @Test
    void serverErrorsStillThrow() {
        FakeHttp http = new FakeHttp().then(500, "{\"Message\":\"Internal error\"}");

        assertThatThrownBy(() -> adapter(http).chargeStoredCard("cust", "card", 100, "USD", null, null))
                .isInstanceOf(PmsAdapterException.class);
    }

    @Test
    void acceptedChargePassesReservationIdAndReadsBackTheState() {
        FakeHttp http = new FakeHttp()
                .then(200, "{\"PaymentId\":\"pay_1\"}")
                .then(200, "{\"Payments\":[{\"Id\":\"pay_1\",\"State\":\"Charged\"}]}");

        PmsChargeResult result = adapter(http).chargeStoredCard("cust", "card", 81_165, "USD", "res_1", "note");

        assertThat(result.status()).isEqualTo(PmsChargeStatus.CHARGED);
        assertThat(result.paymentId()).isEqualTo("pay_1");
        assertThat(http.requests.get(0)).contains("\"ReservationId\":\"res_1\"").contains("\"GrossValue\":811.65");
        assertThat(http.requests.get(0)).contains("\"Client\":\"" + MewsAdapter.CLIENT + "\"");
    }

    @Test
    void declineReasonParsing() {
        assertThat(MewsAdapter.declineReason("Transaction was declined (Refused).")).isEqualTo("Refused");
        assertThat(MewsAdapter.declineReason("Transaction was declined ().")).isEqualTo("Declined");
        assertThat(MewsAdapter.declineReason(null)).isEqualTo("Declined");
    }

    private static MewsAdapter adapter(FakeHttp http) {
        MewsPmsConfig config = new MewsPmsConfig();
        config.setPlatformUrl("https://api.mews-demo.com");
        config.setClientToken("ct");
        config.setAccessToken("at");
        return new MewsAdapter(config, http,
                new ObjectMapper().enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS));
    }

    /** Plays back canned responses in order and records each request body. */
    private static final class FakeHttp extends HttpClient {
        private final Deque<Object[]> responses = new ArrayDeque<>();
        final List<String> requests = new ArrayList<>();

        FakeHttp then(int status, String body) {
            responses.add(new Object[] {status, body});
            return this;
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> HttpResponse<T> send(HttpRequest request, HttpResponse.BodyHandler<T> handler)
                throws IOException {
            requests.add(bodyOf(request));
            Object[] next = responses.removeFirst();
            return (HttpResponse<T>) new CannedResponse(request, (int) next[0], (String) next[1]);
        }

        private static String bodyOf(HttpRequest request) {
            StringBuilder sb = new StringBuilder();
            request.bodyPublisher().ifPresent(p -> p.subscribe(new Flow.Subscriber<ByteBuffer>() {
                @Override public void onSubscribe(Flow.Subscription s) { s.request(Long.MAX_VALUE); }
                @Override public void onNext(ByteBuffer b) {
                    byte[] bytes = new byte[b.remaining()];
                    b.get(bytes);
                    sb.append(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
                }
                @Override public void onError(Throwable t) { }
                @Override public void onComplete() { }
            }));
            return sb.toString();
        }

        @Override public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest r, HttpResponse.BodyHandler<T> h) {
            throw new UnsupportedOperationException();
        }
        @Override public <T> CompletableFuture<HttpResponse<T>> sendAsync(HttpRequest r, HttpResponse.BodyHandler<T> h,
                HttpResponse.PushPromiseHandler<T> p) {
            throw new UnsupportedOperationException();
        }
        @Override public Optional<CookieHandler> cookieHandler() { return Optional.empty(); }
        @Override public Optional<Duration> connectTimeout() { return Optional.empty(); }
        @Override public Redirect followRedirects() { return Redirect.NEVER; }
        @Override public Optional<ProxySelector> proxy() { return Optional.empty(); }
        @Override public SSLContext sslContext() { return null; }
        @Override public SSLParameters sslParameters() { return null; }
        @Override public Optional<Authenticator> authenticator() { return Optional.empty(); }
        @Override public Version version() { return Version.HTTP_1_1; }
        @Override public Optional<Executor> executor() { return Optional.empty(); }
    }

    private record CannedResponse(HttpRequest request, int statusCode, String body) implements HttpResponse<String> {
        @Override public Optional<HttpResponse<String>> previousResponse() { return Optional.empty(); }
        @Override public HttpHeaders headers() { return HttpHeaders.of(Map.of(), (a, b) -> true); }
        @Override public Optional<SSLSession> sslSession() { return Optional.empty(); }
        @Override public URI uri() { return request.uri(); }
        @Override public HttpClient.Version version() { return HttpClient.Version.HTTP_1_1; }
    }
}
