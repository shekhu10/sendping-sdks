package co.sendping.requests;

import java.util.Arrays;
import java.util.List;

/**
 * Params for {@code GET /automations/:id/runs}: cursor pagination plus an
 * optional {@code status} filter. Several statuses may be combined — they are
 * sent as one comma-separated value and matched exactly, so an unknown status
 * simply matches nothing rather than erroring.
 *
 * <p>Observed run statuses: {@code running}, {@code completed}, {@code failed},
 * {@code skipped}.
 */
public final class ListAutomationRunsParams {
    private final Integer limit;
    private final String after;
    private final String before;
    private final String status;

    private ListAutomationRunsParams(Builder b) {
        this.limit = b.limit;
        this.after = b.after;
        this.before = b.before;
        this.status = b.status;
    }

    public static Builder builder() { return new Builder(); }

    public Integer getLimit() { return limit; }
    public String getAfter() { return after; }
    public String getBefore() { return before; }
    /** The comma-separated status filter as it goes on the wire, or {@code null}. */
    public String getStatus() { return status; }

    public static final class Builder {
        private Integer limit;
        private String after;
        private String before;
        private String status;

        /** Page size — an integer 1–100 (this route defaults to 20 even with no params). */
        public Builder limit(int limit) { this.limit = limit; return this; }
        public Builder after(String after) { this.after = after; return this; }
        public Builder before(String before) { this.before = before; return this; }

        /** Filter to one run status, e.g. {@code "failed"}. */
        public Builder status(String status) { this.status = status; return this; }

        /** Filter to any of several run statuses. */
        public Builder status(String... statuses) { return status(Arrays.asList(statuses)); }

        /** Filter to any of several run statuses. */
        public Builder status(List<String> statuses) {
            if (statuses == null || statuses.isEmpty()) {
                this.status = null;
                return this;
            }
            this.status = String.join(",", statuses);
            return this;
        }

        public ListAutomationRunsParams build() { return new ListAutomationRunsParams(this); }
    }
}
