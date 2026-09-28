package co.sendping;

import co.sendping.http.Query;

/**
 * Cursor pagination accepted by most {@code list()} methods:
 * {@code limit} (max page size), {@code after} (id of the last item on the
 * previous page), {@code before} (id of the first item on the next page).
 */
public final class ListParams {
    private final Integer limit;
    private final String after;
    private final String before;

    private ListParams(Builder b) {
        this.limit = b.limit;
        this.after = b.after;
        this.before = b.before;
    }

    public static Builder builder() { return new Builder(); }

    public Integer getLimit() { return limit; }
    public String getAfter() { return after; }
    public String getBefore() { return before; }

    /** Append these params to a query string being built. */
    public void applyTo(Query q) {
        q.add("limit", limit).add("after", after).add("before", before);
    }

    public static final class Builder {
        private Integer limit;
        private String after;
        private String before;

        public Builder limit(int limit) { this.limit = limit; return this; }
        public Builder after(String after) { this.after = after; return this; }
        public Builder before(String before) { this.before = before; return this; }

        public ListParams build() { return new ListParams(this); }
    }
}
