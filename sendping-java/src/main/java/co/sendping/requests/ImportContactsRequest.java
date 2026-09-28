package co.sendping.requests;

/**
 * Bulk-import contacts ({@code POST /audiences/:id/contacts/import}). Upserts
 * by email. By default every non-builtin CSV column is auto-registered as a
 * custom property; {@code createProperties(false)} switches to strict mode
 * (unknown columns come back in {@code ignored_columns}).
 *
 * <p>Two input modes, exactly one of which must be set:
 *
 * <ul>
 *   <li>{@link Builder#csv(String)} — inline CSV text. Capped at
 *       <strong>5 MB</strong> of UTF-8 and <strong>10 000 rows</strong>.</li>
 *   <li>{@link Builder#storageKey(String)} — the key returned by
 *       {@code contacts().createImportUpload(...)} after you PUT the file to
 *       the presigned URL. Use this for anything larger (up to 256 MB); rows
 *       beyond your contact allowance are reported as {@code limit_skipped}
 *       instead of failing the request.</li>
 * </ul>
 */
public final class ImportContactsRequest {
    private final String audienceId;
    private final String csv;
    private final String storageKey;
    private final String fileName;
    private final String onConflict;
    private final String segmentId;
    private final Boolean createProperties;

    private ImportContactsRequest(Builder b) {
        if (b.audienceId == null) throw new IllegalStateException("ImportContactsRequest: audienceId is required");
        if (b.csv == null && b.storageKey == null) {
            throw new IllegalStateException("ImportContactsRequest: provide csv or storageKey");
        }
        if (b.csv != null && b.storageKey != null) {
            throw new IllegalStateException("ImportContactsRequest: provide csv or storageKey, not both");
        }
        this.audienceId = b.audienceId;
        this.csv = b.csv;
        this.storageKey = b.storageKey;
        this.fileName = b.fileName;
        this.onConflict = b.onConflict;
        this.segmentId = b.segmentId;
        this.createProperties = b.createProperties;
    }

    public static Builder builder() { return new Builder(); }

    public String getAudienceId() { return audienceId; }
    public String getCsv() { return csv; }
    public String getStorageKey() { return storageKey; }
    public String getFileName() { return fileName; }
    public String getOnConflict() { return onConflict; }
    public String getSegmentId() { return segmentId; }
    public Boolean getCreateProperties() { return createProperties; }

    public static final class Builder {
        private String audienceId;
        private String csv;
        private String storageKey;
        private String fileName;
        private String onConflict;
        private String segmentId;
        private Boolean createProperties;

        public Builder audienceId(String audienceId) { this.audienceId = audienceId; return this; }
        /** Inline CSV text (header row optional); max 5 MB and 10,000 rows. */
        public Builder csv(String csv) { this.csv = csv; return this; }
        /** Key of a file already uploaded through {@code createImportUpload}. */
        public Builder storageKey(String storageKey) { this.storageKey = storageKey; return this; }
        /** Name recorded for the archived source file (inline mode; defaults to {@code contacts.csv}). */
        public Builder fileName(String fileName) { this.fileName = fileName; return this; }
        /** {@code "upsert"} (default) or {@code "skip"}. */
        public Builder onConflict(String onConflict) { this.onConflict = onConflict; return this; }
        /** Also add every imported email to this segment; it must belong to this audience. */
        public Builder segmentId(String segmentId) { this.segmentId = segmentId; return this; }
        public Builder createProperties(boolean createProperties) { this.createProperties = createProperties; return this; }

        public ImportContactsRequest build() { return new ImportContactsRequest(this); }
    }
}
