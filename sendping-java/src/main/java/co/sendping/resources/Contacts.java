package co.sendping.resources;

import co.sendping.ListParams;
import co.sendping.SendPingResponse;
import co.sendping.http.ApiClient;
import co.sendping.http.Query;
import co.sendping.requests.BatchContactsRequest;
import co.sendping.requests.CreateContactRequest;
import co.sendping.requests.ImportContactsRequest;
import co.sendping.requests.ListContactsParams;
import co.sendping.requests.UpdateContactRequest;
import co.sendping.requests.UpdateContactTopicsRequest;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Contacts (DOMAIN-FIRST) — {@code sendping.contacts()}. Each sending
 * domain has its own contact pool: the flat {@code /contacts} API requires a
 * {@code domain}, while the nested {@code /audiences/:id/contacts} API derives
 * the pool from the audience in the path. The same email address on two
 * domains is two records with separate consent.
 */
public final class Contacts extends Resource {
    public Contacts(ApiClient api) { super(api); }

    /**
     * Create a contact. Returns the slim ack {@code { object: 'contact', id }}.
     * Pass {@code domain} on the builder for the flat API (required there) or
     * {@code audienceId} for the nested API.
     */
    public SendPingResponse create(CreateContactRequest request) {
        if (request.getAudienceId() != null) {
            return api.request("POST", "/audiences/" + enc(request.getAudienceId()) + "/contacts", request.toMap());
        }
        Map<String, Object> body = new LinkedHashMap<>(request.toMap());
        // Only send `domain` when it is set: an explicit null would be reported
        // as "`domain` (null) is not one of your domains" instead of the
        // clearer "`domain` is required" the server emits for an absent one.
        if (request.getDomain() != null) body.put("domain", request.getDomain());
        return api.request("POST", "/contacts", body);
    }

    /** Retrieve a contact by id (exact — no domain needed). {@code GET /contacts/:id} */
    public SendPingResponse get(String id) {
        return api.request("GET", "/contacts/" + enc(id));
    }

    /**
     * Retrieve a contact by id or EMAIL; {@code domain} picks the pool when an
     * email exists in several domains' pools. {@code GET /contacts/:id?domain=}
     */
    public SendPingResponse get(String id, String domain) {
        Query q = new Query().add("domain", domain);
        return api.request("GET", "/contacts/" + enc(id) + q);
    }

    /** Retrieve a contact via the nested API. {@code GET /audiences/:audienceId/contacts/:id} */
    public SendPingResponse getByAudience(String audienceId, String id) {
        return api.request("GET", "/audiences/" + enc(audienceId) + "/contacts/" + enc(id));
    }

    /** List a domain pool's contacts (shortcut for the flat API). */
    public SendPingResponse list(String domain) {
        return list(ListContactsParams.builder().domain(domain).build());
    }

    /**
     * List contacts. DOMAIN-FIRST: {@code domain} is required on the flat
     * {@code GET /contacts} list (names the pool); pass {@code audienceId} to
     * use the nested list instead. {@code segmentId} works on both.
     */
    public SendPingResponse list(ListContactsParams params) {
        Query q = new Query();
        if (params.getDomain() != null && params.getAudienceId() == null) q.add("domain", params.getDomain());
        q.add("limit", params.getLimit());
        q.add("after", params.getAfter());
        q.add("before", params.getBefore());
        q.add("segment_id", params.getSegmentId());
        String base = params.getAudienceId() != null
                ? "/audiences/" + enc(params.getAudienceId()) + "/contacts"
                : "/contacts";
        return api.request("GET", base + q);
    }

    /**
     * Bulk-import contacts from a list (upsert by email; max 10,000 per call).
     * Domain-first: {@code domain} uses the flat {@code POST /contacts/batch},
     * {@code audienceId} uses {@code POST /audiences/:id/contacts/batch}.
     */
    public SendPingResponse batch(BatchContactsRequest request) {
        Query q = new Query().add("on_conflict", request.getOnConflict());
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("contacts", request.getContacts());
        if (request.getAudienceId() != null) {
            // The nested route derives its pool from the path; only the flat
            // route takes a domain.
            return api.request("POST", "/audiences/" + enc(request.getAudienceId()) + "/contacts/batch" + q, body);
        }
        body.put("domain", request.getDomain());
        return api.request("POST", "/contacts/batch" + q, body);
    }

