package sendping

import (
	"context"
	"net/http"
)

// CampaignAbTest is the A/B-test config accepted on campaign create/update.
// When Enabled, supply at least one variant-B field (SubjectB, HtmlB, or
// TextB).
type CampaignAbTest struct {
	Enabled  bool   `json:"enabled"`
	SubjectB string `json:"subject_b,omitempty"`
	HtmlB    string `json:"html_b,omitempty"`
	TextB    string `json:"text_b,omitempty"`
	// TestPct is the percentage (1-100) of the audience used to pick the
	// winner. Defaults to 20.
	TestPct int `json:"test_pct,omitempty"`
	// Metric decides the winner: "open" | "click" | "reply". Defaults to "open".
	Metric string `json:"metric,omitempty"`
	// EvalHours is the hours (1-168) to run the test before evaluating and
	// sending the winner.
	EvalHours int `json:"eval_hours,omitempty"`
}

// CampaignAbState is the A/B config + decision echoed back on retrieve.
// Campaign list items carry only Enabled/Metric/Status/Winner.
type CampaignAbState struct {
	Enabled   bool   `json:"enabled"`
	SubjectB  string `json:"subject_b,omitempty"`
	HtmlB     string `json:"html_b,omitempty"`
	TextB     string `json:"text_b,omitempty"`
	TestPct   int    `json:"test_pct,omitempty"`
	Metric    string `json:"metric,omitempty"`
	EvalHours int    `json:"eval_hours,omitempty"`
	Status    string `json:"status,omitempty"`
	Winner    string `json:"winner,omitempty"`
}

// CampaignFollowupInput is an engagement follow-up accepted on create (max 5):
// sent Delay after the campaign finishes to recipients matching Condition,
// threaded as replies to the original email.
type CampaignFollowupInput struct {
	// Condition is one of: opened, clicked, not_opened, not_clicked, replied,
	// not_replied.
	Condition string `json:"condition"`
	// Delay is a natural-language duration, e.g. "5 hours" or "4 days" (max 30 days).
	Delay string `json:"delay"`
	// Subject defaults to "Re: <campaign subject>" (keeps the thread).
	Subject string `json:"subject,omitempty"`
	Html    string `json:"html"`
}

// CampaignFollowup is a follow-up echoed back on retrieve.
type CampaignFollowup struct {
	Id        string `json:"id"`
	Condition string `json:"condition"`
	Delay     string `json:"delay"`
	Subject   string `json:"subject"`
	Html      string `json:"html"`
	Status    string `json:"status"`
	RunAt     string `json:"run_at"`
	SentCount int    `json:"sent_count"`
	CreatedAt string `json:"created_at"`
}

// CampaignRecurrenceState is the recurrence cadence echoed back on retrieve.
type CampaignRecurrenceState struct {
	// Interval is "daily" | "weekly" | "monthly".
	Interval string `json:"interval"`
	Every    int    `json:"every"`
}

