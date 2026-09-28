package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;

/**
 * API keys — {@code sendping.apiKeys()}. Read-only by design.
 *
 * <p>Keys are minted, re-scoped and revoked in the SendPing dashboard, and
 * only there: those routes accept a signed-in dashboard session, never an API
 * key. This SDK therefore deliberately exposes no method for them — a leaked
 * key cannot mint itself a replacement, widen its own permission or revoke the
 * keys around it. All it can do is read the inventory below.
 *
 * <p>{@code token} on a listed key is only the 8-character display prefix; the
 * full secret exists solely in the dashboard, at the moment the key is created.
 */
public final class ApiKeys extends Resource {
    public ApiKeys(ApiClient api) { super(api); }

    /**
     * List non-revoked keys. With no pagination params the route skips paging
     * and answers with all of them — capped at <strong>1,000</strong> rows,
     * with {@code has_more} true if that ceiling bites. {@code GET /api-keys}
     */
    public SendPingResponse list() { return list(null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/api-keys" + paginate(params));
    }
}
