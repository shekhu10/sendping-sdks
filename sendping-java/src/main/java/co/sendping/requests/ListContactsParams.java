package co.sendping.requests;

/**
 * Params for listing contacts (DOMAIN-FIRST): {@code domain} names the sending
 * domain's contact pool and is REQUIRED on the flat {@code GET /contacts} list
 * (i.e. whenever {@code audienceId} is omitted). {@code segmentId} restricts
 * to members of a segment and works on both routes.
 */
public final class ListContactsParams {
    private final String domain;
    private final String audienceId;
    private final String segmentId;
    private final Integer limit;
    private final String after;
    private final String before;

    private ListContactsParams(Builder b) {
        this.domain = b.domain;
        this.audienceId = b.audienceId;
        this.segmentId = b.segmentId;
        this.limit = b.limit;
        this.after = b.after;
        this.before = b.before;
    }

    public static Builder builder() { return new Builder(); }

    public String getDomain() { return domain; }
    public String getAudienceId() { return audienceId; }
    public String getSegmentId() { return segmentId; }
    public Integer getLimit() { return limit; }
    public String getAfter() { return after; }
    public String getBefore() { return before; }

    public static final class Builder {
        private String domain;
        private String audienceId;
        private String segmentId;
        private Integer limit;
        private String after;
        private String before;

        /** The sending domain whose contact pool to list (REQUIRED unless {@code audienceId} is set). */
        public Builder domain(String domain) { this.domain = domain; return this; }
        /** List a specific audience via the nested API instead of {@code domain}. */
        public Builder audienceId(String audienceId) { this.audienceId = audienceId; return this; }
        /** Restrict to members of this segment. */
        public Builder segmentId(String segmentId) { this.segmentId = segmentId; return this; }
        public Builder limit(int limit) { this.limit = limit; return this; }
        public Builder after(String after) { this.after = after; return this; }
        public Builder before(String before) { this.before = before; return this; }

        public ListContactsParams build() { return new ListContactsParams(this); }
    }
}
