"""Automations resource — DOMAIN-FIRST: every automation belongs to one of
your sending domains (``domain`` is REQUIRED on create). Only ``Events.send``
calls with the same ``domain`` trigger it."""

from typing import Any, Dict, List, TypedDict

from . import http_client
from .http_client import build_query, paginate, path_escape as _e


class CreateParams(TypedDict, total=False):
    name: str  # required
    domain: str  # REQUIRED: the sending domain this automation belongs to
    trigger: str  # e.g. 'contact.created', 'sendping:schedule', 'email.opened', or a custom event name
    # {'at': ISO 8601 instant, 'timezone': IANA name} — required with the
    # 'sendping:schedule' trigger; not accepted on any other.
    trigger_config: Dict[str, str]
    status: str  # 'enabled' | 'disabled' (default 'disabled')
    steps: List[Dict[str, Any]]  # optional inline step graph
    connections: List[Dict[str, str]]  # optional typed edges between step keys


class UpdateParams(TypedDict, total=False):
    name: str
    status: str  # 'enabled' | 'disabled'
    domain: str  # re-point at another domain (disabled automations only)
    # Re-point the trigger (disabled automations only) — same vocabulary as
    # create. Changing it away from 'sendping:schedule' clears trigger_config.
    trigger: str
    trigger_key: str  # graph key the trigger node is addressed by (default 'trigger')
    # {'at', 'timezone'} — update the 'sendping:schedule' trigger's schedule.
    trigger_config: Dict[str, str]
    connections: List[Dict[str, str]]  # disabled automations only


class AddStepParams(TypedDict, total=False):
    # 'trigger' is NOT a step type here — the trigger is set on the automation
    # itself. Documented names ('send_email', 'wait_for_event') and internal
    # ones ('send', 'wait') are both accepted.
    type: str  # required: 'delay' | 'send_email' | 'wait_for_event' | 'condition' | 'split' | 'add_to_segment' | 'contact_update' | 'contact_delete'
    config: Dict[str, Any]
    key: str


class UpdateStepParams(TypedDict, total=False):
    # REQUIRED on every call: the PATCH re-validates the WHOLE step with the
    # same validator the add path uses, so a body without `type` is a 422
    # ("type must be one of: ...") — it does not mean "leave the type alone".
    # Resend the step's current type even when only `config` changes.
    type: str
    config: Dict[str, Any]  # REPLACES the stored config wholesale; omissions are dropped
    # No `key` here: a step's graph key is fixed at creation so the connections
    # referencing it keep working. Pass `key` to add_step, or delete and re-add
    # the step to re-key it.


class RunListParams(TypedDict, total=False):
    limit: int
    after: str
    before: str
    status: str  # comma-separated, e.g. 'running,failed'


class AiParams(TypedDict, total=False):
    prompt: str  # required, max 2000 characters
    template_ids: List[str]  # first 10 kept
    events: List[str]  # first 10 kept
    # {'from': step or trigger key, 'type'?: edge type, 'before'?: step key} —
    # supplying it APPENDS to the existing graph; omitting it builds a whole
    # workflow and requires the automation to have no steps yet.
    attach: Dict[str, str]


class Automations:
    """``sendping.Automations`` — the /automations endpoints."""

    CreateParams = CreateParams
    UpdateParams = UpdateParams
    AddStepParams = AddStepParams
    UpdateStepParams = UpdateStepParams
    RunListParams = RunListParams
    AiParams = AiParams

    @classmethod
    def create(cls, params):
        """Create an automation (``domain`` is required). POST /automations"""
        return http_client.request("POST", "/automations", params)

    @classmethod
    def get(cls, automation_id):
        """Retrieve an automation (with steps/connections/enrollments).
        GET /automations/:id"""
        return http_client.request("GET", f"/automations/{_e(automation_id)}")

    @classmethod
    def list(cls, params=None):
        """List automations. GET /automations"""
        return http_client.request("GET", f"/automations{paginate(params)}")

    @classmethod
    def update(cls, automation_id, params):
        """Update an automation. PATCH /automations/:id"""
        return http_client.request("PATCH", f"/automations/{_e(automation_id)}", params)

    @classmethod
    def add_step(cls, automation_id, params):
        """Append a step to an automation. The automation must be DISABLED —
        editing the graph of an enabled automation is a 422.
        POST /automations/:id/steps"""
        return http_client.request("POST", f"/automations/{_e(automation_id)}/steps", params)

    @classmethod
    def update_step(cls, automation_id, step_id, params):
        """Update a step. The automation must be DISABLED. The step is
        REPLACED, not merged: ``type`` is required on every call (a body
        without it is a 422, even when only ``config`` changes) and ``config``
        overwrites the stored config wholesale. A step's graph ``key`` is
        create-only — it is ignored here and the response echoes the STORED key
        back, so use ``add_step`` with a ``key``, or delete and re-add the step,
        to change it. PATCH /automations/:id/steps/:step_id"""
        return http_client.request(
            "PATCH", f"/automations/{_e(automation_id)}/steps/{_e(step_id)}", params
        )

    @classmethod
    def delete_step(cls, automation_id, step_id):
        """Delete a step from an automation. The automation must be DISABLED.
        DELETE /automations/:id/steps/:step_id"""
        return http_client.request(
            "DELETE", f"/automations/{_e(automation_id)}/steps/{_e(step_id)}"
        )

    @classmethod
    def create_with_ai(cls, automation_id, params):
        """Build or extend an automation's steps from a natural-language
        ``prompt`` ("Create with AI"). Pass ``attach`` to append to an existing
        graph; without it the automation must have no steps yet. The automation
        must be stopped, and this route is limited to 20 requests per minute
        per account. POST /automations/:id/ai"""
        return http_client.request("POST", f"/automations/{_e(automation_id)}/ai", params)

    @classmethod
    def runs(cls, automation_id, params=None):
        """List an automation's runs, optionally filtered to a comma-separated
        ``status`` list (e.g. ``'running,failed'``).
        GET /automations/:id/runs"""
        params = params or {}
        qs = build_query(
            {
                "limit": params.get("limit"),
                "after": params.get("after"),
                "before": params.get("before"),
                "status": params.get("status"),
            }
        )
        return http_client.request("GET", f"/automations/{_e(automation_id)}/runs{qs}")

    @classmethod
    def get_run(cls, automation_id, run_id):
        """Retrieve a single automation run (with its step trace).
        GET /automations/:id/runs/:run_id"""
        return http_client.request(
            "GET", f"/automations/{_e(automation_id)}/runs/{_e(run_id)}"
        )

    @classmethod
    def stop(cls, automation_id):
        """Stop an automation — prevents new runs; in-progress runs finish.
        POST /automations/:id/stop"""
        return http_client.request("POST", f"/automations/{_e(automation_id)}/stop")

    @classmethod
    def remove(cls, automation_id):
        """Delete an automation. DELETE /automations/:id"""
        return http_client.request("DELETE", f"/automations/{_e(automation_id)}")
