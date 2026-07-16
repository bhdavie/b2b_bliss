package com.bliss.b2b.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Sends transactional email through Postmark's HTTP API.
 *
 * <p>Talks to the REST endpoint directly with the JDK HttpClient rather than
 * pulling in the Postmark SDK — the surface used here is one POST, and the SDK
 * would add a dependency for it.
 *
 * <p>Failures throw. Callers decide what a delivery failure means for their
 * flow: {@code PlanCreationService} logs and moves on, because the plan is
 * already committed and the mail is a notification, while {@code
 * MagicLinkService} propagates, because the mail *is* the flow.
 *
 * @see <a href="https://postmarkapp.com/developer/api/email-api">Postmark Email API</a>
 */
public class PostmarkEmailService implements EmailService {

    private static final Logger log = LoggerFactory.getLogger(PostmarkEmailService.class);

    private static final URI POSTMARK_EMAIL_ENDPOINT = URI.create("https://api.postmarkapp.com/email");
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(10);

    private final String serverToken;
    private final String fromAddress;
    private final HttpClient http;
    private final ObjectMapper mapper;

    public PostmarkEmailService(String serverToken, String fromAddress) {
        this(serverToken, fromAddress,
                HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build(),
                new ObjectMapper());
    }

    PostmarkEmailService(String serverToken, String fromAddress, HttpClient http, ObjectMapper mapper) {
        this.serverToken = serverToken;
        this.fromAddress = fromAddress;
        this.http = http;
        this.mapper = mapper;
    }

    @Override
    public void send(EmailMessage message) {
        HttpResponse<String> response;
        try {
            response = http.send(buildRequest(message), HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new EmailDeliveryException(
                    "Postmark request failed for " + message.to() + ": " + e.getMessage(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EmailDeliveryException("Interrupted sending email to " + message.to(), e);
        }

        if (response.statusCode() / 100 != 2) {
            throw failure(message, response);
        }
        log.info("Postmark accepted message to={} subject={}", message.to(), message.subject());
    }

    private HttpRequest buildRequest(EmailMessage message) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("From", fromAddress);
        payload.put("To", message.to());
        payload.put("Subject", message.subject());
        payload.put("TextBody", message.body());
        if (message.hasHtmlBody()) {
            payload.put("HtmlBody", message.htmlBody());
        }
        payload.put("MessageStream", "outbound");

        String json;
        try {
            json = mapper.writeValueAsString(payload);
        } catch (IOException e) {
            throw new EmailDeliveryException("Could not serialize email payload", e);
        }

        return HttpRequest.newBuilder(POSTMARK_EMAIL_ENDPOINT)
                .timeout(REQUEST_TIMEOUT)
                .header("Accept", "application/json")
                .header("Content-Type", "application/json")
                .header("X-Postmark-Server-Token", serverToken)
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
    }

    /**
     * Postmark returns its own ErrorCode alongside the HTTP status, and that
     * code is what distinguishes an unverified sender from a bad token from a
     * suppressed recipient. Surface it — the HTTP status alone is 422 for all
     * three.
     */
    private EmailDeliveryException failure(EmailMessage message, HttpResponse<String> response) {
        int errorCode = -1;
        String detail = "";
        try {
            JsonNode body = mapper.readTree(response.body());
            errorCode = body.path("ErrorCode").asInt(-1);
            detail = body.path("Message").asText("");
        } catch (IOException e) {
            detail = response.body() == null ? "" : response.body();
        }
        log.error("Postmark rejected message to={} httpStatus={} errorCode={} message={}",
                message.to(), response.statusCode(), errorCode, detail);
        return new EmailDeliveryException(String.format(
                "Postmark rejected message to %s (HTTP %d, ErrorCode %d): %s",
                message.to(), response.statusCode(), errorCode, detail));
    }
}
