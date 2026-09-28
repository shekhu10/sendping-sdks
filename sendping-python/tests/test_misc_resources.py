import sendping

from .helpers import RecordingTestCase


class TestAudiences(RecordingTestCase):
    def test_crud(self):
        sendping.Audiences.create({"name": "General"})
        self.assertCall("POST", "/audiences", {"name": "General"})
        sendping.Audiences.get("aud_1")
        self.assertCall("GET", "/audiences/aud_1")
        sendping.Audiences.list({"limit": 5})
        self.assertCall("GET", "/audiences?limit=5")
        sendping.Audiences.update("aud_1", {"name": "Renamed"})
        self.assertCall("PATCH", "/audiences/aud_1", {"name": "Renamed"})
        sendping.Audiences.remove("aud_1")
        self.assertCall("DELETE", "/audiences/aud_1")

    def test_import_sheet(self):
        payload = {"url": "https://docs.google.com/spreadsheets/d/x", "segment_name": "Sheet"}
        sendping.Audiences.import_sheet("aud_1", payload)
        self.assertCall("POST", "/audiences/aud_1/contacts/import-sheet", payload)


class TestContactProperties(RecordingTestCase):
    def test_crud(self):
        sendping.ContactProperties.create({"key": "plan", "type": "string"})
        self.assertCall("POST", "/contact-properties", {"key": "plan", "type": "string"})
        sendping.ContactProperties.get("prop_1")
        self.assertCall("GET", "/contact-properties/prop_1")
        sendping.ContactProperties.list()
        self.assertCall("GET", "/contact-properties")
        sendping.ContactProperties.update("prop_1", {"fallback_value": "free"})
        self.assertCall("PATCH", "/contact-properties/prop_1", {"fallback_value": "free"})
        sendping.ContactProperties.remove("prop_1")
        self.assertCall("DELETE", "/contact-properties/prop_1")


class TestTemplates(RecordingTestCase):
    def test_crud(self):
        params = {"name": "Welcome", "subject": "Hi {{first_name}}", "html": "<p>Hi</p>"}
        sendping.Templates.create(params)
        self.assertCall("POST", "/templates", params)
        sendping.Templates.get("tmpl_1")
        self.assertCall("GET", "/templates/tmpl_1")
        sendping.Templates.list({"limit": 10})
        self.assertCall("GET", "/templates?limit=10")
        sendping.Templates.update("tmpl_1", {"name": "Welcome v2"})
        self.assertCall("PATCH", "/templates/tmpl_1", {"name": "Welcome v2"})
        sendping.Templates.remove("tmpl_1")
        self.assertCall("DELETE", "/templates/tmpl_1")

    def test_duplicate_defaults_to_empty_body(self):
        sendping.Templates.duplicate("tmpl_1")
        self.assertCall("POST", "/templates/tmpl_1/duplicate", {})
        sendping.Templates.duplicate("tmpl_1", {"name": "Copy"})
        self.assertCall("POST", "/templates/tmpl_1/duplicate", {"name": "Copy"})

    def test_publish(self):
        sendping.Templates.publish("tmpl_1")
        self.assertCall("POST", "/templates/tmpl_1/publish")


