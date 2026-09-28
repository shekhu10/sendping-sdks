package co.sendping.requests;

import java.util.ArrayList;
import java.util.List;

/**
 * Bulk-import contacts from a list (DOMAIN-FIRST). Pass
 * {@link Builder#domain(String)} to import into that sending domain's contact
 * pool via the flat {@code POST /contacts/batch} API, or
 * {@link Builder#audienceId(String)} to target a specific audience via
 * {@code POST /audiences/:id/contacts/batch}. At least one is required —
 * {@link Builder#build()} throws when neither is set; when both are set,
 * {@code audienceId} takes precedence and {@code domain} is ignored.
 *
 * <p>Upserts by email; max 10,000 per call. {@code onConflict("skip")} leaves
 * existing contacts untouched (default {@code upsert}).
 *
 * <p>Prefer this over a create-per-contact loop for many contacts: one batch
 * takes the account's contact-limit lock once, where a loop takes it per
 * contact.
 */
public final class BatchContactsRequest {
    private final String domain;
    private final String audienceId;
    private final List<ContactInput> contacts;
    private final String onConflict;

    private BatchContactsRequest(Builder b) {
        if (b.domain == null && b.audienceId == null) {
            throw new IllegalStateException("BatchContactsRequest: one of domain or audienceId is required");
        }
        this.domain = b.domain;
        this.audienceId = b.audienceId;
        this.contacts = b.contacts;
        this.onConflict = b.onConflict;
    }

    public static Builder builder() { return new Builder(); }

    public String getDomain() { return domain; }
    public String getAudienceId() { return audienceId; }
    public List<ContactInput> getContacts() { return contacts; }
    public String getOnConflict() { return onConflict; }

    public static final class Builder {
        private String domain;
        private String audienceId;
        private final List<ContactInput> contacts = new ArrayList<>();
        private String onConflict;

        /** The sending domain whose contact pool the contacts land in (flat API). */
        public Builder domain(String domain) { this.domain = domain; return this; }
        public Builder audienceId(String audienceId) { this.audienceId = audienceId; return this; }
        public Builder contact(ContactInput contact) { this.contacts.add(contact); return this; }
        public Builder contacts(List<ContactInput> contacts) { this.contacts.addAll(contacts); return this; }
        /** {@code "upsert"} (default) or {@code "skip"}. */
        public Builder onConflict(String onConflict) { this.onConflict = onConflict; return this; }

        public BatchContactsRequest build() { return new BatchContactsRequest(this); }
    }
}