// Campaign is a bulk send to an audience or segment.
type Campaign struct {
	Object     string `json:"object"`
	Id         string `json:"id"`
	Name       string `json:"name"`
	AudienceId string `json:"audience_id"`
	// SegmentId is the segment target (empty => whole audience).
	SegmentId string `json:"segment_id"`
	// TopicId is the topic gate (empty => no gating).
	TopicId     string `json:"topic_id"`
	From        string `json:"from"`
	Subject     string `json:"subject"`
	Html        string `json:"html,omitempty"`
	Text        string `json:"text,omitempty"`
	ReplyTo     string `json:"reply_to,omitempty"`
	PreviewText string `json:"preview_text,omitempty"`
	// Status is the campaign state: draft, queued (a send in flight),
	// scheduled, recurring, paused, canceled, sent, or failed. canceled is
	// TERMINAL — a queued send stopped part-way; unlike a canceled scheduled
	// campaign, which returns to draft, it cannot be resumed or re-sent.
	Status      string `json:"status"`
	ScheduledAt string `json:"scheduled_at"`
	SentAt      string `json:"sent_at"`
	CreatedAt   string `json:"created_at"`
	// ScheduleTimezone is the IANA zone the schedule and daily batching are
	// evaluated in.
	ScheduleTimezone string `json:"schedule_timezone,omitempty"`
	// DailyBatchSize is the per-batch-day recipient cap (0 => send at once).
	DailyBatchSize int `json:"daily_batch_size,omitempty"`
	// FailureReason explains a failed or reputation-paused campaign.
	FailureReason string `json:"failure_reason,omitempty"`
	// AbTest is the A/B config + decision ({ enabled: false } when not an A/B
	// campaign).
	AbTest *CampaignAbState `json:"ab_test,omitempty"`
	// Followups are the engagement follow-ups (retrieve only).
	Followups []CampaignFollowup `json:"followups,omitempty"`
	// ListAddress is the generated mailing-list To address (retrieve only;
	// empty unless list_to was set).
	ListAddress string `json:"list_address,omitempty"`
	// UnsubscribePolicy: "account" | "domain" | "ignore" (retrieve only).
	UnsubscribePolicy string `json:"unsubscribe_policy,omitempty"`
	// Recurrence is the cadence (nil => one-off).
	Recurrence *CampaignRecurrenceState `json:"recurrence,omitempty"`
	// ParentCampaignId is set on auto-generated occurrences of a recurring
	// campaign.
	ParentCampaignId string `json:"parent_campaign_id,omitempty"`
	// Statistics holds engagement counts — included only on retrieve.
	Statistics map[string]any `json:"statistics,omitempty"`
}

// CampaignListItem is one row of CampaignsService.List (GET /campaigns).
//
// The list serializer is deliberately narrower than the full Campaign: it
// sends no bodies (Html/Text), no From/TopicId/ReplyTo/PreviewText, no
// schedule detail, no follow-ups, recurrence or statistics. Typing the list as
// Campaign would promise those fields and hand back empty strings instead, so
// they are absent from the type. Use Campaigns.Get for the full record.
type CampaignListItem struct {
	Object string `json:"object"`
	Id     string `json:"id"`
	Name   string `json:"name"`
	// Subject is included so a list view can render it without a per-row fetch.
	Subject    string `json:"subject"`
	AudienceId string `json:"audience_id"`
	// SegmentId is the segment target (empty => whole audience).
	SegmentId string `json:"segment_id"`
	// Status is the campaign state: draft, queued, scheduled, recurring,
	// paused, canceled, sent, or failed. canceled is terminal.
	Status string `json:"status"`
	// AbTest is the lightweight A/B marker — Enabled plus Metric/Status/Winner
	// when enabled. Full A/B detail is on Campaigns.Get / Campaigns.Ab.
	AbTest      *CampaignAbState `json:"ab_test,omitempty"`
	CreatedAt   string           `json:"created_at"`
	ScheduledAt string           `json:"scheduled_at"`
	SentAt      string           `json:"sent_at"`
	// FailureReason explains a failed or reputation-paused campaign.
	FailureReason string `json:"failure_reason"`
}

