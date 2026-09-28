package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.requests.CreateCampaignRequest;
import co.sendping.requests.UpdateCampaignRequest;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Campaigns (DOMAIN-FIRST) — bulk sends to a domain's contact pool or one of
 * its segments. {@code domain} is REQUIRED on create.
 */
public final class Campaigns extends Resource {
    public Campaigns(ApiClient api) { super(api); }

    /** {@code POST /campaigns} */
    public SendPingResponse create(CreateCampaignRequest request) {
        return api.request("POST", "/campaigns", request);
    }

    /** {@code GET /campaigns/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/campaigns/" + enc(id));
    }

    /**
     * List campaigns. With no pagination params the route skips paging and
     * answers with all of them — capped at <strong>1,000</strong> rows, with
     * {@code has_more} true if that ceiling bites. {@code GET /campaigns}
     */
    public SendPingResponse list() { return list(null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/campaigns" + paginate(params));
    }

    /** {@code PATCH /campaigns/:id} */
    public SendPingResponse update(String id, UpdateCampaignRequest request) {
        return api.request("PATCH", "/campaigns/" + enc(id), request);
    }

    /** Send now. {@code POST /campaigns/:id/send} */
    public SendPingResponse send(String id) {
        return api.request("POST", "/campaigns/" + enc(id) + "/send", Collections.emptyMap());
    }

    /** Schedule the send. {@code POST /campaigns/:id/send} with {@code { scheduled_at }}. */
    public SendPingResponse send(String id, String scheduledAt) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("scheduled_at", scheduledAt);
        return api.request("POST", "/campaigns/" + enc(id) + "/send", body);
    }

    /**
     * Send (or schedule) with an IANA {@code schedule_timezone}, persisted
     * onto the campaign so daily batching evaluates batch-days in that zone.
     * Either argument may be {@code null} to omit it.
     * {@code POST /campaigns/:id/send}
     */
    public SendPingResponse send(String id, String scheduledAt, String scheduleTimezone) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (scheduledAt != null) body.put("scheduled_at", scheduledAt);
        if (scheduleTimezone != null) body.put("schedule_timezone", scheduleTimezone);
        return api.request("POST", "/campaigns/" + enc(id) + "/send", body);
    }

    /**
     * Stop a campaign's remaining work. Accepted only on {@code scheduled},
     * {@code recurring}, {@code paused} and {@code queued}; any other status is
     * a {@code 422 validation_error}.
     *
     * <p>Which of two outcomes you get depends on how far the send had got:
     * <ul>
     *   <li>{@code scheduled} / {@code recurring} / {@code paused} &rarr; back
     *       to {@code draft}: nothing was mailed, so it stays editable and
     *       re-sendable.</li>
     *   <li>{@code queued} (already fanning out) &rarr; {@code canceled}, which
     *       is TERMINAL. Copies already handed to the mail service cannot be
     *       recalled; what this stops is every REMAINING recipient — for a
     *       staggered campaign, every future batch-day. A canceled campaign can
     *       never be edited ({@code PATCH} answers "Only a draft campaign can
     *       be edited.") or re-sent.</li>
     * </ul>
     *
     * <p>Read {@code res.getString("status")} to see which happened rather than
     * assuming.
     * {@code POST /campaigns/:id/cancel}
     */
    public SendPingResponse cancel(String id) {
        return api.request("POST", "/campaigns/" + enc(id) + "/cancel");
    }

    /** Per-campaign analytics (counts, engagement rates, top links). {@code GET /campaigns/:id/stats} */
    public SendPingResponse stats(String id) {
        return api.request("GET", "/campaigns/" + enc(id) + "/stats");
    }

    /**
     * Who opened / clicked / replied, per contact. Each of the three lists is
     * hard-capped at 500 rows and this route is not paginated.
     * {@code GET /campaigns/:id/engagement}
     */
    public SendPingResponse engagement(String id) {
        return api.request("GET", "/campaigns/" + enc(id) + "/engagement");
    }

    /**
     * A/B winner evaluation for an A/B campaign. A campaign that is not an A/B
     * test answers {@code 422 validation_error}. Note the deliberately
     * camelCase {@code zScore} / {@code pValue} fields in the result.
     * {@code GET /campaigns/:id/ab}
     */
    public SendPingResponse ab(String id) {
        return api.request("GET", "/campaigns/" + enc(id) + "/ab");
    }

    /** {@code DELETE /campaigns/:id} */
    public SendPingResponse remove(String id) {
        return api.request("DELETE", "/campaigns/" + enc(id));
    }
}
