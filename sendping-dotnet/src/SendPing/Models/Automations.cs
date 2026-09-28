using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>A step of an automation as returned by the API.</summary>
public class AutomationStep
{
    /// <summary>Absent on the synthesized trigger step.</summary>
    [JsonPropertyName("id")]
    public string? Id { get; set; }

    [JsonPropertyName("key")]
    public string Key { get; set; } = null!;

    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    [JsonPropertyName("position")]
    public int? Position { get; set; }

    [JsonPropertyName("config")]
    public Dictionary<string, JsonElement>? Config { get; set; }
}

/// <summary>A typed edge between two step keys.</summary>
public class AutomationConnection
{
    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    [JsonPropertyName("to")]
    public string To { get; set; } = null!;

    [JsonPropertyName("type")]
    public string? Type { get; set; }
}

/// <summary>An inline step supplied on automation create.</summary>
public class AutomationStepInput
{
    /// <summary>Optional key referenced by connections.</summary>
    [JsonPropertyName("key")]
    public string? Key { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    [JsonPropertyName("config")]
    public Dictionary<string, object?>? Config { get; set; }
}

/// <summary>Enrollment counts (retrieve only).</summary>
public class AutomationEnrollments
{
    [JsonPropertyName("active")]
    public int Active { get; set; }

    [JsonPropertyName("completed")]
    public int Completed { get; set; }
}

/// <summary>An automation (multi-step workflow triggered by an event).</summary>
public class Automation
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "automation";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("audience_id")]
    public string AudienceId { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("trigger")]
    public string? Trigger { get; set; }

    /// <summary>
    /// The sending domain this automation belongs to. Only EventSendAsync calls
    /// with the same domain trigger it. Null on pre-domain rows (treated as the
    /// account's single domain when exactly one exists).
    /// </summary>
    [JsonPropertyName("domain")]
    public string? Domain { get; set; }

    /// <summary><c>enabled</c> | <c>disabled</c>.</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;

    /// <summary>
    /// Schedule of the <c>sendping:schedule</c> trigger; null for every other
    /// trigger.
    /// </summary>
    [JsonPropertyName("trigger_config")]
    public AutomationTriggerConfig? TriggerConfig { get; set; }

    /// <summary>
    /// Key of the synthetic trigger step that <c>connections[].from</c> edges
    /// reference; defaults to the literal <c>trigger</c>.
    /// </summary>
    [JsonPropertyName("trigger_key")]
    public string? TriggerKey { get; set; }

    /// <summary>
    /// The step graph. Omitted entirely on LIST responses (GET /automations) —
    /// retrieve the automation for its steps.
    /// </summary>
    [JsonPropertyName("steps")]
    public List<AutomationStep>? Steps { get; set; }

    [JsonPropertyName("connections")]
    public List<AutomationConnection>? Connections { get; set; }

    /// <summary>Enrollment counts — included only on retrieve (GET /automations/:id).</summary>
    [JsonPropertyName("enrollments")]
    public AutomationEnrollments? Enrollments { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    [JsonPropertyName("updated_at")]
    public string? UpdatedAt { get; set; }
}

/// <summary>
/// Config for the <c>sendping:schedule</c> trigger: the automation fires ONCE
/// at <see cref="At"/>, enrolling every contact of its domain's pool. Required
/// with that trigger; not accepted on any other.
/// </summary>
public class AutomationTriggerConfig
{
    /// <summary>ISO 8601 instant the automation fires (future, at most 366 days ahead).</summary>
    [JsonPropertyName("at")]
    public string At { get; set; } = null!;

    /// <summary>IANA timezone the schedule was picked in (e.g. <c>America/New_York</c>).</summary>
    [JsonPropertyName("timezone")]
    public string Timezone { get; set; } = null!;
}

/// <summary>Payload for creating an automation (POST /automations). <see cref="Domain"/> is REQUIRED.</summary>
public class AutomationCreateOptions
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    /// <summary>
    /// REQUIRED. The sending domain this automation belongs to (e.g.
    /// <c>yourdomain.com</c> — one of your domains). Only EventSendAsync calls
    /// with the same domain trigger it.
    /// </summary>
    [JsonPropertyName("domain")]
    public string Domain { get; set; } = null!;

    /// <summary>
    /// The event that starts a run: <c>contact.created</c>, the built-in
    /// scheduled trigger <c>sendping:schedule</c> (requires
    /// <see cref="TriggerConfig"/>), an engagement event (<c>email.opened</c>,
    /// <c>email.clicked</c>, <c>email.replied</c>, <c>email.bounced</c>,
    /// <c>email.delivered</c>), or any custom event name you send via
    /// EventSendAsync. Usually supplied as a Steps[0] trigger step instead.
    /// </summary>
    [JsonPropertyName("trigger")]
    public string? Trigger { get; set; }

    /// <summary>
    /// Schedule for the <c>sendping:schedule</c> trigger (<c>{at, timezone}</c>).
    /// Required with that trigger; not accepted on any other.
    /// </summary>
    [JsonPropertyName("trigger_config")]
    public AutomationTriggerConfig? TriggerConfig { get; set; }

    /// <summary>Initial status: <c>enabled</c> | <c>disabled</c> (default <c>disabled</c>).</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>Optional inline step graph; each step may carry a Key for connections.</summary>
    [JsonPropertyName("steps")]
    public List<AutomationStepInput>? Steps { get; set; }

    /// <summary>Optional typed edges between step keys.</summary>
    [JsonPropertyName("connections")]
    public List<AutomationConnection>? Connections { get; set; }
}