// CreateCampaignRequest is the payload for POST /campaigns. Domain is
// REQUIRED (domain-first): it names the sending domain whose contact pool
// this campaign targets; it is orthogonal to From, which may be a different
// verified domain.
type CreateCampaignRequest struct {
	// Domain is REQUIRED — the sending domain whose contact pool this
	// campaign targets (e.g. "yourdomain.com" — one of your domains).
	Domain      string   `json:"domain"`
	From        string   `json:"from"`
	Subject     string   `json:"subject"`
	Html        string   `json:"html,omitempty"`
	Text        string   `json:"text,omitempty"`
	ReplyTo     []string `json:"reply_to,omitempty"`
	PreviewText string   `json:"preview_text,omitempty"`
	Name        string   `json:"name,omitempty"`
	// SegmentId targets a segment (subset of the audience) instead of everyone.
	SegmentId string `json:"segment_id,omitempty"`
	// TopicId gates recipients by a topic subscription.
	TopicId string `json:"topic_id,omitempty"`
	// Recurrence makes this a recurring campaign: "daily" | "weekly" | "monthly".
	Recurrence string `json:"recurrence,omitempty"`
	// RecurrenceEvery is the number of periods between recurring sends
	// (1-365). Defaults to 1.
	RecurrenceEvery int             `json:"recurrence_every,omitempty"`
	AbTest          *CampaignAbTest `json:"ab_test,omitempty"`
	// Followups are engagement follow-ups (max 5).
	Followups []CampaignFollowupInput `json:"followups,omitempty"`
	// ListTo shows a generated mailing-list address as the visible To.
	// Delivery stays individual.
	ListTo bool `json:"list_to,omitempty"`
	// UnsubscribePolicy: "account" (default), "domain", or "ignore"
	// (bounced/complained addresses are ALWAYS excluded).
	UnsubscribePolicy string `json:"unsubscribe_policy,omitempty"`
	// Send sends immediately on create (or schedules when ScheduledAt is given).
	Send bool `json:"send,omitempty"`
	// ScheduledAt is an ISO 8601 (or natural-language) schedule used when
	// Send is true.
	ScheduledAt string `json:"scheduled_at,omitempty"`
	// ScheduleTimezone is the IANA timezone the schedule + daily batching are
	// evaluated in (e.g. "America/New_York"). Defaults to the account
	// timezone, then UTC.
	ScheduleTimezone string `json:"schedule_timezone,omitempty"`
	// DailyBatchSize is the max recipients fanned out per batch-day
	// (1-100000). 0 (omitted) sends to everyone at once.
	DailyBatchSize int `json:"daily_batch_size,omitempty"`
}

// UpdateCampaignRequest is the payload for PATCH /campaigns/:id. Only a draft
// campaign can be edited — anything else is a 422.
//
// The API patches by key presence, so a field left at its zero value is
// omitted and stays untouched. The two fields with replace semantics
// (Followups and ListTo) are pointers so you can express "clear"; the plain
// string fields cannot currently be set back to null through this SDK.
//
// There is deliberately no AudienceId field — passing audience_id is a 422.
// Changing Domain also clears SegmentId and TopicId server-side.
type UpdateCampaignRequest struct {
	Name    string `json:"name,omitempty"`
	From    string `json:"from,omitempty"`
	Subject string `json:"subject,omitempty"`
	Html    string `json:"html,omitempty"`
	Text    string `json:"text,omitempty"`
	// ReplyTo replaces the reply-to addresses; Clear[[]string]() removes them.
	ReplyTo *Null[[]string] `json:"reply_to,omitempty"`
	// PreviewText sets the inbox preview (max 150 chars);
	// Clear[string]() removes it.
	PreviewText *Null[string] `json:"preview_text,omitempty"`
	// Domain re-points the campaign at another of your domains' contact pools
	// (draft campaigns only). Changing it also clears SegmentId and TopicId
	// server-side.
	Domain string `json:"domain,omitempty"`
	// SegmentId re-targets a segment; Clear[string]() untargets the campaign.
	SegmentId *Null[string] `json:"segment_id,omitempty"`
	// TopicId re-targets a topic gate; Clear[string]() removes the gate.
	TopicId         *Null[string]   `json:"topic_id,omitempty"`
	Recurrence      string          `json:"recurrence,omitempty"`
	RecurrenceEvery int             `json:"recurrence_every,omitempty"`
	AbTest          *CampaignAbTest `json:"ab_test,omitempty"`
	// Followups replaces the pending engagement follow-ups (max 5). Leave nil
	// to keep them; point it at an empty slice
	// (&[]sendping.CampaignFollowupInput{}) to clear them. A plain empty
	// slice value cannot express "clear", which is why this is a pointer.
	Followups *[]CampaignFollowupInput `json:"followups,omitempty"`
	// ListTo shows a generated mailing-list address as the visible To;
	// Bool(false) clears the address. Delivery stays individual either way.
	ListTo *bool `json:"list_to,omitempty"`
	// UnsubscribePolicy: "account" (default), "domain", or "ignore"
	// (bounced/complained addresses are ALWAYS excluded).
	UnsubscribePolicy string `json:"unsubscribe_policy,omitempty"`
	// ScheduleTimezone is the IANA timezone the schedule + daily batching are
	// evaluated in (e.g. "America/New_York"); Clear[string]() resets it.
	ScheduleTimezone *Null[string] `json:"schedule_timezone,omitempty"`
	// DailyBatchSize is the max recipients fanned out per batch-day
	// (1-100000); Clear[int]() removes the cap.
	DailyBatchSize *Null[int] `json:"daily_batch_size,omitempty"`
}

