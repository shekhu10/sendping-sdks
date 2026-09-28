using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace SendPing;

public partial class SendPingClient
{
    // ---- Audiences ----

    public Task<Audience> AudienceCreateAsync(string name, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(name);
        var body = new Dictionary<string, string> { ["name"] = name };
        return RequestAsync<Audience>(HttpMethod.Post, "/audiences", body, null, cancellationToken);
    }

    public Task<Audience> AudienceRetrieveAsync(string audienceId, CancellationToken cancellationToken = default)
        => RequestAsync<Audience>(HttpMethod.Get, $"/audiences/{E(audienceId)}", null, null, cancellationToken);

    public Task<ListResponse<Audience>> AudienceListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<Audience>>(HttpMethod.Get, "/audiences" + Paginate(pagination), null, null, cancellationToken);

    public Task<Audience> AudienceUpdateAsync(string audienceId, string name, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(name);
        var body = new Dictionary<string, string> { ["name"] = name };
        return RequestAsync<Audience>(HttpMethod.Patch, $"/audiences/{E(audienceId)}", body, null, cancellationToken);
    }

    public Task<SheetImportResult> AudienceImportSheetAsync(string audienceId, string sheetUrl, string? segmentName = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(sheetUrl);
        var body = new Dictionary<string, string> { ["url"] = sheetUrl };
        if (segmentName is not null) body["segment_name"] = segmentName;
        return RequestAsync<SheetImportResult>(HttpMethod.Post, $"/audiences/{E(audienceId)}/contacts/import-sheet", body, null, cancellationToken);
    }

    public Task<RemovedResponse> AudienceDeleteAsync(string audienceId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/audiences/{E(audienceId)}", null, null, cancellationToken);

    // ---- Contacts (domain-first) ----

    public Task<ObjectRef> ContactCreateAsync(ContactCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);

        // The nested audience route derives its pool from the path; only the
        // flat route takes `domain` in the body (Domain/AudienceId are
        // [JsonIgnore] routing-only members).
        if (options.AudienceId is not null)
        {
            return RequestAsync<ObjectRef>(HttpMethod.Post, $"/audiences/{E(options.AudienceId)}/contacts", options, null, cancellationToken);
        }

        var body = JsonSerializer.SerializeToNode(options, SendPingJson.Options)!.AsObject();
        if (options.Domain is not null) body["domain"] = options.Domain;
        return RequestAsync<ObjectRef>(HttpMethod.Post, "/contacts", body, null, cancellationToken);
    }

    public Task<Contact> ContactRetrieveAsync(string contactIdOrEmail, string? domain = null, string? audienceId = null, CancellationToken cancellationToken = default)
    {
        if (audienceId is not null)
        {
            return RequestAsync<Contact>(HttpMethod.Get, $"/audiences/{E(audienceId)}/contacts/{E(contactIdOrEmail)}", null, null, cancellationToken);
        }
        return RequestAsync<Contact>(HttpMethod.Get, $"/contacts/{E(contactIdOrEmail)}" + Query(("domain", domain)), null, null, cancellationToken);
    }

    public Task<ListResponse<Contact>> ContactListAsync(ContactListOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        var basePath = options.AudienceId is not null ? $"/audiences/{E(options.AudienceId)}/contacts" : "/contacts";
        var query = Query(
            ("domain", options.AudienceId is null ? options.Domain : null),
            ("limit", options.Limit?.ToString(CultureInfo.InvariantCulture)),
            ("after", options.After),
            ("before", options.Before),
            // segment_id filter is honored by both the flat and audience-scoped list.
            ("segment_id", options.SegmentId));
        return RequestAsync<ListResponse<Contact>>(HttpMethod.Get, basePath + query, null, null, cancellationToken);
    }

    public Task<ImportContactsResponse> ContactBatchAsync(string audienceId, IEnumerable<ContactInput> contacts, string? onConflict = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(contacts);
        var body = new Dictionary<string, object> { ["contacts"] = contacts as IList<ContactInput> ?? contacts.ToList() };
        return RequestAsync<ImportContactsResponse>(HttpMethod.Post, $"/audiences/{E(audienceId)}/contacts/batch" + Query(("on_conflict", onConflict)), body, null, cancellationToken);
    }

    public Task<ImportContactsResponse> ContactBatchInDomainAsync(string domain, IEnumerable<ContactInput> contacts, string? onConflict = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(contacts);
        // The nested audience route derives its pool from the path; only the flat
        // route takes `domain`, and it takes it in the body (same as POST /contacts).
        var body = new Dictionary<string, object>
        {
            ["contacts"] = contacts as IList<ContactInput> ?? contacts.ToList(),
            ["domain"] = domain,
        };
        return RequestAsync<ImportContactsResponse>(HttpMethod.Post, "/contacts/batch" + Query(("on_conflict", onConflict)), body, null, cancellationToken);
    }

    public Task<ImportContactsResponse> ContactImportAsync(string audienceId, string csv, string? onConflict = null, bool? createProperties = null, string? segmentId = null, string? fileName = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(csv);
        var query = Query(
            ("on_conflict", onConflict),
            ("create_properties", createProperties == false ? "false" : null),
            ("segment_id", segmentId));
        var body = new Dictionary<string, string> { ["csv"] = csv };
        if (fileName is not null) body["file_name"] = fileName;
        return RequestAsync<ImportContactsResponse>(HttpMethod.Post, $"/audiences/{E(audienceId)}/contacts/import" + query, body, null, cancellationToken);
    }