    /**
     * Bulk-import contacts from inline CSV text, or from a file already sent
     * to the presigned URL from {@link #createImportUpload(String, String, long)}
     * (upsert by email; non-builtin columns auto-registered as custom
     * properties unless {@code createProperties(false)}).
     * {@code POST /audiences/:id/contacts/import}
     */
    public SendPingResponse importCsv(ImportContactsRequest request) {
        Query q = new Query().add("on_conflict", request.getOnConflict())
                             .add("segment_id", request.getSegmentId());
        if (Boolean.FALSE.equals(request.getCreateProperties())) q.add("create_properties", "false");
        Map<String, Object> body = new LinkedHashMap<>();
        if (request.getStorageKey() != null) {
            body.put("storage_key", request.getStorageKey());
        } else {
            body.put("csv", request.getCsv());
            if (request.getFileName() != null) body.put("file_name", request.getFileName());
        }
        return api.request("POST", "/audiences/" + enc(request.getAudienceId()) + "/contacts/import" + q, body);
    }

    /**
     * Mint a presigned direct-upload URL for a CSV too large to inline
     * (max 256 MB). PUT the file to the returned {@code upload_url}, then pass
     * the returned {@code storage_key} to
     * {@link #importCsv(ImportContactsRequest)}.
     *
     * <p>The {@code upload_url} is itself a credential — do not log it.
     * {@code POST /audiences/:id/contacts/import/upload}
     *
     * @param filename must end in {@code .csv}
     * @param size     the file size in bytes; must be greater than zero
     */
    public SendPingResponse createImportUpload(String audienceId, String filename, long size) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("filename", filename);
        body.put("size", size);
        return api.request("POST", "/audiences/" + enc(audienceId) + "/contacts/import/upload", body);
    }

    /**
     * Update a contact. Returns the slim ack. On the flat API, set
     * {@code domain} on the builder when the id is an EMAIL.
     */
    public SendPingResponse update(UpdateContactRequest request) {
        if (request.getAudienceId() != null) {
            return api.request("PATCH",
                    "/audiences/" + enc(request.getAudienceId()) + "/contacts/" + enc(request.getId()),
                    request.toMap());
        }
        Map<String, Object> body = new LinkedHashMap<>(request.toMap());
        if (request.getDomain() != null) body.put("domain", request.getDomain());
        return api.request("PATCH", "/contacts/" + enc(request.getId()), body);
    }

    /** Delete a contact by id. {@code DELETE /contacts/:id} */
    public SendPingResponse remove(String id) {
        return api.request("DELETE", "/contacts/" + enc(id));
    }

    /** Delete a contact by id or EMAIL + domain. {@code DELETE /contacts/:id?domain=} */
    public SendPingResponse remove(String id, String domain) {
        Query q = new Query().add("domain", domain);
        return api.request("DELETE", "/contacts/" + enc(id) + q);
    }

    /** Delete a contact via the nested API. {@code DELETE /audiences/:audienceId/contacts/:id} */
    public SendPingResponse removeByAudience(String audienceId, String id) {
        return api.request("DELETE", "/audiences/" + enc(audienceId) + "/contacts/" + enc(id));
    }

    /** Add a contact to a segment. {@code POST /contacts/:id/segments/:segmentId} */
    public SendPingResponse addToSegment(String id, String segmentId) {
        return api.request("POST", "/contacts/" + enc(id) + "/segments/" + enc(segmentId));
    }

    /** Remove a contact from a segment. {@code DELETE /contacts/:id/segments/:segmentId} */
    public SendPingResponse removeFromSegment(String id, String segmentId) {
        return api.request("DELETE", "/contacts/" + enc(id) + "/segments/" + enc(segmentId));
    }

    /**
     * List the segments a contact belongs to. Items carry only
     * {@code id} / {@code name} / {@code created_at}, not the full segment
     * object. With no pagination params the route skips paging and answers with
     * the whole set — but still no more than <strong>1,000</strong> rows, and
     * {@code has_more} goes true when that ceiling bites, so keep paging with
     * {@code after} rather than assuming one call saw everything.
     * {@code GET /contacts/:id/segments}
     */
    public SendPingResponse listSegments(String id) { return listSegments(id, null); }

    public SendPingResponse listSegments(String id, ListParams params) {
        return api.request("GET", "/contacts/" + enc(id) + "/segments" + paginate(params));
    }

    /** Get a contact's topic subscriptions. {@code GET /contacts/:id/topics} */
    public SendPingResponse getTopics(String id) { return getTopics(id, null); }

    public SendPingResponse getTopics(String id, ListParams params) {
        return api.request("GET", "/contacts/" + enc(id) + "/topics" + paginate(params));
    }

    /** Update a contact's topic subscriptions. {@code PATCH /contacts/:id/topics} */
    public SendPingResponse updateTopics(String id, UpdateContactTopicsRequest request) {
        return api.request("PATCH", "/contacts/" + enc(id) + "/topics", request);
    }
}
