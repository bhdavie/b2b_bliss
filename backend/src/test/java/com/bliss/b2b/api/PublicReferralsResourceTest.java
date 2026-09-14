package com.bliss.b2b.api;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.http.HttpServletRequest;
import java.lang.reflect.Proxy;
import org.junit.jupiter.api.Test;

/**
 * Which address the referral intake keys its rate limit on and stores as
 * source_ip. The end-to-end 429 is in BlissApplicationTest.
 */
class PublicReferralsResourceTest {

    @Test
    void usesTheLastForwardedEntryWhichTheRouterAppends() {
        assertThat(PublicReferralsResource.callerIp(request("203.0.113.5, 198.51.100.20", "10.1.2.3")))
                .isEqualTo("198.51.100.20");
        // A client stuffing its own entries in front changes nothing.
        assertThat(PublicReferralsResource.callerIp(
                request("1.1.1.1, 2.2.2.2, 3.3.3.3, 198.51.100.20", "10.1.2.3")))
                .isEqualTo("198.51.100.20");
    }

    @Test
    void aSingleForwardedEntryIsUsedAsIs() {
        assertThat(PublicReferralsResource.callerIp(request("198.51.100.20", "10.1.2.3")))
                .isEqualTo("198.51.100.20");
    }

    @Test
    void trailingEmptyEntriesAreSkipped() {
        assertThat(PublicReferralsResource.callerIp(request("198.51.100.20, ", "10.1.2.3")))
                .isEqualTo("198.51.100.20");
    }

    @Test
    void fallsBackToTheRemoteAddressWithoutAUsableHeader() {
        assertThat(PublicReferralsResource.callerIp(request(null, "10.1.2.3"))).isEqualTo("10.1.2.3");
        assertThat(PublicReferralsResource.callerIp(request("", "10.1.2.3"))).isEqualTo("10.1.2.3");
        assertThat(PublicReferralsResource.callerIp(request(" , ", "10.1.2.3"))).isEqualTo("10.1.2.3");
    }

    /**
     * A request that answers only the two calls callerIp makes. A JDK proxy
     * rather than a mock: nothing else in this suite uses a mocking library.
     */
    private static HttpServletRequest request(String forwardedFor, String remoteAddr) {
        return (HttpServletRequest) Proxy.newProxyInstance(
                HttpServletRequest.class.getClassLoader(),
                new Class<?>[] {HttpServletRequest.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getHeader" -> "X-Forwarded-For".equalsIgnoreCase((String) args[0])
                            ? forwardedFor : null;
                    case "getRemoteAddr" -> remoteAddr;
                    default -> throw new UnsupportedOperationException(method.getName());
                });
    }
}
