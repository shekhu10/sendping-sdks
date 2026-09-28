package co.sendping.requests;

/**
 * Params for {@code GET /emails/receiving}: cursor pagination plus an
 * optional {@code received_for} filter (only messages received for that
 * address).
 */
public final class ListReceivedEmailsParams {
    private final Integer limit;
    private final String after;
    private final String before;
    private final String receivedFor;

    private ListReceivedEmailsParams(Builder b) {
        this.limit = b.limit;
        this.after = b.after;
        this.before = b.before;
        this.receivedFor = b.receivedFor;
    }

    public static Builder builder() { return new Builder(); }

    public Integer getLimit() { return limit; }
    public String getAfter() { return after; }
    public String getBefore() { return before; }
    public String getReceivedFor() { return receivedFor; }

    public static final class Builder {
        private Integer limit;
        private String after;
        private String before;
        private String receivedFor;

        public Builder limit(int limit) { this.limit = limit; return this; }
        public Builder after(String after) { this.after = after; return this; }
        public Builder before(String before) { this.before = before; return this; }
        /** Only messages received for this address. */
        public Builder receivedFor(String receivedFor) { this.receivedFor = receivedFor; return this; }

        public ListReceivedEmailsParams build() { return new ListReceivedEmailsParams(this); }
    }
}