    public Task<ContactImportUpload> ContactImportCreateUploadAsync(string audienceId, string fileName, long sizeBytes, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(fileName);
        var body = new Dictionary<string, object> { ["filename"] = fileName, ["size"] = sizeBytes };
        return RequestAsync<ContactImportUpload>(HttpMethod.Post, $"/audiences/{E(audienceId)}/contacts/import/upload", body, null, cancellationToken);
    }

    public Task<ImportContactsResponse> ContactImportStorageKeyAsync(string audienceId, string storageKey, string? onConflict = null, bool? createProperties = null, string? segmentId = null, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(storageKey);
        var query = Query(
            ("on_conflict", onConflict),
            ("create_properties", createProperties == false ? "false" : null),
            ("segment_id", segmentId));
        var body = new Dictionary<string, string> { ["storage_key"] = storageKey };
        return RequestAsync<ImportContactsResponse>(HttpMethod.Post, $"/audiences/{E(audienceId)}/contacts/import" + query, body, null, cancellationToken);
    }

    public Task<ObjectRef> ContactUpdateAsync(ContactUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(options.Id);

        if (options.AudienceId is not null)
        {
            return RequestAsync<ObjectRef>(HttpMethod.Patch, $"/audiences/{E(options.AudienceId)}/contacts/{E(options.Id)}", options, null, cancellationToken);
        }

        // The flat route takes an optional `domain` in the body (disambiguates
        // an email id across pools).
        var body = JsonSerializer.SerializeToNode(options, SendPingJson.Options)!.AsObject();
        if (options.Domain is not null) body["domain"] = options.Domain;
        return RequestAsync<ObjectRef>(HttpMethod.Patch, $"/contacts/{E(options.Id)}", body, null, cancellationToken);
    }

    public Task<ContactDeleted> ContactDeleteAsync(string contactIdOrEmail, string? domain = null, string? audienceId = null, CancellationToken cancellationToken = default)
    {
        if (audienceId is not null)
        {
            return RequestAsync<ContactDeleted>(HttpMethod.Delete, $"/audiences/{E(audienceId)}/contacts/{E(contactIdOrEmail)}", null, null, cancellationToken);
        }
        return RequestAsync<ContactDeleted>(HttpMethod.Delete, $"/contacts/{E(contactIdOrEmail)}" + Query(("domain", domain)), null, null, cancellationToken);
    }

    public Task<IdResponse> ContactAddToSegmentAsync(string contactId, string segmentId, CancellationToken cancellationToken = default)
        => RequestAsync<IdResponse>(HttpMethod.Post, $"/contacts/{E(contactId)}/segments/{E(segmentId)}", null, null, cancellationToken);

    public Task<SegmentMembershipRemoved> ContactRemoveFromSegmentAsync(string contactId, string segmentId, CancellationToken cancellationToken = default)
        => RequestAsync<SegmentMembershipRemoved>(HttpMethod.Delete, $"/contacts/{E(contactId)}/segments/{E(segmentId)}", null, null, cancellationToken);

    public Task<ListResponse<ContactSegmentRef>> ContactListSegmentsAsync(string contactId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<ContactSegmentRef>>(HttpMethod.Get, $"/contacts/{E(contactId)}/segments" + Paginate(pagination), null, null, cancellationToken);

    public Task<ContactTopics> ContactRetrieveTopicsAsync(string contactId, PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ContactTopics>(HttpMethod.Get, $"/contacts/{E(contactId)}/topics" + Paginate(pagination), null, null, cancellationToken);

    public Task<IdResponse> ContactUpdateTopicsAsync(string contactId, ContactTopicsUpdateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<IdResponse>(HttpMethod.Patch, $"/contacts/{E(contactId)}/topics", options, null, cancellationToken);
    }

    // ---- Contact properties ----

    public Task<ObjectRef> ContactPropertyCreateAsync(ContactPropertyCreateOptions options, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        return RequestAsync<ObjectRef>(HttpMethod.Post, "/contact-properties", options, null, cancellationToken);
    }

    public Task<ContactProperty> ContactPropertyRetrieveAsync(string propertyId, CancellationToken cancellationToken = default)
        => RequestAsync<ContactProperty>(HttpMethod.Get, $"/contact-properties/{E(propertyId)}", null, null, cancellationToken);

    public Task<ListResponse<ContactProperty>> ContactPropertyListAsync(PaginationOptions? pagination = null, CancellationToken cancellationToken = default)
        => RequestAsync<ListResponse<ContactProperty>>(HttpMethod.Get, "/contact-properties" + Paginate(pagination), null, null, cancellationToken);

    public Task<ObjectRef> ContactPropertyUpdateAsync(string propertyId, object? fallbackValue, CancellationToken cancellationToken = default)
    {
        // Dictionary values are always written, so an explicit null clears the
        // fallback (property-level WhenWritingNull does not apply here).
        var body = new Dictionary<string, object?> { ["fallback_value"] = fallbackValue };
        return RequestAsync<ObjectRef>(HttpMethod.Patch, $"/contact-properties/{E(propertyId)}", body, null, cancellationToken);
    }

    public Task<RemovedResponse> ContactPropertyDeleteAsync(string propertyId, CancellationToken cancellationToken = default)
        => RequestAsync<RemovedResponse>(HttpMethod.Delete, $"/contact-properties/{E(propertyId)}", null, null, cancellationToken);
}
