package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;

import java.util.LinkedHashMap;
import java.util.Map;

/** Audiences — {@code sendping.audiences()}. */
public final class Audiences extends Resource {
    public Audiences(ApiClient api) { super(api); }

    /** {@code POST /audiences} */
    public SendPingResponse create(String name) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        return api.request("POST", "/audiences", body);
    }

    /** {@code GET /audiences/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/audiences/" + enc(id));
    }

    /**
     * List audiences. This route always applies a limit — with no pagination
     * params you get the first 20. {@code GET /audiences}
     */
    public SendPingResponse list() { return list(null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/audiences" + paginate(params));
    }

    /**
     * Import contacts from a link-shared Google Sheet — header columns become
     * contact properties; rows land in a fresh segment.
     * {@code POST /audiences/:id/contacts/import-sheet}
     */
    public SendPingResponse importSheet(String audienceId, String url) {
        return importSheet(audienceId, url, null);
    }

    public SendPingResponse importSheet(String audienceId, String url, String segmentName) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("url", url);
        if (segmentName != null) body.put("segment_name", segmentName);
        return api.request("POST", "/audiences/" + enc(audienceId) + "/contacts/import-sheet", body);
    }

    /** Rename an audience. {@code PATCH /audiences/:id} */
    public SendPingResponse update(String id, String name) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        return api.request("PATCH", "/audiences/" + enc(id), body);
    }

    /** {@code DELETE /audiences/:id} */
    public SendPingResponse remove(String id) {
        return api.request("DELETE", "/audiences/" + enc(id));
    }
}