// SendCampaignRequest sends a campaign now, or schedules it with ScheduledAt.
type SendCampaignRequest struct {
	ScheduledAt string `json:"scheduled_at,omitempty"`
	// ScheduleTimezone (IANA name) is persisted onto the campaign so daily
	// batching evaluates batch-days in that zone.
	ScheduleTimezone string `json:"schedule_timezone,omitempty"`
}

// CampaignStatsLink is one tracked link's click tally.
type CampaignStatsLink struct {
	Url    string `json:"url"`
	Clicks int    `json:"clicks"`
}

// CampaignStatsRates are engagement percentages. Open/click/reply are computed
// against Delivered, falling back to Total when nothing was delivered.
type CampaignStatsRates struct {
	Delivery  float64 `json:"delivery"`
	Open      float64 `json:"open"`
	Click     float64 `json:"click"`
	Reply     float64 `json:"reply"`
	Bounce    float64 `json:"bounce"`
	Complaint float64 `json:"complaint"`
}

// CampaignStats is the per-campaign analytics from GET /campaigns/:id/stats.
type CampaignStats struct {
	Object     string `json:"object"`
	CampaignId string `json:"campaign_id"`

	Total      int `json:"total"`
	Delivered  int `json:"delivered"`
	Opened     int `json:"opened"`
	Clicked    int `json:"clicked"`
	Replied    int `json:"replied"`
	Bounced    int `json:"bounced"`
	Complained int `json:"complained"`

	Rates CampaignStatsRates `json:"rates"`
	// Links is the top 50 tracked links, most-clicked first.
	Links []CampaignStatsLink `json:"links,omitempty"`
}

// CampaignAbArm is one variant's performance in an A/B evaluation.
type CampaignAbArm struct {
	// Variant is "A" or "B".
	Variant     string `json:"variant"`
	Sent        int    `json:"sent"`
	Conversions int    `json:"conversions"`
	// Rate is Conversions/Sent as a FRACTION in 0..1 (0.2 = 20%), unlike
	// CampaignStatsRates, which are already percentages (20 = 20%). Multiply
	// this by 100 for display; do not multiply those. 0 when Sent is 0.
	Rate float64 `json:"rate"`
}

// CampaignAbResult is the A/B winner evaluation from GET /campaigns/:id/ab.
// Retrieving it for a non-A/B campaign is a 422 validation_error.
type CampaignAbResult struct {
	Object     string `json:"object"`
	CampaignId string `json:"campaign_id"`
	// Metric is "open" | "click" | "reply".
	Metric string        `json:"metric"`
	A      CampaignAbArm `json:"a"`
	B      CampaignAbArm `json:"b"`
	// Winner is "A" or "B".
	Winner string `json:"winner,omitempty"`
	// Fallback is true when a variant had zero sends or the rates tied, in
	// which case Winner defaults to "A".
	Fallback bool `json:"fallback"`
	// Lift is the winner's relative lift over the loser as a FRACTION
	// (0.25 = +25%), NOT a percentage — multiply by 100 for display. A loser
	// that converted zero yields the stand-in 1 rather than infinity, and Lift
	// is 0 whenever Fallback is true (an arm had no sends, or the rates tied).
	Lift float64 `json:"lift"`
	// ZScore and PValue are camelCase on the wire — deliberately, do not
	// expect snake_case.
	ZScore float64 `json:"zScore"`
	PValue float64 `json:"pValue"`
	// Confidence is "low" | "medium" | "high"; forced to "low" when either
	// arm has fewer than 20 sends.
	Confidence string `json:"confidence,omitempty"`
	// Reason is a human-readable explanation of the decision.
	Reason string `json:"reason,omitempty"`

	// Status is always empty: this endpoint returns only the evaluation, never
	// a status. The A/B run's status lives on the campaign itself, as
	// Campaign.AbTest.Status (GET /campaigns/:id).
	//
	// Deprecated: read Campaign.AbTest.Status instead.
	Status string `json:"status,omitempty"`
}