/// <summary>Payload for updating an automation (PATCH /automations/:id).</summary>
public class AutomationUpdateOptions
{
    [JsonPropertyName("name")]
    public string? Name { get; set; }

    /// <summary><c>enabled</c> | <c>disabled</c>.</summary>
    [JsonPropertyName("status")]
    public string? Status { get; set; }

    /// <summary>Re-point the automation at another of your domains (disabled automations only).</summary>
    [JsonPropertyName("domain")]
    public string? Domain { get; set; }

    /// <summary>
    /// Change the triggering event (disabled automations only). The reserved
    /// <c>sendping:</c> prefix is rejected apart from <c>sendping:schedule</c>.
    /// </summary>
    [JsonPropertyName("trigger")]
    public string? Trigger { get; set; }

    /// <summary>
    /// Rename the trigger step key that <c>connections[].from</c> edges reference.
    /// Only meaningful alongside <see cref="Trigger"/>.
    /// </summary>
    [JsonPropertyName("trigger_key")]
    public string? TriggerKey { get; set; }

    /// <summary>
    /// Update the <c>sendping:schedule</c> trigger's schedule
    /// (<c>{at, timezone}</c>). Only valid on automations with that trigger, and
    /// only while the automation is disabled.
    /// </summary>
    [JsonPropertyName("trigger_config")]
    public AutomationTriggerConfig? TriggerConfig { get; set; }

    [JsonPropertyName("connections")]
    public List<AutomationConnection>? Connections { get; set; }
}

/// <summary>
/// Payload for appending a step (POST /automations/:id/steps). The automation
/// must be DISABLED. <c>type: "trigger"</c> is rejected — the trigger lives on
/// the automation, not in the step list.
/// <para>
/// Editing a step is a DIFFERENT payload: see
/// <see cref="AutomationUpdateStepOptions"/>. PATCH forwards only
/// <c>type</c> and <c>config</c>, so <see cref="Key"/> is create-only.
/// </para>
/// </summary>
public class AutomationAddStepOptions
{
    /// <summary>
    /// <c>send_email</c> | <c>wait_for_event</c> | <c>delay</c> | <c>condition</c> |
    /// <c>split</c> | <c>add_to_segment</c> | <c>contact_update</c> |
    /// <c>contact_delete</c>. REQUIRED — a body without one is coerced to the
    /// empty string and rejected as <c>422 validation_error</c>
    /// ("type must be one of: …") before <see cref="Config"/> is read.
    /// </summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    /// <summary>
    /// The step's settings. Which members are required depends on
    /// <see cref="Type"/> (a <c>delay</c> needs a duration, a
    /// <c>wait_for_event</c> needs an event, …); the server rebuilds the stored
    /// config from this per type rather than keeping unknown members.
    /// </summary>
    [JsonPropertyName("config")]
    public Dictionary<string, object?>? Config { get; set; }

    /// <summary>
    /// Stable graph key used by <see cref="AutomationConnection"/> edges.
    /// Defaults to the new step's id when omitted. Settable ONLY here: the
    /// PATCH route never forwards a key, so a step's key is fixed at creation —
    /// delete and re-add the step to change it.
    /// </summary>
    [JsonPropertyName("key")]
    public string? Key { get; set; }
}

/// <summary>
/// Payload for editing a step (PATCH /automations/:id/steps/:stepId). The
/// automation must be DISABLED. <c>type: "trigger"</c> is rejected — the
/// trigger lives on the automation, not in the step list.
/// <para>
/// There is deliberately no <c>Key</c> here: the route forwards only
/// <c>type</c> and <c>config</c> to storage, so connection edges that reference
/// the step keep working. A key sent on PATCH is silently dropped and the 200
/// response echoes the STORED key back, which reads as a successful re-key that
/// never happened.
/// </para>
/// </summary>
public class AutomationUpdateStepOptions
{
    /// <summary>
    /// <c>send_email</c> | <c>wait_for_event</c> | <c>delay</c> | <c>condition</c> |
    /// <c>split</c> | <c>add_to_segment</c> | <c>contact_update</c> |
    /// <c>contact_delete</c>. REQUIRED on PATCH exactly as on POST: the update
    /// replaces type and config wholesale, never merges, and the same validator
    /// rejects a body without a type as <c>422 validation_error</c>. Resend the
    /// step's CURRENT type even when only <see cref="Config"/> is changing.
    /// </summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    /// <summary>
    /// The step's settings, REPLACING the stored config rather than merging
    /// into it — resend every member you want to keep. Which members are
    /// required depends on <see cref="Type"/>.
    /// </summary>
    [JsonPropertyName("config")]
    public Dictionary<string, object?>? Config { get; set; }
}

