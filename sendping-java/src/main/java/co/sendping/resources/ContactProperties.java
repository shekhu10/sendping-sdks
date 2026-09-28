package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.requests.CreateContactPropertyRequest;

import java.util.Collections;

/** Custom contact properties (merge tags) — {@code sendping.contactProperties()}. */
public final class ContactProperties extends Resource {
    public ContactProperties(ApiClient api) { super(api); }

    /** Returns the slim ack {@code { object: 'contact_property', id }}. {@code POST /contact-properties} */
    public SendPingResponse create(CreateContactPropertyRequest request) {
        return api.request("POST", "/contact-properties", request);
    }

    /** {@code GET /contact-properties/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/contact-properties/" + enc(id));
    }

    /**
     * List the registry. With no pagination params the route skips paging and
     * answers with the whole registry — capped at <strong>1,000</strong> rows,
     * with {@code has_more} true if that ceiling bites.
     * {@code GET /contact-properties}
     */
    public SendPingResponse list() { return list(null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/contact-properties" + paginate(params));
    }

    /**
     * Update the fallback value (the only mutable field — key/type are
     * immutable; pass {@code null} to clear). {@code PATCH /contact-properties/:id}
     */
    public SendPingResponse update(String id, Object fallbackValue) {
        return api.request("PATCH", "/contact-properties/" + enc(id),
                Collections.singletonMap("fallback_value", fallbackValue));
    }

    /** {@code DELETE /contact-properties/:id} */
    public SendPingResponse remove(String id) {
        return api.request("DELETE", "/contact-properties/" + enc(id));
    }
}
