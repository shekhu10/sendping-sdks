namespace SendPing;

public partial interface ISendPing
{
    // ---- Audiences ----

    /// <summary>Create an audience. POST /audiences</summary>
    Task<Audience> AudienceCreateAsync(string name, CancellationToken cancellationToken = default);

    /// <summary>Retrieve an audience. GET /audiences/:id</summary>
    Task<Audience> AudienceRetrieveAsync(string audienceId, CancellationToken cancellationToken = default);

    /// <summary>List audiences (includes each domain's contact-pool audience). GET /audiences</summary>
    Task<ListResponse<Audience>> AudienceListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Rename an audience. PATCH /audiences/:id</summary>
    Task<Audience> AudienceUpdateAsync(string audienceId, string name, CancellationToken cancellationToken = default);

    /// <summary>
    /// Import contacts from a link-shared Google Sheet. Header columns become
    /// contact properties; rows land in a fresh segment.
    /// POST /audiences/:id/contacts/import-sheet
    /// </summary>
    Task<SheetImportResult> AudienceImportSheetAsync(string audienceId, string sheetUrl, string? segmentName = null, CancellationToken cancellationToken = default);

    /// <summary>Delete an audience. DELETE /audiences/:id</summary>
    Task<RemovedResponse> AudienceDeleteAsync(string audienceId, CancellationToken cancellationToken = default);

    // ---- Contacts (domain-first) ----