class TestAutomations(RecordingTestCase):
    def test_create_requires_domain_in_params(self):
        params = {"name": "Welcome series", "domain": "acme.com", "trigger": "contact.created"}
        sendping.Automations.create(params)
        self.assertCall("POST", "/automations", params)

    def test_steps(self):
        step = {"type": "send_email", "config": {"template_id": "tmpl_1"}}
        sendping.Automations.add_step("auto_1", step)
        self.assertCall("POST", "/automations/auto_1/steps", step)
        # `type` is required on every PATCH: the server re-validates the whole
        # step, so a config-only body is a 422. `key` is create-only.
        patch = {"type": "send_email", "config": {"template_id": "tmpl_2"}}
        sendping.Automations.update_step("auto_1", "step_1", patch)
        self.assertCall("PATCH", "/automations/auto_1/steps/step_1", patch)
        sendping.Automations.delete_step("auto_1", "step_1")
        self.assertCall("DELETE", "/automations/auto_1/steps/step_1")

    def test_ai(self):
        params = {"prompt": "Wait 2 days then send the welcome email"}
        sendping.Automations.create_with_ai("auto_1", params)
        self.assertCall("POST", "/automations/auto_1/ai", params)

    def test_runs(self):
        sendping.Automations.runs("auto_1", {"limit": 25})
        self.assertCall("GET", "/automations/auto_1/runs?limit=25")
        sendping.Automations.get_run("auto_1", "run_1")
        self.assertCall("GET", "/automations/auto_1/runs/run_1")

    def test_runs_status_filter(self):
        sendping.Automations.runs("auto_1", {"status": "running,failed"})
        self.assertCall("GET", "/automations/auto_1/runs?status=running%2Cfailed")

    def test_runs_no_params(self):
        sendping.Automations.runs("auto_1")
        self.assertCall("GET", "/automations/auto_1/runs")

    def test_stop_update_remove(self):
        sendping.Automations.stop("auto_1")
        self.assertCall("POST", "/automations/auto_1/stop")
        sendping.Automations.update("auto_1", {"status": "enabled"})
        self.assertCall("PATCH", "/automations/auto_1", {"status": "enabled"})
        sendping.Automations.remove("auto_1")
        self.assertCall("DELETE", "/automations/auto_1")
        sendping.Automations.list()
        self.assertCall("GET", "/automations")


class TestEvents(RecordingTestCase):
    def test_send_domain_required_payload(self):
        params = {
            "event": "signup.completed",
            "domain": "acme.com",
            "email": "user@example.com",
            "payload": {"plan": "pro"},
        }
        sendping.Events.send(params)
        self.assertCall("POST", "/events/send", params)

    def test_send_with_idempotency(self):
        params = {"event": "x", "domain": "acme.com", "email": "a@b.com"}
        sendping.Events.send(params, options={"idempotency_key": "evt-1"})
        self.assertCall("POST", "/events/send", params, {"idempotency_key": "evt-1"})

    def test_definitions(self):
        sendping.Events.create({"name": "signup.completed", "schema": {"plan": "string"}})
        self.assertCall(
            "POST", "/events", {"name": "signup.completed", "schema": {"plan": "string"}}
        )
        sendping.Events.list({"limit": 10})
        self.assertCall("GET", "/events?limit=10")
        sendping.Events.remove("evt_1")
        self.assertCall("DELETE", "/events/evt_1")

    def test_update_schema(self):
        sendping.Events.update("evt_1", {"schema": {"plan": "string", "seats": "number"}})
        self.assertCall(
            "PATCH", "/events/evt_1", {"schema": {"plan": "string", "seats": "number"}}
        )


class TestApiKeys(RecordingTestCase):
    def test_list(self):
        sendping.ApiKeys.list()
        self.assertCall("GET", "/api-keys")

    def test_list_paginated(self):
        sendping.ApiKeys.list({"limit": 10, "after": "41"})
        self.assertCall("GET", "/api-keys?limit=10&after=41")

    def test_lifecycle_is_dashboard_only(self):
        """Keys are created, re-scoped and revoked in the dashboard only, so
        the SDK exposes no method that would reach those endpoints."""
        for name in ("create", "update", "remove", "delete", "revoke"):
            self.assertFalse(
                hasattr(sendping.ApiKeys, name),
                f"ApiKeys.{name} must not exist",
            )


class TestLogs(RecordingTestCase):
    def test_list_with_filters(self):
        sendping.Logs.list({"limit": 100, "method": "POST", "status": 429})
        self.assertCall("GET", "/logs?limit=100&method=POST&status=429")

    def test_list_plain(self):
        sendping.Logs.list()
        self.assertCall("GET", "/logs")

    def test_get(self):
        sendping.Logs.get("log_1")
        self.assertCall("GET", "/logs/log_1")


class TestPolls(RecordingTestCase):
    def test_list_and_get(self):
        sendping.Polls.list({"limit": 10})
        self.assertCall("GET", "/polls?limit=10")
        sendping.Polls.get("em_1")
        self.assertCall("GET", "/polls/em_1")