// CampaignOpenEngagement is one recipient's open activity.
type CampaignOpenEngagement struct {
	Email     string `json:"email"`
	ContactId string `json:"contact_id"`
	OpenedAt  string `json:"opened_at"`
	OpenCount int    `json:"open_count"`
}

// CampaignClickEngagement is one recipient's click activity.
type CampaignClickEngagement struct {
	Email      string `json:"email"`
	ContactId  string `json:"contact_id"`
	ClickedAt  string `json:"clicked_at"`
	ClickCount int    `json:"click_count"`
}

// CampaignReplyEngagement is one reply received for the campaign.
type CampaignReplyEngagement struct {
	Email     string `json:"email"`
	ContactId string `json:"contact_id"`
	RepliedAt string `json:"replied_at"`
	// ReceivedEmailId addresses the inbound message via Emails.Receiving.
	ReceivedEmailId string `json:"received_email_id"`
	Subject         string `json:"subject"`
	// Preview is the first 300 characters of the reply text.
	Preview string `json:"preview"`
	// Category is the AI reply intent, e.g. "interested".
	Category   string `json:"category"`
	ReceivedAt string `json:"received_at"`
}

// CampaignEngagement is the per-recipient breakdown from
// GET /campaigns/:id/engagement. Each list is capped at 500 rows and the
// endpoint is not paginated.
type CampaignEngagement struct {
	Object     string                    `json:"object"`
	CampaignId string                    `json:"campaign_id"`
	Opened     []CampaignOpenEngagement  `json:"opened"`
	Clicked    []CampaignClickEngagement `json:"clicked"`
	Replied    []CampaignReplyEngagement `json:"replied"`
}

// CampaignsService handles the /campaigns endpoints.
type CampaignsService struct {
	client *Client
}

// Create creates a campaign; returns { id }. POST /campaigns
func (s *CampaignsService) Create(params *CreateCampaignRequest) (*IdResponse, error) {
	return s.CreateWithContext(context.Background(), params)
}

// CreateWithContext creates a campaign. POST /campaigns
func (s *CampaignsService) CreateWithContext(ctx context.Context, params *CreateCampaignRequest) (*IdResponse, error) {
	return request[IdResponse](ctx, s.client, http.MethodPost, "/campaigns", params, nil)
}

