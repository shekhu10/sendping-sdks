package co.sendping.tests;

import co.sendping.ListParams;
import co.sendping.SendPing;
import co.sendping.json.Json;
import co.sendping.requests.AutomationConnection;
import co.sendping.requests.AutomationStep;
import co.sendping.requests.CreateAutomationRequest;
import co.sendping.requests.CreateContactPropertyRequest;
import co.sendping.requests.CreateEventRequest;
import co.sendping.requests.CreateTemplateRequest;
import co.sendping.requests.ListLogsParams;
import co.sendping.requests.TemplateVariable;
import co.sendping.requests.UpdateAutomationRequest;
import co.sendping.resources.ApiKeys;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

/** Templates, automations, audiences, api keys, logs, polls, contact properties, events defs + JSON round-trip. */
public final class MiscResourcesTest {
    public static void run() {
        Check.suite("MiscResourcesTest");
        StubTransport t = new StubTransport();
        SendPing mb = new SendPing("mb_test_key", "https://api.test", t);
        t.respond(200, "{\"id\":\"x_1\"}");

        // --- templates ---
        mb.templates().create(CreateTemplateRequest.builder()
                .name("Welcome").alias("welcome").subject("Hi {{first_name}}")
                .html("<p>Welcome!</p>")
                .variable(TemplateVariable.of("first_name", "string", "there"))
                .build());
        Check.eq("template create url", "https://api.test/templates", t.lastUrl);
        Check.contains("template variables", t.lastBody,
                "\"variables\":[{\"key\":\"first_name\",\"type\":\"string\",\"fallback_value\":\"there\"}]");
        mb.templates().duplicate("tpl_1");
        Check.eq("template duplicate url", "https://api.test/templates/tpl_1/duplicate", t.lastUrl);
        Check.eq("template duplicate default body", "{}", t.lastBody);
        mb.templates().publish("tpl_1");
        Check.eq("template publish url", "https://api.test/templates/tpl_1/publish", t.lastUrl);

        // --- automations: domain-first create with inline graph ---
        mb.automations().create(CreateAutomationRequest.builder()
                .name("Welcome series")
                .domain("yourdomain.com")
                .status("enabled")
                // A steps[0] trigger step names its event in `config.event_name`
                // — that is the only key the API reads it from (`config.event`
                // is silently ignored and the automation keeps the default
                // trigger).
                .step(AutomationStep.builder().key("t1").type("trigger").config("event_name", "contact.created").build())
                .step(AutomationStep.builder().key("s1").type("send_email").config("template_id", "tpl_1").build())
                .connection(AutomationConnection.of("t1", "s1", "next"))
                .build());
        Check.eq("automation create url", "https://api.test/automations", t.lastUrl);
        Check.contains("automation domain", t.lastBody, "\"domain\":\"yourdomain.com\"");
        Check.contains("automation steps", t.lastBody,
                "\"steps\":[{\"key\":\"t1\",\"type\":\"trigger\",\"config\":{\"event_name\":\"contact.created\"}},"
                        + "{\"key\":\"s1\",\"type\":\"send_email\",\"config\":{\"template_id\":\"tpl_1\"}}]");
        Check.contains("automation connections", t.lastBody,
                "\"connections\":[{\"from\":\"t1\",\"to\":\"s1\",\"type\":\"next\"}]");
        mb.automations().addStep("auto_1", AutomationStep.builder().type("wait").config("duration", "2 days").build());
        Check.eq("addStep url", "https://api.test/automations/auto_1/steps", t.lastUrl);
        mb.automations().deleteStep("auto_1", "step_2");
        Check.eq("deleteStep url", "https://api.test/automations/auto_1/steps/step_2", t.lastUrl);
        mb.automations().runs("auto_1", ListParams.builder().limit(25).build());
        Check.eq("runs url", "https://api.test/automations/auto_1/runs?limit=25", t.lastUrl);
        mb.automations().getRun("auto_1", "run_1");
        Check.eq("getRun url", "https://api.test/automations/auto_1/runs/run_1", t.lastUrl);
        mb.automations().stop("auto_1");
        Check.eq("stop url", "https://api.test/automations/auto_1/stop", t.lastUrl);
        mb.automations().update("auto_1", UpdateAutomationRequest.builder().status("disabled").build());
        Check.eq("automation update body", "{\"status\":\"disabled\"}", t.lastBody);
        // PATCH /automations/:id accepts a new `trigger` (and the `trigger_key`
        // that connections reference) on a disabled automation.
        mb.automations().update("auto_1", UpdateAutomationRequest.builder()
                .trigger("signup.completed").triggerKey("start").build());
        Check.eq("automation update trigger body",
                "{\"trigger\":\"signup.completed\",\"trigger_key\":\"start\"}", t.lastBody);
        mb.automations().update("auto_1", UpdateAutomationRequest.builder()
                .trigger("sendping:schedule")
                .triggerConfig("2026-09-01T13:00:00.000Z", "America/New_York").build());
        Check.eq("automation update schedule trigger body",
                "{\"trigger\":\"sendping:schedule\",\"trigger_config\":"
                        + "{\"at\":\"2026-09-01T13:00:00.000Z\",\"timezone\":\"America/New_York\"}}",
                t.lastBody);

        // --- audiences (incl. sheet import) ---
        mb.audiences().create("Newsletter");
        Check.eq("audience create body", "{\"name\":\"Newsletter\"}", t.lastBody);
        mb.audiences().importSheet("aud_1", "https://docs.google.com/spreadsheets/d/x", "Imported");
        Check.eq("importSheet url", "https://api.test/audiences/aud_1/contacts/import-sheet", t.lastUrl);
        Check.eq("importSheet body",
                "{\"url\":\"https://docs.google.com/spreadsheets/d/x\",\"segment_name\":\"Imported\"}", t.lastBody);

        // --- contact properties ---
        mb.contactProperties().create(CreateContactPropertyRequest.builder()
                .key("plan").type("string").fallbackValue("free").build());
        Check.eq("property create body",
                "{\"key\":\"plan\",\"type\":\"string\",\"fallback_value\":\"free\"}", t.lastBody);
        mb.contactProperties().update("prop_1", 42);
        Check.eq("property update body", "{\"fallback_value\":42}", t.lastBody);
        mb.contactProperties().update("prop_2", null);
        Check.eq("property clear body", "{\"fallback_value\":null}", t.lastBody);

        // --- event definitions ---
        mb.events().create(CreateEventRequest.builder()
                .name("signup.completed").schema("plan", "string").schema("seats", "number").build());
        Check.eq("event def url", "https://api.test/events", t.lastUrl);
        Check.eq("event def body",
                "{\"name\":\"signup.completed\",\"schema\":{\"plan\":\"string\",\"seats\":\"number\"}}",
                t.lastBody);
        mb.events().remove("evt_1");
        Check.eq("event def remove url", "https://api.test/events/evt_1", t.lastUrl);

        // --- api keys (listing only; lifecycle is dashboard-only) ---
        mb.apiKeys().list();
        Check.eq("apiKey list url", "https://api.test/api-keys", t.lastUrl);
        Check.eq("apiKey list method", "GET", t.lastMethod);
        // Minting, re-scoping and revoking keys are dashboard-only operations, so
        // ApiKeys exposes list() and nothing else. In Java this is enforced at
        // compile time — calling apiKeys().create(...) would not compile — and
        // the reflection sweep below keeps the surface from growing back.
        Set<String> apiKeyMethods = new TreeSet<>();
        for (Method m : ApiKeys.class.getDeclaredMethods()) {
            if (Modifier.isPublic(m.getModifiers())) apiKeyMethods.add(m.getName());
        }
        Check.eq("ApiKeys public surface is list() only", "[list]", apiKeyMethods.toString());

        // --- logs with filters ---
        mb.logs().list(ListLogsParams.builder().limit(100).method("POST").status(429).build());
        Check.eq("logs list url", "https://api.test/logs?limit=100&method=POST&status=429", t.lastUrl);
        mb.logs().get("log_1");
        Check.eq("logs get url", "https://api.test/logs/log_1", t.lastUrl);

        // --- polls ---
        mb.polls().list();
        Check.eq("polls list url", "https://api.test/polls", t.lastUrl);
        mb.polls().get("em_1");
        Check.eq("polls get url", "https://api.test/polls/em_1", t.lastUrl);

        // --- JSON round-trip sanity ---
        Object parsed = Json.parse("{\"a\":[1,2.5,\"x\\ny\",true,null],\"b\":{\"c\":\"\\u00e9\"}}");
        Check.isTrue("parse returns map", parsed instanceof Map);
        Check.eq("parse nested unicode", "é", ((Map<?, ?>) ((Map<?, ?>) parsed).get("b")).get("c"));
        Check.eq("write round-trip",
                "{\"a\":[1,2.5,\"x\\ny\",true,null],\"b\":{\"c\":\"é\"}}", Json.write(parsed));
    }

    public static void main(String[] args) {
        run();
        Check.finish();
    }
}
