package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;

/** Read-only results of the in-email poll widget — {@code sendping.polls()}. */
public final class Polls extends Resource {
    public Polls(ApiClient api) { super(api); }

    /** One summary row per email that has poll responses. {@code GET /polls} */
    public SendPingResponse list() { return list(null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/polls" + paginate(params));
    }

    /** The aggregated answer breakdown for one email. {@code GET /polls/:emailId} */
    public SendPingResponse get(String emailId) {
        return api.request("GET", "/polls/" + enc(emailId));
    }
}
