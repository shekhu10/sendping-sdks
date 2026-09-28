package co.sendping.resources;

import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.http.Query;
import co.sendping.requests.ListLogsParams;

/** API request logs — {@code sendping.logs()} (read-only). */
public final class Logs extends Resource {
    public Logs(ApiClient api) { super(api); }

    /** {@code GET /logs} */
    public SendPingResponse list() { return list(null); }

    /**
     * List API request logs. Cursor-paginated with optional server-side
     * {@code method} / {@code status} filters.
     */
    public SendPingResponse list(ListLogsParams params) {
        Query q = new Query();
        if (params != null) {
            q.add("limit", params.getLimit())
             .add("after", params.getAfter())
             .add("before", params.getBefore())
             .add("method", params.getMethod())
             .add("status", params.getStatus());
        }
        return api.request("GET", "/logs" + q);
    }

    /** Retrieve one log entry (includes request/response bodies). {@code GET /logs/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/logs/" + enc(id));
    }
}