// Get retrieves a campaign. GET /campaigns/:id
func (s *CampaignsService) Get(id string) (*Campaign, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves a campaign. GET /campaigns/:id
func (s *CampaignsService) GetWithContext(ctx context.Context, id string) (*Campaign, error) {
	return request[Campaign](ctx, s.client, http.MethodGet, "/campaigns/"+esc(id), nil, nil)
}

// List lists campaigns, newest first. Rows are the reduced CampaignListItem
// shape — no bodies, no From/TopicId/ReplyTo/PreviewText, no schedule detail,
// follow-ups or statistics; use Get for those. Passing nil skips the default
// 20 but still caps the page at 1,000 campaigns, with HasMore true when that
// ceiling bites — keep paging with After. GET /campaigns
func (s *CampaignsService) List(params *ListParams) (*ListResponse[CampaignListItem], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists campaigns. Rows are CampaignListItem. GET /campaigns
func (s *CampaignsService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[CampaignListItem], error) {
	return request[ListResponse[CampaignListItem]](ctx, s.client, http.MethodGet, listPath("/campaigns", params), nil, nil)
}

// Update updates a campaign; returns { id }. PATCH /campaigns/:id
func (s *CampaignsService) Update(id string, params *UpdateCampaignRequest) (*IdResponse, error) {
	return s.UpdateWithContext(context.Background(), id, params)
}

// UpdateWithContext updates a campaign. PATCH /campaigns/:id
func (s *CampaignsService) UpdateWithContext(ctx context.Context, id string, params *UpdateCampaignRequest) (*IdResponse, error) {
	return request[IdResponse](ctx, s.client, http.MethodPatch, "/campaigns/"+esc(id), params, nil)
}

// Send sends a campaign now, or schedules it with ScheduledAt (nil params =
// send now). POST /campaigns/:id/send
func (s *CampaignsService) Send(id string, params *SendCampaignRequest) (*IdResponse, error) {
	return s.SendWithContext(context.Background(), id, params)
}

// SendWithContext sends a campaign. POST /campaigns/:id/send
func (s *CampaignsService) SendWithContext(ctx context.Context, id string, params *SendCampaignRequest) (*IdResponse, error) {
	body := params
	if body == nil {
		body = &SendCampaignRequest{}
	}
	return request[IdResponse](ctx, s.client, http.MethodPost, "/campaigns/"+esc(id)+"/send", body, nil)
}

// Cancel stops a campaign's remaining work. Accepted only on scheduled,
// recurring, paused and queued; any other status is a validation_error.
//
// Which of the two outcomes you get depends on how far the send got, so read
// the returned Campaign.Status instead of assuming:
//
//   - scheduled / recurring / paused -> back to draft. Nothing was mailed, so
//     it can be edited and sent or scheduled again; the pending job (the next
//     recurrence included) is dropped.
//   - queued, i.e. already fanning out -> canceled, which is TERMINAL. Part of
//     the audience has been mailed and those copies cannot be recalled; what
//     this stops is every remaining recipient — for a staggered campaign,
//     every future batch-day. Send rejects any non-draft campaign
//     ("Campaign is already canceled."), so it can never be re-sent.
//
// POST /campaigns/:id/cancel
func (s *CampaignsService) Cancel(id string) (*Campaign, error) {
	return s.CancelWithContext(context.Background(), id)
}

// CancelWithContext stops a campaign's remaining work. scheduled/recurring/
// paused return to draft; a queued campaign becomes the terminal canceled.
// Read Campaign.Status for which happened. POST /campaigns/:id/cancel
func (s *CampaignsService) CancelWithContext(ctx context.Context, id string) (*Campaign, error) {
	return request[Campaign](ctx, s.client, http.MethodPost, "/campaigns/"+esc(id)+"/cancel", nil, nil)
}

// Stats returns per-campaign analytics (counts, engagement rates, top links).
// GET /campaigns/:id/stats
func (s *CampaignsService) Stats(id string) (*CampaignStats, error) {
	return s.StatsWithContext(context.Background(), id)
}

// StatsWithContext returns per-campaign analytics. GET /campaigns/:id/stats
func (s *CampaignsService) StatsWithContext(ctx context.Context, id string) (*CampaignStats, error) {
	return request[CampaignStats](ctx, s.client, http.MethodGet, "/campaigns/"+esc(id)+"/stats", nil, nil)
}

// Engagement returns the per-recipient open/click/reply breakdown (each list
// capped at 500 rows). GET /campaigns/:id/engagement
func (s *CampaignsService) Engagement(id string) (*CampaignEngagement, error) {
	return s.EngagementWithContext(context.Background(), id)
}

// EngagementWithContext returns the per-recipient engagement breakdown.
// GET /campaigns/:id/engagement
func (s *CampaignsService) EngagementWithContext(ctx context.Context, id string) (*CampaignEngagement, error) {
	return request[CampaignEngagement](ctx, s.client, http.MethodGet, "/campaigns/"+esc(id)+"/engagement", nil, nil)
}

// Ab returns the A/B winner evaluation for an A/B campaign.
// GET /campaigns/:id/ab
func (s *CampaignsService) Ab(id string) (*CampaignAbResult, error) {
	return s.AbWithContext(context.Background(), id)
}

// AbWithContext returns the A/B winner evaluation. GET /campaigns/:id/ab
func (s *CampaignsService) AbWithContext(ctx context.Context, id string) (*CampaignAbResult, error) {
	return request[CampaignAbResult](ctx, s.client, http.MethodGet, "/campaigns/"+esc(id)+"/ab", nil, nil)
}

// Remove deletes a campaign. DELETE /campaigns/:id
func (s *CampaignsService) Remove(id string) (*RemovedResponse, error) {
	return s.RemoveWithContext(context.Background(), id)
}

// RemoveWithContext deletes a campaign. DELETE /campaigns/:id
func (s *CampaignsService) RemoveWithContext(ctx context.Context, id string) (*RemovedResponse, error) {
	return request[RemovedResponse](ctx, s.client, http.MethodDelete, "/campaigns/"+esc(id), nil, nil)
}
