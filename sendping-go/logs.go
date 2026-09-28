package sendping

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
)

// LogEntry is one API request log row.
type LogEntry struct {
	Object         string `json:"object"`
	Id             string `json:"id"`
	Endpoint       string `json:"endpoint"`
	Method         string `json:"method"`
	ResponseStatus int    `json:"response_status"`
	UserAgent      string `json:"user_agent"`
	CreatedAt      string `json:"created_at"`
	// RequestBody is present only on retrieve (GET /logs/:id).
	RequestBody any `json:"request_body,omitempty"`
	// ResponseBody is present only on retrieve (GET /logs/:id).
	ResponseBody any `json:"response_body,omitempty"`
}

// ListLogsRequest lists API request logs: cursor pagination plus optional
// server-side method/status filters.
type ListLogsRequest struct {
	Limit  int
	After  string
	Before string
	// Method filters to an exact HTTP method, e.g. "POST".
	Method string
	// Status filters to an exact response status, e.g. 200 or 429.
	Status int
}

// LogsService handles the /logs endpoints.
type LogsService struct {
	client *Client
}

// List lists API request logs. GET /logs
func (s *LogsService) List(params *ListLogsRequest) (*ListResponse[LogEntry], error) {
	return s.ListWithContext(context.Background(), params)
}

// ListWithContext lists API request logs. GET /logs
func (s *LogsService) ListWithContext(ctx context.Context, params *ListLogsRequest) (*ListResponse[LogEntry], error) {
	q := url.Values{}
	if params != nil {
		if params.Limit > 0 {
			q.Set("limit", strconv.Itoa(params.Limit))
		}
		if params.After != "" {
			q.Set("after", params.After)
		}
		if params.Before != "" {
			q.Set("before", params.Before)
		}
		if params.Method != "" {
			q.Set("method", params.Method)
		}
		if params.Status > 0 {
			q.Set("status", strconv.Itoa(params.Status))
		}
	}
	path := "/logs"
	if enc := q.Encode(); enc != "" {
		path += "?" + enc
	}
	return request[ListResponse[LogEntry]](ctx, s.client, http.MethodGet, path, nil, nil)
}

// Get retrieves one log row (including request/response bodies).
// GET /logs/:id
func (s *LogsService) Get(id string) (*LogEntry, error) {
	return s.GetWithContext(context.Background(), id)
}

// GetWithContext retrieves one log row. GET /logs/:id
func (s *LogsService) GetWithContext(ctx context.Context, id string) (*LogEntry, error) {
	return request[LogEntry](ctx, s.client, http.MethodGet, "/logs/"+esc(id), nil, nil)
}
