package co.sendping.requests;

/**
 * Params for {@code GET /logs}: cursor pagination plus optional server-side
 * {@code method} / {@code status} filters.
 */
public final class ListLogsParams {
    private final Integer limit;
    private final String after;
    private final String before;
    private final String method;
    private final Integer status;

    private ListLogsParams(Builder b) {
        this.limit = b.limit;
        this.after = b.after;
        this.before = b.before;
        this.method = b.method;
        this.status = b.status;
    }

    public static Builder builder() { return new Builder(); }

    public Integer getLimit() { return limit; }
    public String getAfter() { return after; }
    public String getBefore() { return before; }
    public String getMethod() { return method; }
    public Integer getStatus() { return status; }

    public static final class Builder {
        private Integer limit;
        private String after;
        private String before;
        private String method;
        private Integer status;

        public Builder limit(int limit) { this.limit = limit; return this; }
        public Builder after(String after) { this.after = after; return this; }
        public Builder before(String before) { this.before = before; return this; }
        /** Filter to an exact HTTP method, e.g. {@code "POST"}. */
        public Builder method(String method) { this.method = method; return this; }
        /** Filter to an exact response status, e.g. 200 or 429. */
        public Builder status(int status) { this.status = status; return this; }

        public ListLogsParams build() { return new ListLogsParams(this); }
    }
}
