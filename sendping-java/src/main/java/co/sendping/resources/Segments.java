package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.http.Query;
import co.sendping.requests.CreateSegmentRequest;
import co.sendping.requests.UpdateSegmentRequest;

/**
 * Segments (DOMAIN-FIRST) — {@code domain} is REQUIRED on create and list.
 * Segment names are unique within a domain; every domain carries an
 * auto-created "General" segment.
 */
public final class Segments extends Resource {
    public Segments(ApiClient api) { super(api); }

    /** {@code POST /segments} — {@code domain} is required on the request. */
    public SendPingResponse create(CreateSegmentRequest request) {
        return api.request("POST", "/segments", request);
    }

    /** {@code GET /segments/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/segments/" + enc(id));
    }

    /** List a domain's segments. {@code GET /segments?domain=} */
    public SendPingResponse list(String domain) { return list(domain, null); }

    public SendPingResponse list(String domain, ListParams params) {
        Query q = new Query().add("domain", domain);
        if (params != null) params.applyTo(q);
        return api.request("GET", "/segments" + q);
    }

    /**
     * Preview the contacts a segment currently resolves to (filter matches plus
     * explicit memberships). Items use a reduced contact shape — no
     * {@code object} key and no {@code properties}. With no pagination params
     * the route skips paging and answers with every match up to a ceiling of
     * <strong>1,000</strong> rows; {@code has_more} goes true when a segment is
     * larger than that, so page on with {@code after} instead of treating one
     * unpaged call as complete. {@code GET /segments/:id/contacts}
     */
    public SendPingResponse contacts(String id) { return contacts(id, null); }

    public SendPingResponse contacts(String id, ListParams params) {
        return api.request("GET", "/segments/" + enc(id) + "/contacts" + paginate(params));
    }

    /** {@code PATCH /segments/:id} */
    public SendPingResponse update(String id, UpdateSegmentRequest request) {
        return api.request("PATCH", "/segments/" + enc(id), request);
    }

    /** {@code DELETE /segments/:id} */
    public SendPingResponse remove(String id) {
        return api.request("DELETE", "/segments/" + enc(id));
    }
}