/// <summary>
/// Options for listing automation runs (GET /automations/:id/runs): cursor
/// pagination plus an optional status filter.
/// </summary>
public class AutomationRunListOptions
{
    /// <summary>Page size (1–100; this endpoint defaults to 20).</summary>
    public int? Limit { get; set; }

    /// <summary>Cursor: id of the last item on the previous page.</summary>
    public string? After { get; set; }

    /// <summary>Cursor: id of the first item on the next page.</summary>
    public string? Before { get; set; }

    /// <summary>
    /// Keep only runs in these statuses (<c>running</c>, <c>completed</c>,
    /// <c>failed</c>, <c>skipped</c>). Sent as a comma-separated list; filtering
    /// happens before pagination.
    /// </summary>
    public IEnumerable<string>? Status { get; set; }
}

/// <summary>
/// Prompt for "Create with AI" (POST /automations/:id/ai). The automation must
/// be stopped; without <see cref="Attach"/> it must also have zero steps.
/// </summary>
public class AutomationAiOptions
{
    /// <summary>What the workflow should do. Required; max 2000 characters.</summary>
    [JsonPropertyName("prompt")]
    public string Prompt { get; set; } = null!;

    /// <summary>Templates the plan may send (first 10 kept).</summary>
    [JsonPropertyName("template_ids")]
    public List<string>? TemplateIds { get; set; }

    /// <summary>Event names the plan may wait on (first 10 kept).</summary>
    [JsonPropertyName("events")]
    public List<string>? Events { get; set; }

    /// <summary>
    /// Where to graft the generated steps. Supplying it switches to APPEND mode;
    /// omitting it generates a whole workflow.
    /// </summary>
    [JsonPropertyName("attach")]
    public AutomationAiAttach? Attach { get; set; }
}

/// <summary>Attachment point for an APPEND-mode "Create with AI" request.</summary>
public class AutomationAiAttach
{
    /// <summary>The trigger key or an existing step key to attach after.</summary>
    [JsonPropertyName("from")]
    public string From { get; set; } = null!;

    /// <summary>
    /// <c>default</c> (the default) | <c>condition_met</c> | <c>condition_not_met</c> |
    /// <c>event_received</c> | <c>timeout</c>.
    /// </summary>
    [JsonPropertyName("type")]
    public string? Type { get; set; }

    /// <summary>Insert before this existing step key.</summary>
    [JsonPropertyName("before")]
    public string? Before { get; set; }
}

/// <summary>What a "Create with AI" call added.</summary>
public class AutomationAiInfo
{
    [JsonPropertyName("added_steps")]
    public int AddedSteps { get; set; }

    /// <summary><c>workflow</c> | <c>append</c>.</summary>
    [JsonPropertyName("mode")]
    public string? Mode { get; set; }
}

/// <summary>The automation after a "Create with AI" call, plus what was added.</summary>
public class AutomationAiResult : Automation
{
    [JsonPropertyName("ai")]
    public AutomationAiInfo? Ai { get; set; }
}

/// <summary>Acknowledgement of deleting an automation step: <c>{ id, deleted }</c>.</summary>
public class AutomationStepDeleted
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("deleted")]
    public bool Deleted { get; set; }
}

/// <summary>One executed step within an automation run.</summary>
public class AutomationRunStep
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = null!;

    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    /// <summary><c>completed</c> | <c>failed</c> | <c>skipped</c>.</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;

    [JsonPropertyName("started_at")]
    public string? StartedAt { get; set; }

    [JsonPropertyName("completed_at")]
    public string? CompletedAt { get; set; }

    [JsonPropertyName("output")]
    public Dictionary<string, JsonElement>? Output { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

/// <summary>One enrollment (run) of a contact through an automation.</summary>
public class AutomationRun
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "automation_run";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("contact_id")]
    public string ContactId { get; set; } = null!;

    /// <summary>Email of the contact the run is for; null if that contact was deleted.</summary>
    [JsonPropertyName("contact_email")]
    public string? ContactEmail { get; set; }

    /// <summary><c>running</c> | <c>completed</c> | <c>failed</c> | <c>cancelled</c> | <c>skipped</c>.</summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;

    [JsonPropertyName("started_at")]
    public string? StartedAt { get; set; }

    [JsonPropertyName("completed_at")]
    public string? CompletedAt { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    /// <summary>Present on retrieve (GET /automations/:id/runs/:runId) only.</summary>
    [JsonPropertyName("automation_id")]
    public string? AutomationId { get; set; }

    [JsonPropertyName("steps")]
    public List<AutomationRunStep>? Steps { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}