    /// <summary>
    /// Create a contact. DOMAIN-FIRST: set <c>options.Domain</c> to create in
    /// that sending domain's contact pool via the flat /contacts API (required
    /// there), or <c>options.AudienceId</c> to target a specific audience via
    /// the nested API. POST /contacts | POST /audiences/:id/contacts
    /// </summary>
    Task<ObjectRef> ContactCreateAsync(ContactCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>
    /// Retrieve a contact by id or email. An id is exact; an EMAIL can exist in
    /// several domains' pools, so pass <paramref name="domain"/> to pick the pool
    /// (omitted ⇒ the oldest match anywhere). GET /contacts/:id
    /// </summary>
    Task<Contact> ContactRetrieveAsync(string contactIdOrEmail, string? domain = null, string? audienceId = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// List contacts. DOMAIN-FIRST: <c>options.Domain</c> is REQUIRED on the flat
    /// /contacts list (names the pool) unless <c>options.AudienceId</c> is set.
    /// GET /contacts | GET /audiences/:id/contacts
    /// </summary>
    Task<ListResponse<Contact>> ContactListAsync(ContactListOptions options, CancellationToken cancellationToken = default);

    /// <summary>
    /// Bulk-import contacts from an array. Upserts by email; max 10,000 per call.
    /// <paramref name="onConflict"/> <c>skip</c> leaves existing contacts untouched
    /// (default <c>upsert</c>). POST /audiences/:id/contacts/batch
    /// </summary>
    Task<ImportContactsResponse> ContactBatchAsync(string audienceId, IEnumerable<ContactInput> contacts, string? onConflict = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Bulk-import contacts into a DOMAIN's contact pool (domain-first model).
    /// Upserts by email; max 10,000 per call. <paramref name="onConflict"/>
    /// <c>skip</c> leaves existing contacts untouched (default <c>upsert</c>).
    /// POST /contacts/batch
    /// </summary>
    /// <remarks>
    /// Prefer this (or <see cref="ContactBatchAsync"/>) over a
    /// <see cref="ContactCreateAsync"/> loop for many contacts: one batch takes
    /// the account's contact-limit lock once, a loop takes it per contact.
    /// </remarks>
    Task<ImportContactsResponse> ContactBatchInDomainAsync(string domain, IEnumerable<ContactInput> contacts, string? onConflict = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Bulk-import contacts from CSV text (header row optional). Upserts by email.
    /// By default every non-builtin CSV column is auto-registered as a custom
    /// property; pass <paramref name="createProperties"/> false for strict mode.
    /// <paramref name="segmentId"/> also adds every imported email to that segment
    /// (it must belong to this audience) and populates <c>SegmentAdded</c> on the
    /// response. <paramref name="fileName"/> is the name recorded for the archived
    /// copy (defaults to <c>contacts.csv</c>).
    /// POST /audiences/:id/contacts/import
    /// </summary>
    Task<ImportContactsResponse> ContactImportAsync(string audienceId, string csv, string? onConflict = null, bool? createProperties = null, string? segmentId = null, string? fileName = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Mint a presigned direct-upload slot for a contact CSV too large for the
    /// inline 5 MB / 10,000-row path (max 256 MB). PUT the file to the returned
    /// <c>UploadUrl</c>, then call <see cref="ContactImportStorageKeyAsync"/>.
    /// POST /audiences/:id/contacts/import/upload
    /// </summary>
    Task<ContactImportUpload> ContactImportCreateUploadAsync(string audienceId, string fileName, long sizeBytes, CancellationToken cancellationToken = default);

    /// <summary>
    /// Import a CSV that was uploaded via
    /// <see cref="ContactImportCreateUploadAsync"/>. Contacts beyond the plan's
    /// remaining capacity are reported as <c>LimitSkipped</c> rather than failing
    /// the request. <paramref name="segmentId"/> also adds every imported email to
    /// that segment (it must belong to this audience) and populates
    /// <c>SegmentAdded</c> on the response.
    /// POST /audiences/:id/contacts/import
    /// </summary>
    Task<ImportContactsResponse> ContactImportStorageKeyAsync(string audienceId, string storageKey, string? onConflict = null, bool? createProperties = null, string? segmentId = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Update a contact. On the flat API, set <c>options.Domain</c> when
    /// <c>options.Id</c> is an EMAIL (disambiguates across pools).
    /// PATCH /contacts/:id | PATCH /audiences/:id/contacts/:id
    /// </summary>
    Task<ObjectRef> ContactUpdateAsync(ContactUpdateOptions options, CancellationToken cancellationToken = default);

    /// <summary>
    /// Delete a contact. On the flat API, pass <paramref name="domain"/> when
    /// <paramref name="contactIdOrEmail"/> is an EMAIL. DELETE /contacts/:id
    /// </summary>
    Task<ContactDeleted> ContactDeleteAsync(string contactIdOrEmail, string? domain = null, string? audienceId = null, CancellationToken cancellationToken = default);

    /// <summary>Add a contact to a segment. POST /contacts/:id/segments/:segmentId</summary>
    Task<IdResponse> ContactAddToSegmentAsync(string contactId, string segmentId, CancellationToken cancellationToken = default);

    /// <summary>Remove a contact from a segment. DELETE /contacts/:id/segments/:segmentId</summary>
    Task<SegmentMembershipRemoved> ContactRemoveFromSegmentAsync(string contactId, string segmentId, CancellationToken cancellationToken = default);

    /// <summary>
    /// List the segments a contact belongs to. Rows carry only id/name/created_at
    /// (see <see cref="ContactSegmentRef"/>), not the full segment.
    /// GET /contacts/:id/segments
    /// </summary>
    Task<ListResponse<ContactSegmentRef>> ContactListSegmentsAsync(string contactId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Get a contact's topic subscriptions. Passing no
    /// <paramref name="pagination"/> asks for them all in one response — the
    /// endpoint only slices to a page size when you supply pagination params —
    /// but it is still capped at 1,000 rows, and <c>HasMore</c> says so when the
    /// cap bites. GET /contacts/:id/topics
    /// </summary>
    Task<ContactTopics> ContactRetrieveTopicsAsync(string contactId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>Update a contact's topic subscriptions. PATCH /contacts/:id/topics</summary>
    Task<IdResponse> ContactUpdateTopicsAsync(string contactId, ContactTopicsUpdateOptions options, CancellationToken cancellationToken = default);

    // ---- Contact properties (custom fields / merge tags) ----

    /// <summary>Register a custom contact property. POST /contact-properties</summary>
    Task<ObjectRef> ContactPropertyCreateAsync(ContactPropertyCreateOptions options, CancellationToken cancellationToken = default);

    /// <summary>Retrieve a contact property. GET /contact-properties/:id</summary>
    Task<ContactProperty> ContactPropertyRetrieveAsync(string propertyId, CancellationToken cancellationToken = default);

    /// <summary>List contact properties. GET /contact-properties</summary>
    Task<ListResponse<ContactProperty>> ContactPropertyListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Update a contact property's fallback value (the only mutable field;
    /// key/type are immutable). Pass null to clear it. PATCH /contact-properties/:id
    /// </summary>
    Task<ObjectRef> ContactPropertyUpdateAsync(string propertyId, object? fallbackValue, CancellationToken cancellationToken = default);

    /// <summary>Delete a contact property. DELETE /contact-properties/:id</summary>
    Task<RemovedResponse> ContactPropertyDeleteAsync(string propertyId, CancellationToken cancellationToken = default);
}
