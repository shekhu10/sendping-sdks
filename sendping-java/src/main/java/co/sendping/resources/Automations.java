package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.http.Query;
import co.sendping.requests.AutomationAiRequest;
import co.sendping.requests.AutomationStep;
import co.sendping.requests.CreateAutomationRequest;
import co.sendping.requests.ListAutomationRunsParams;
import co.sendping.requests.UpdateAutomationRequest;
import co.sendping.requests.UpdateAutomationStepRequest;

/**
 * Automations (DOMAIN-FIRST) — {@code domain} is REQUIRED on create; only
 * {@code events().send(...)} calls carrying the same domain trigger them.
 */
public final class Automations extends Resource {
    public Automations(ApiClient api) { super(api); }

    /** {@code POST /automations} — {@code domain} is required on the request. */
    public SendPingResponse create(CreateAutomationRequest request) {
        return api.request("POST", "/automations", request);
    }

    /** {@code GET /automations/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/automations/" + enc(id));
    }

    /** {@code GET /automations} */
    public SendPingResponse list() { return list(null); }

    public SendPingResponse list(ListParams params) {
        return api.request("GET", "/automations" + paginate(params));
    }

    /** {@code PATCH /automations/:id} */
    public SendPingResponse update(String id, UpdateAutomationRequest request) {
        return api.request("PATCH", "/automations/" + enc(id), request);
    }

    /**
     * Append a step. The automation must be DISABLED first, and the trigger is
     * set on the automation rather than added as a step (both are 422s).
     * {@code POST /automations/:id/steps}
     */
    public SendPingResponse addStep(String id, AutomationStep step) {
        return api.request("POST", "/automations/" + enc(id) + "/steps", step);
    }

    /**
     * Replace a step's type and config. The automation must be DISABLED first,
     * and {@code type} is required even when only the config changes — the
     * step's graph {@code key} and {@code position} are NOT editable here, see
     * {@link UpdateAutomationStepRequest}.
     * {@code PATCH /automations/:id/steps/:stepId}
     */
    public SendPingResponse updateStep(String id, String stepId, UpdateAutomationStepRequest step) {
        return api.request("PATCH", "/automations/" + enc(id) + "/steps/" + enc(stepId), step);
    }

    /** Delete a step. The automation must be DISABLED first. {@code DELETE /automations/:id/steps/:stepId} */
    public SendPingResponse deleteStep(String id, String stepId) {
        return api.request("DELETE", "/automations/" + enc(id) + "/steps/" + enc(stepId));
    }

    /** List an automation's runs. {@code GET /automations/:id/runs} */
    public SendPingResponse runs(String id) { return runs(id, (ListParams) null); }

    public SendPingResponse runs(String id, ListParams params) {
        return api.request("GET", "/automations/" + enc(id) + "/runs" + paginate(params));
    }

    /**
     * List an automation's runs, optionally filtered by one or more run
     * statuses (filtering is applied before pagination).
     * {@code GET /automations/:id/runs?status=}
     */
    public SendPingResponse runs(String id, ListAutomationRunsParams params) {
        Query q = new Query();
        if (params != null) {
            q.add("limit", params.getLimit())
             .add("after", params.getAfter())
             .add("before", params.getBefore())
             .add("status", params.getStatus());
        }
        return api.request("GET", "/automations/" + enc(id) + "/runs" + q);
    }

    /** Retrieve a single run with its step trace. {@code GET /automations/:id/runs/:runId} */
    public SendPingResponse getRun(String id, String runId) {
        return api.request("GET", "/automations/" + enc(id) + "/runs/" + enc(runId));
    }

    /**
     * Build the automation's steps from a natural-language prompt. Requires a
     * STOPPED automation and spends AI credits.
     * {@code POST /automations/:id/ai}
     */
    public SendPingResponse createWithAi(String id, AutomationAiRequest request) {
        return api.request("POST", "/automations/" + enc(id) + "/ai", request);
    }

    /** Shorthand for {@link #createWithAi(String, AutomationAiRequest)} with just a prompt. */
    public SendPingResponse createWithAi(String id, String prompt) {
        return createWithAi(id, AutomationAiRequest.builder().prompt(prompt).build());
    }

    /** Stop an automation — prevents new runs; in-progress runs finish. {@code POST /automations/:id/stop} */
    public SendPingResponse stop(String id) {
        return api.request("POST", "/automations/" + enc(id) + "/stop");
    }

    /** {@code DELETE /automations/:id} */
    public SendPingResponse remove(String id) {
        return api.request("DELETE", "/automations/" + enc(id));
    }
}
