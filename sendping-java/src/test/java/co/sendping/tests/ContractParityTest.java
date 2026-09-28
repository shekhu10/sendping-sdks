package co.sendping.tests;

import co.sendping.ListParams;
import co.sendping.SendPing;
import co.sendping.SendPingException;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.requests.AutomationConnection;
import co.sendping.requests.AutomationStep;
import co.sendping.requests.CreateContactRequest;
import co.sendping.requests.ImportContactsRequest;
import co.sendping.requests.ListAutomationRunsParams;
import co.sendping.requests.ListEmailsParams;
import co.sendping.requests.UpdateAutomationRequest;
import co.sendping.requests.UpdateAutomationStepRequest;
import co.sendping.requests.UpdateEventRequest;

import java.nio.charset.StandardCharsets;

/**
 * Coverage for the endpoints, query params and error fields added in 2.0.0 to
 * close gaps against the live API contract, plus the cross-cutting rules every
 * request must satisfy (Bearer auth, mandatory User-Agent, error envelope).
 */
public final class ContractParityTest {
    public static void run() {
        Check.suite("ContractParityTest");
        StubTransport t = new StubTransport();
        SendPing mb = new SendPing("mb_test_key", "https://api.test", t);
        t.respond(200, "{}");

        // --- GET /emails filters: status + search are server-side ---
        mb.emails().list(ListEmailsParams.builder()
                .status("bounced")
                .search("acme.com")
                .build());
        Check.eq("emails list status+search url",
                "https://api.test/emails?status=bounced&search=acme.com", t.lastUrl);
        mb.emails().list(ListEmailsParams.builder().folder(ListEmailsParams.FOLDER_OUTBOX).build());
        Check.eq("emails list folder url",
                "https://api.test/emails?folder=outbox", t.lastUrl);
        mb.emails().list(ListEmailsParams.builder()
                .limit(50).domainId("dom_1").source("individual").build());
        Check.eq("emails list source filters url",
                "https://api.test/emails?limit=50&source=individual&domain_id=dom_1", t.lastUrl);

        // --- GET /emails/sources ---
        mb.emails().sources();
        Check.eq("emails sources url", "https://api.test/emails/sources", t.lastUrl);
        Check.eq("emails sources method", "GET", t.lastMethod);

        // --- GET /emails/receiving/addresses (must NOT collide with /receiving/:id) ---
        mb.emails().receiving().listAddresses();
        Check.eq("receiving addresses url", "https://api.test/emails/receiving/addresses", t.lastUrl);

        // --- received attachments are paginated (forceLimit=false upstream) ---
        mb.emails().receiving().listAttachments("re_1");
        Check.eq("receiving attachments unpaged url",
                "https://api.test/emails/receiving/re_1/attachments", t.lastUrl);
        mb.emails().receiving().listAttachments("re_1", ListParams.builder().limit(10).build());
        Check.eq("receiving attachments paged url",
                "https://api.test/emails/receiving/re_1/attachments?limit=10", t.lastUrl);

        // --- PATCH /events/:id updates the schema; the name is immutable ---
        mb.events().update("evt_1", UpdateEventRequest.builder()
                .schema("plan", "string").schema("seats", "number").build());
        Check.eq("event update method", "PATCH", t.lastMethod);
        Check.eq("event update url", "https://api.test/events/evt_1", t.lastUrl);
        Check.eq("event update body",
                "{\"schema\":{\"plan\":\"string\",\"seats\":\"number\"}}", t.lastBody);
        mb.events().update("evt_1", UpdateEventRequest.builder().clearSchema().build());
        Check.eq("event clear schema body", "{\"schema\":null}", t.lastBody);

        // --- GET /api-keys, paginated (the only api-key route the SDK speaks) ---
        mb.apiKeys().list(ListParams.builder().limit(5).build());
        Check.eq("apiKey paged list method", "GET", t.lastMethod);
        Check.eq("apiKey paged list url", "https://api.test/api-keys?limit=5", t.lastUrl);

        // --- GET /domains/mx-check ---
        mb.domains().mxCheck("example.com");
        Check.eq("mxCheck url", "https://api.test/domains/mx-check?name=example.com", t.lastUrl);
        Check.eq("mxCheck method", "GET", t.lastMethod);

        // --- GET /domains/:id/records.csv streams text/csv, not JSON ---
        String csv = "Type,Host,Full name,Value,Priority,TTL,Purpose,Status\r\n";
        t.respondBytes(200, csv.getBytes(StandardCharsets.UTF_8));
        Check.eq("recordsCsv body", csv, mb.domains().recordsCsv("dom_1"));
        Check.eq("recordsCsv url", "https://api.test/domains/dom_1/records.csv", t.lastUrl);
        t.respond(200, "{}");

        // --- GET /campaigns/:id/engagement ---
        mb.campaigns().engagement("cmp_1");
        Check.eq("engagement url", "https://api.test/campaigns/cmp_1/engagement", t.lastUrl);

        // --- automations: step edits, run filters, AI ---
        mb.automations().updateStep("auto_1", "step_2", UpdateAutomationStepRequest.builder()
                .type("delay").config("duration", "3 days").build());
        Check.eq("updateStep method", "PATCH", t.lastMethod);
        Check.eq("updateStep url", "https://api.test/automations/auto_1/steps/step_2", t.lastUrl);
        Check.eq("updateStep body",
                "{\"type\":\"delay\",\"config\":{\"duration\":\"3 days\"}}", t.lastBody);
        // updateStep must NOT take the create-time AutomationStep builder. The
        // PATCH route forwards only type/config to storage (lib/automations/
        // crud.ts updateStep) and validateStep never reads a top-level `key`,
        // so a key sent there is a SILENT no-op — 200 back, with the STORED key
        // echoed in the response, which reads as a successful re-key. Asserted
        // reflectively so re-adding a key() setter fails here, not in prod.
        Class<?> updateBody = null;
        for (java.lang.reflect.Method m : co.sendping.resources.Automations.class.getMethods()) {
            if (m.getName().equals("updateStep") && m.getParameterCount() == 3) {
                updateBody = m.getParameterTypes()[2];
            }
        }
        Check.isTrue("updateStep takes a dedicated body type, not create's AutomationStep",
                updateBody != null && !AutomationStep.class.equals(updateBody));
        boolean updateBodyHasKey = false;
        if (updateBody != null) {
            for (Class<?> nested : updateBody.getDeclaredClasses()) {
                for (java.lang.reflect.Method m : nested.getMethods()) {
                    if (m.getName().equals("key")) updateBodyHasKey = true;
                }
            }
        }
        Check.isTrue("updateStep's body exposes no key() setter — PATCH ignores key",
                !updateBodyHasKey);
        // The asymmetry is deliberate: POST /automations/:id/steps DOES honour
        // `key` (crud.ts addStep inserts COALESCE(key, id)), so create keeps it.
        mb.automations().addStep("auto_1", AutomationStep.builder()
                .key("welcome_v2").type("wait").config("duration", "2 days").build());
        Check.contains("addStep still sends key", t.lastBody, "\"key\":\"welcome_v2\"");

        mb.automations().runs("auto_1", ListAutomationRunsParams.builder()
                .limit(50).status("failed", "running").build());
        Check.eq("runs status filter url",
                "https://api.test/automations/auto_1/runs?limit=50&status=failed%2Crunning", t.lastUrl);
        mb.automations().runs("auto_1", ListAutomationRunsParams.builder().status("completed").build());
        Check.eq("runs single status url",
                "https://api.test/automations/auto_1/runs?status=completed", t.lastUrl);

        // Branch edges out of a condition step. `next`/`default`,
        // `condition_met`, `condition_not_met`, `event_received` and `timeout`
        // are the ONLY types the API accepts (lib/automations/validation.ts).
        mb.automations().update("auto_1", UpdateAutomationRequest.builder()
                .connection(AutomationConnection.of("c1", "s2", "condition_met"))
                .connection(AutomationConnection.of("c1", "s3", "condition_not_met"))
                .connection(AutomationConnection.of("s3", "s4"))
                .build());
        Check.eq("automation connection types body",
                "{\"connections\":[{\"from\":\"c1\",\"to\":\"s2\",\"type\":\"condition_met\"},"
                        + "{\"from\":\"c1\",\"to\":\"s3\",\"type\":\"condition_not_met\"},"
                        + "{\"from\":\"s3\",\"to\":\"s4\"}]}",
                t.lastBody);

        mb.automations().createWithAi("auto_1", "welcome new signups over three days");
        Check.eq("ai url", "https://api.test/automations/auto_1/ai", t.lastUrl);
        Check.eq("ai body", "{\"prompt\":\"welcome new signups over three days\"}", t.lastBody);

        // --- pagination reaches the nested contact/segment lists ---
        mb.segments().contacts("seg_1", ListParams.builder().limit(100).build());
        Check.eq("segment contacts paged url",
                "https://api.test/segments/seg_1/contacts?limit=100", t.lastUrl);
        mb.contacts().listSegments("c_1", ListParams.builder().limit(5).build());
        Check.eq("contact segments paged url",
                "https://api.test/contacts/c_1/segments?limit=5", t.lastUrl);
        mb.contacts().getTopics("c_1", ListParams.builder().limit(5).build());
        Check.eq("contact topics paged url",
                "https://api.test/contacts/c_1/topics?limit=5", t.lastUrl);

        // --- CSV direct-upload flow ---
        mb.contacts().createImportUpload("aud_1", "contacts.csv", 1048576L);
        Check.eq("import upload url",
                "https://api.test/audiences/aud_1/contacts/import/upload", t.lastUrl);
        Check.eq("import upload body",
                "{\"filename\":\"contacts.csv\",\"size\":1048576}", t.lastBody);
        mb.contacts().importCsv(ImportContactsRequest.builder()
                .audienceId("aud_1").storageKey("uploads/k_1").segmentId("seg_1").build());
        Check.eq("import by storage key url",
                "https://api.test/audiences/aud_1/contacts/import?segment_id=seg_1", t.lastUrl);
        Check.eq("import by storage key body", "{\"storage_key\":\"uploads/k_1\"}", t.lastBody);

        // csv and storageKey are mutually exclusive, and one is required.
        Check.isTrue("import rejects csv + storageKey", throwsIllegalState(() ->
                ImportContactsRequest.builder()
                        .audienceId("aud_1").csv("email\na@b.com").storageKey("k").build()));
        Check.isTrue("import requires csv or storageKey", throwsIllegalState(() ->
                ImportContactsRequest.builder().audienceId("aud_1").build()));

        // --- a domain-less flat contact create omits the key entirely ---
        mb.contacts().create(CreateContactRequest.builder().email("a@b.com").build());
        Check.eq("domainless create url", "https://api.test/contacts", t.lastUrl);
        Check.notContains("domainless create omits null domain", t.lastBody, "domain");

        // --- cross-cutting: Bearer auth + non-empty User-Agent on every request ---
        Check.eq("bearer header", "Bearer mb_test_key", t.lastHeaders.get("Authorization"));
        Check.isTrue("user-agent header is non-empty",
                t.lastHeaders.get("User-Agent") != null
                        && !t.lastHeaders.get("User-Agent").trim().isEmpty());
        Check.isTrue("blank user-agent is rejected at construction", throwsIllegalArgument(() ->
                new ApiClient("mb_test_key", "https://api.test", "   ", t)));

        // --- error envelope: name + real HTTP status + additive `limit` ---
        t.respond(429, "{\"statusCode\":429,\"name\":\"daily_quota_exceeded\","
                + "\"message\":\"Daily send limit reached.\","
                + "\"limit\":{\"kind\":\"emails_daily\",\"used\":100,\"limit\":100,"
                + "\"remaining\":0,\"period\":\"24h\","
                + "\"plan\":{\"id\":\"free\",\"name\":\"Free\"},"
                + "\"next_plan\":{\"id\":\"pro\",\"name\":\"Pro\"}}}");
        try {
            mb.emails().sources();
            Check.isTrue("quota error throws", false);
        } catch (SendPingException e) {
            Check.eq("quota error status", 429, e.getStatusCode());
            Check.eq("quota error name", "daily_quota_exceeded", e.getName());
            Check.isTrue("quota error exposes limit", e.getLimit() != null);
            Check.eq("quota error limit.kind", "emails_daily", e.get("limit.kind"));
            Check.eq("quota error next plan", "Pro", e.get("limit.next_plan.name"));
            Check.isNull("quota error unknown path", e.get("limit.credits.balance"));
            // Extras that do not belong to this error read as absent, never as
            // an empty stand-in the caller might act on.
            Check.isNull("quota error has no reputation", e.getReputation());
            Check.isNull("quota error has no sent list", e.getSent());
            Check.isNull("quota error has no sent_count", e.getSentCount());
        }

        // --- additive `reputation` on a reputation gate ---
        t.respond(429, "{\"statusCode\":429,\"name\":\"reputation_limit_exceeded\","
                + "\"message\":\"Sending capacity reached.\","
                + "\"reputation\":{\"retryable\":true,\"scope\":\"domain\","
                + "\"scope_key\":\"x.com\",\"hourly_limit\":100,\"hourly_used\":100}}");
        try {
            mb.emails().sources();
            Check.isTrue("reputation error throws", false);
        } catch (SendPingException e) {
            Check.eq("reputation error name", "reputation_limit_exceeded", e.getName());
            Check.isTrue("reputation error exposes reputation", e.getReputation() != null);
            Check.eq("reputation scope", "domain", e.get("reputation.scope"));
            Check.eq("reputation retryable", Boolean.TRUE, e.get("reputation.retryable"));
            Check.isNull("reputation error has no limit", e.getLimit());
        }

        // --- partial batch failure: `sent` names what already went out ---
        t.respond(429, "{\"statusCode\":429,\"name\":\"daily_quota_exceeded\","
                + "\"message\":\"Daily send limit reached.\","
                + "\"sent\":[{\"id\":\"e-1\"},{\"id\":\"e-2\"}],\"sent_count\":2}");
        try {
            mb.emails().sources();
            Check.isTrue("partial batch error throws", false);
        } catch (SendPingException e) {
            Check.isTrue("partial batch exposes sent", e.getSent() != null);
            Check.eq("partial batch sent size", 2, e.getSent().size());
            Check.eq("partial batch first sent id", "e-1", e.get("sent.0.id"));
            Check.eq("partial batch sent_count", Integer.valueOf(2), e.getSentCount());
        }

        // sent_count falls back to the list length when the body omits it, so
        // a caller deciding what NOT to resend never has to compute it.
        t.respond(429, "{\"statusCode\":429,\"name\":\"daily_quota_exceeded\","
                + "\"message\":\"Daily send limit reached.\","
                + "\"sent\":[{\"id\":\"e-1\"},{\"id\":\"e-2\"},{\"id\":\"e-3\"}]}");
        try {
            mb.emails().sources();
            Check.isTrue("partial batch without count throws", false);
        } catch (SendPingException e) {
            Check.eq("sent_count falls back to sent size", Integer.valueOf(3), e.getSentCount());
        }

        // An additive field in a shape this version does not model must cost
        // only that field — never the envelope itself.
        t.respond(429, "{\"statusCode\":429,\"name\":\"daily_quota_exceeded\","
                + "\"message\":\"Daily send limit reached.\","
                + "\"limit\":\"not-an-object\",\"sent\":\"not-a-list\"}");
        try {
            mb.emails().sources();
            Check.isTrue("malformed extras still throw", false);
        } catch (SendPingException e) {
            Check.eq("malformed extras keep status", 429, e.getStatusCode());
            Check.eq("malformed extras keep name", "daily_quota_exceeded", e.getName());
            Check.isNull("malformed limit reads as absent", e.getLimit());
            Check.isNull("malformed sent reads as absent", e.getSent());
            Check.isNull("malformed sent yields no count", e.getSentCount());
        }

        // A missing User-Agent is the one validation_error that is NOT 422 —
        // the status must come off the response, never off the error name.
        t.respond(403, "{\"statusCode\":403,\"name\":\"validation_error\","
                + "\"message\":\"All API requests must include a User-Agent header.\"}");
        try {
            mb.emails().sources();
            Check.isTrue("403 validation_error throws", false);
        } catch (SendPingException e) {
            Check.eq("UA gate status is 403 not 422", 403, e.getStatusCode());
            Check.eq("UA gate name", "validation_error", e.getName());
        }

        // Non-envelope CSRF/rate-limit bodies still surface as a usable error.
        t.respond(403, "{\"error\":\"csrf_failed\"}");
        try {
            mb.emails().sources();
            Check.isTrue("non-envelope error throws", false);
        } catch (SendPingException e) {
            Check.eq("non-envelope status", 403, e.getStatusCode());
            Check.eq("non-envelope name", "csrf_failed", e.getName());
        }

        // A body-less error keeps an empty (never null) body map.
        t.respond(500, "gateway exploded");
        try {
            mb.emails().sources();
            Check.isTrue("non-JSON error throws", false);
        } catch (SendPingException e) {
            Check.isTrue("non-JSON body is empty not null", e.getBody().isEmpty());
        }

        // --- webhooks test delivery: failure is still a 2xx, signalled by `ok` ---
        t.respond(200, "{\"object\":\"webhook_test\",\"id\":\"7\",\"ok\":false,\"error\":\"lookup_failed\"}");
        SendPingResponse probe = mb.webhooks().test("7");
        Check.eq("failed test delivery is 200", 200, probe.statusCode());
        Check.eq("failed test delivery ok flag", Boolean.FALSE, probe.getBoolean("ok"));
        Check.eq("failed test delivery reason", "lookup_failed", probe.getString("error"));

        t.respond(200, "{}");
    }

    private static boolean throwsIllegalState(Runnable r) {
        try {
            r.run();
            return false;
        } catch (IllegalStateException e) {
            return true;
        }
    }

    private static boolean throwsIllegalArgument(Runnable r) {
        try {
            r.run();
            return false;
        } catch (IllegalArgumentException e) {
            return true;
        }
    }

    public static void main(String[] args) {
        run();
        Check.finish();
    }
}
