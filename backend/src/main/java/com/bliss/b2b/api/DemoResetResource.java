package com.bliss.b2b.api;

import com.bliss.b2b.service.DemoResetService;
import com.bliss.b2b.service.DemoResetService.Summary;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Dev-only demo reset kill switch.
 *
 * <p>Gated strictly on {@code enabled} (= {@code BLISS_DEMO_LOGIN}): when the
 * demo flag is off the endpoint returns 404 in every environment, so it is
 * impossible to invoke outside demo mode. It works on the hosted demo, which
 * runs production with the flag on. As a second, independent safety net the
 * delete itself only ever touches {@code is_demo=true} rows.
 */
@Path("/api/v1/dev/reset-demo-accounts")
@Produces(MediaType.APPLICATION_JSON)
public class DemoResetResource {

    private static final Logger log = LoggerFactory.getLogger(DemoResetResource.class);

    private final boolean enabled;
    private final DemoResetService service;

    public DemoResetResource(boolean enabled, DemoResetService service) {
        this.enabled = enabled;
        this.service = service;
    }

    @POST
    public Response reset() {
        if (!enabled) {
            // Same 404 shape as the other dev-gated endpoints.
            return Response.status(404).entity(Map.of("error", "not_found")).build();
        }
        log.warn("Demo reset invoked (BLISS_DEMO_LOGIN on); purging is_demo accounts");
        Summary summary = service.reset();
        return Response.ok(summary).build();
    }
}
