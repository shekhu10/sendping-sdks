package co.sendping.resources;

/** Outcome of verifying a webhook delivery signature. */
public final class VerifyWebhookResult {
    private final boolean valid;
    private final String reason;

    VerifyWebhookResult(boolean valid, String reason) {
        this.valid = valid;
        this.reason = reason;
    }

    /** True when a signature matches and (when checked) the timestamp is fresh. */
    public boolean isValid() { return valid; }

    /**
     * A machine reason when invalid: {@code missing_headers},
     * {@code missing_secret}, {@code invalid_timestamp},
     * {@code timestamp_out_of_tolerance}, or {@code no_match}. {@code null}
     * when valid.
     */
    public String getReason() { return reason; }

    @Override
    public String toString() {
        return valid ? "VerifyWebhookResult{valid}" : "VerifyWebhookResult{invalid: " + reason + "}";
    }
}
