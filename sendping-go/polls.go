package sendping

import (
	"context"
	"net/http"
)

// Poll is one row of Polls.List — an email that has in-email poll responses.
type Poll struct {
	Object string `json:"object"`
	// EmailId is the email the poll was sent on.
	EmailId         string `json:"email_id"`
	Subject         string `json:"subject"`
	Responses       int    `json:"responses"`
	DistinctAnswers int    `json:"distinct_answers"`
	LastResponseAt  string `json:"last_response_at"`
}

// PollAnswer is a single answer's tally within a poll result.
type PollAnswer struct {
	Answer string `json:"answer"`
	Count  int    `json:"count"`
	// Pct is the share of all responses, 0-100, one decimal.
	Pct float64 `json:"pct"`
}

// PollResult is the aggregated answer breakdown for one email.
type PollResult struct {
	Object            string `json:"object"`
	EmailId           string `json:"email_id"`
	Total             int    `json:"total"`
	UniqueRespondents int    `json:"unique_respondents"`
	// Answers is sorted most-voted first.
	Answers []PollAnswer `json:"answers"`
}

// PollsService exposes the read-only results of the in-email poll widget.
type PollsService struct {
	client *Client
}

// List returns one summary row per email that has poll responses. GET /polls
func (s *PollsService) List(params *ListParams) (*ListResponse[Poll], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists poll summaries. GET /polls
func (s *PollsService) ListWithContext(ctx context.Context, params *ListParams) (*ListResponse[Poll], error) {
	return request[ListResponse[Poll]](ctx, s.client, http.MethodGet, listPath("/polls", params), nil, nil)
}

// Get returns the aggregated answer breakdown for one email.
// GET /polls/:emailId
func (s *PollsService) Get(emailId string) (*PollResult, error) {
	return s.GetWithContext(context.Background(), emailId)
}

// GetWithContext returns the answer breakdown for one email. GET /polls/:emailId
func (s *PollsService) GetWithContext(ctx context.Context, emailId string) (*PollResult, error) {
	return request[PollResult](ctx, s.client, http.MethodGet, "/polls/"+esc(emailId), nil, nil)
}
