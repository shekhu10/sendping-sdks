package co.sendping.tests;

import co.sendping.SendPing;
import co.sendping.requests.BatchContactsRequest;
import co.sendping.requests.ContactInput;
import co.sendping.requests.CreateContactRequest;
import co.sendping.requests.ImportContactsRequest;
import co.sendping.requests.ListContactsParams;
import co.sendping.requests.UpdateContactRequest;
import co.sendping.requests.UpdateContactTopicsRequest;

/** Domain-first contacts: flat vs nested routing, imports, segments, topics. */
public final class ContactsTest {
    public static void run() {
        Check.suite("ContactsTest");
        StubTransport t = new StubTransport();
        SendPing mb = new SendPing("mb_test_key", "https://api.test", t);
        t.respond(200, "{\"object\":\"contact\",\"id\":\"c_1\"}");

        // --- flat create carries domain in the body ---
        mb.contacts().create(CreateContactRequest.builder()
                .domain("example.com")
                .email("ada@lovelace.dev")
                .firstName("Ada")
                .property("plan", "pro")
                .build());
        Check.eq("flat create url", "https://api.test/contacts", t.lastUrl);
        Check.eq("flat create method", "POST", t.lastMethod);
        Check.contains("flat create body has domain", t.lastBody, "\"domain\":\"example.com\"");
        Check.contains("flat create body has properties", t.lastBody, "\"properties\":{\"plan\":\"pro\"}");

        // --- nested create routes via the audience path, no domain in body ---
        mb.contacts().create(CreateContactRequest.builder()
                .audienceId("aud_1")
                .email("ada@lovelace.dev")
                .build());
        Check.eq("nested create url", "https://api.test/audiences/aud_1/contacts", t.lastUrl);
        Check.notContains("nested create body has no domain", t.lastBody, "domain");
        Check.notContains("nested create body has no audienceId", t.lastBody, "audienceId");

        // --- get by email + domain (email is percent-encoded) ---
        mb.contacts().get("ada@lovelace.dev", "example.com");
        Check.eq("get by email url",
                "https://api.test/contacts/ada%40lovelace.dev?domain=example.com", t.lastUrl);
        mb.contacts().get("c_1");
        Check.eq("get by id url", "https://api.test/contacts/c_1", t.lastUrl);
        mb.contacts().getByAudience("aud_1", "c_1");
        Check.eq("get nested url", "https://api.test/audiences/aud_1/contacts/c_1", t.lastUrl);

        // --- list: flat requires domain; nested drops the domain param ---
        mb.contacts().list(ListContactsParams.builder()
                .domain("example.com").limit(10).segmentId("seg_1").build());
        Check.eq("flat list url",
                "https://api.test/contacts?domain=example.com&limit=10&segment_id=seg_1", t.lastUrl);
        mb.contacts().list(ListContactsParams.builder()
                .audienceId("aud_1").domain("example.com").limit(5).build());
        Check.eq("nested list url (no domain param)",
                "https://api.test/audiences/aud_1/contacts?limit=5", t.lastUrl);
        mb.contacts().list("example.com");
        Check.eq("list shortcut url", "https://api.test/contacts?domain=example.com", t.lastUrl);

        // --- batch import ---
        mb.contacts().batch(BatchContactsRequest.builder()
                .audienceId("aud_1")
                .contact(ContactInput.builder().email("a@b.com").firstName("A").build())
                .onConflict("skip")
                .build());
        Check.eq("batch url", "https://api.test/audiences/aud_1/contacts/batch?on_conflict=skip", t.lastUrl);
        Check.eq("batch body",
                "{\"contacts\":[{\"email\":\"a@b.com\",\"first_name\":\"A\"}]}", t.lastBody);

        // --- batch import, domain-first ---
        // One batch takes the account's contact-limit lock once; a
        // create-per-contact loop takes it per contact.
        mb.contacts().batch(BatchContactsRequest.builder()
                .domain("x.com")
                .contact(ContactInput.builder().email("a@b.com").build())
                .build());
        Check.eq("batch flat url", "https://api.test/contacts/batch", t.lastUrl);
        // `domain` travels in the BODY on the flat route, same as POST /contacts.
        Check.eq("batch flat body",
                "{\"contacts\":[{\"email\":\"a@b.com\"}],\"domain\":\"x.com\"}", t.lastBody);

        mb.contacts().batch(BatchContactsRequest.builder()
                .domain("x.com")
                .contact(ContactInput.builder().email("a@b.com").build())
                .onConflict("skip")
                .build());
        Check.eq("batch flat url keeps on_conflict",
                "https://api.test/contacts/batch?on_conflict=skip", t.lastUrl);

        // Neither target is a programming error, caught at build() time.
        boolean threw = false;
        try {
            BatchContactsRequest.builder()
                    .contact(ContactInput.builder().email("a@b.com").build())
                    .build();
        } catch (IllegalStateException expected) {
            threw = true;
        }
        Check.eq("batch requires a target", true, threw);

        // --- CSV import with strict properties ---
        mb.contacts().importCsv(ImportContactsRequest.builder()
                .audienceId("aud_1")
                .csv("email,company\na@b.com,Acme")
                .createProperties(false)
                .build());
        Check.eq("import url",
                "https://api.test/audiences/aud_1/contacts/import?create_properties=false", t.lastUrl);
        Check.eq("import body", "{\"csv\":\"email,company\\na@b.com,Acme\"}", t.lastBody);

        // --- update: flat with email id + domain disambiguator ---
        mb.contacts().update(UpdateContactRequest.builder()
                .id("ada@lovelace.dev").domain("example.com").unsubscribed(true).build());
        Check.eq("flat update url", "https://api.test/contacts/ada%40lovelace.dev", t.lastUrl);
        Check.eq("flat update method", "PATCH", t.lastMethod);
        Check.eq("flat update body",
                "{\"unsubscribed\":true,\"domain\":\"example.com\"}", t.lastBody);

        // --- update nested ---
        mb.contacts().update(UpdateContactRequest.builder()
                .audienceId("aud_1").id("c_1").firstName("Ada").build());
        Check.eq("nested update url", "https://api.test/audiences/aud_1/contacts/c_1", t.lastUrl);
        Check.notContains("nested update body has no domain", t.lastBody, "domain");

        // --- remove variants ---
        mb.contacts().remove("ada@lovelace.dev", "example.com");
        Check.eq("flat remove url",
                "https://api.test/contacts/ada%40lovelace.dev?domain=example.com", t.lastUrl);
        Check.eq("remove method", "DELETE", t.lastMethod);
        mb.contacts().removeByAudience("aud_1", "c_1");
        Check.eq("nested remove url", "https://api.test/audiences/aud_1/contacts/c_1", t.lastUrl);

        // --- segment membership + topics ---
        mb.contacts().addToSegment("c_1", "seg_1");
        Check.eq("addToSegment url", "https://api.test/contacts/c_1/segments/seg_1", t.lastUrl);
        Check.eq("addToSegment method", "POST", t.lastMethod);
        mb.contacts().removeFromSegment("c_1", "seg_1");
        Check.eq("removeFromSegment method", "DELETE", t.lastMethod);
        mb.contacts().listSegments("c_1");
        Check.eq("listSegments url", "https://api.test/contacts/c_1/segments", t.lastUrl);
        mb.contacts().getTopics("c_1");
        Check.eq("getTopics url", "https://api.test/contacts/c_1/topics", t.lastUrl);
        mb.contacts().updateTopics("c_1", UpdateContactTopicsRequest.builder()
                .optIn("top_1").optOut("top_2").build());
        Check.eq("updateTopics method", "PATCH", t.lastMethod);
        Check.eq("updateTopics body",
                "{\"topics\":[{\"id\":\"top_1\",\"subscription\":\"opt_in\"},"
                        + "{\"id\":\"top_2\",\"subscription\":\"opt_out\"}]}",
                t.lastBody);
    }

    public static void main(String[] args) {
        run();
        Check.finish();
    }
}
