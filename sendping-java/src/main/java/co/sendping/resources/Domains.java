package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.http.Query;
import co.sendping.requests.ClaimDomainRequest;
import co.sendping.requests.CreateDomainRequest;
import co.sendping.requests.UpdateDomainRequest;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** Sending/receiving domains — {@code sendping.domains()}. */
public final class Domains extends Resource {
    public Domains(ApiClient api) { super(api); }

    /** {@code POST /domains} */
    public SendPingResponse create(CreateDomainRequest request) {
        return api.request("POST", "/domains", request);
    }

    /** {@code GET /domains/:id} */
    /** HTTPS readiness; an unavailable host schedules server-side repair. */
    public SendPingResponse trackingHealth(String id) {
        return api.request("GET", "/domains/" + enc(id) + "/tracking-health");
    }

    public SendPingResponse get(String id) {
        return api.request("GET", "/domains/" + enc(id));
    }

    /**
     * List domains. With no pagination params the route skips paging and
     * answers with all of them — capped at <strong>1,000</strong> rows, with
     * {@code has_more} true if that ceiling bites. Rows still awaiting a
     * DNS-TXT ownership claim ({@code status: "claim"}) are excluded — reach
     * those through {@link #getClaim(String)}. {@code GET /domains}
     */
    public SendPingResponse list() { return list(null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/domains" + paginate(params));
    }

    /**
     * Check a domain's live MX records before enabling inbound.
     * Returns {@code { has_mx, ours, records }}; DNS failures fail open with
     * {@code has_mx:false}. {@code GET /domains/mx-check?name=}
     */
    public SendPingResponse mxCheck(String name) {
        Query q = new Query().add("name", name);
        return api.request("GET", "/domains/mx-check" + q);
    }

    /**
     * Download the domain's DNS records as CSV text (the route returns
     * {@code text/csv}, not JSON). {@code GET /domains/:id/records.csv}
     */
    public String recordsCsv(String id) {
        byte[] bytes = api.requestRaw("GET", "/domains/" + enc(id) + "/records.csv");
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /** Returns the slim ack {@code { object: 'domain', id }}. {@code PATCH /domains/:id} */
    public SendPingResponse update(String id, UpdateDomainRequest request) {
        return api.request("PATCH", "/domains/" + enc(id), request);
    }

    /** Trigger DNS verification. {@code POST /domains/:id/verify} */
    public SendPingResponse verify(String id) {
        return api.request("POST", "/domains/" + enc(id) + "/verify");
    }

    /** Claim a domain already verified elsewhere. {@code POST /domains/claim} */
    public SendPingResponse claim(ClaimDomainRequest request) {
        return api.request("POST", "/domains/claim", request);
    }

    /** Retrieve a domain's claim record. {@code GET /domains/:id/claim} */
    public SendPingResponse getClaim(String id) {
        return api.request("GET", "/domains/" + enc(id) + "/claim");
    }

    /** Verify a domain claim. {@code POST /domains/:id/claim/verify} */
    public SendPingResponse verifyClaim(String id) {
        return api.request("POST", "/domains/" + enc(id) + "/claim/verify");
    }

    /**
     * Detect the domain's DNS provider and the one-click apply methods
     * available. {@code GET /domains/:id/dns/detect}
     */
    public SendPingResponse detectDns(String id) {
        return api.request("GET", "/domains/" + enc(id) + "/dns/detect");
    }

    /** Apply DNS records via the Cloudflare API, then auto-verify. {@code POST /domains/:id/dns/cloudflare} */
    public SendPingResponse applyCloudflareDns(String id, String token) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("token", token);
        return api.request("POST", "/domains/" + enc(id) + "/dns/cloudflare", body);
    }

    /** Apply DNS records via the GoDaddy API, then auto-verify. {@code POST /domains/:id/dns/godaddy} */
    public SendPingResponse applyGoDaddyDns(String id, String key, String secret) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("key", key);
        body.put("secret", secret);
        return api.request("POST", "/domains/" + enc(id) + "/dns/godaddy", body);
    }

    /**
     * Apply DNS records via the Namecheap API (existing records preserved),
     * then auto-verify. Namecheap must have the calling server's IP
     * whitelisted. {@code POST /domains/:id/dns/namecheap}
     */
    public SendPingResponse applyNamecheapDns(String id, String apiUser, String apiKey) {
        return applyNamecheapDns(id, apiUser, apiKey, null);
    }

    public SendPingResponse applyNamecheapDns(String id, String apiUser, String apiKey, String userName) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("apiUser", apiUser);
        body.put("apiKey", apiKey);
        if (userName != null) body.put("userName", userName);
        return api.request("POST", "/domains/" + enc(id) + "/dns/namecheap", body);
    }

    /** {@code DELETE /domains/:id} */
    public SendPingResponse remove(String id) {
        return api.request("DELETE", "/domains/" + enc(id));
    }
}
