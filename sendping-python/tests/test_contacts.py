import sendping

from .helpers import RecordingTestCase


class TestContacts(RecordingTestCase):
    def test_create_flat_requires_domain_in_body(self):
        sendping.Contacts.create(
            {"domain": "acme.com", "email": "user@example.com", "first_name": "Ada"}
        )
        self.assertCall(
            "POST",
            "/contacts",
            {"email": "user@example.com", "first_name": "Ada", "domain": "acme.com"},
        )

    def test_create_nested_audience_strips_routing_keys(self):
        sendping.Contacts.create({"audience_id": "aud_1", "email": "user@example.com"})
        self.assertCall("POST", "/audiences/aud_1/contacts", {"email": "user@example.com"})

    def test_get_by_id(self):
        sendping.Contacts.get({"id": "con_1"})
        self.assertCall("GET", "/contacts/con_1")

    def test_get_by_email_and_domain(self):
        sendping.Contacts.get({"id": "user@example.com", "domain": "acme.com"})
        self.assertCall("GET", "/contacts/user%40example.com?domain=acme.com")

    def test_get_nested_audience(self):
        sendping.Contacts.get({"id": "con_1", "audience_id": "aud_1"})
        self.assertCall("GET", "/audiences/aud_1/contacts/con_1")

    def test_list_flat_domain(self):
        sendping.Contacts.list({"domain": "acme.com", "limit": 50})
        self.assertCall("GET", "/contacts?domain=acme.com&limit=50")

    def test_list_audience_with_segment_filter(self):
        sendping.Contacts.list({"audience_id": "aud_1", "segment_id": "seg_1"})
        self.assertCall("GET", "/audiences/aud_1/contacts?segment_id=seg_1")

    def test_batch_import(self):
        contacts = [{"email": "a@b.com"}, {"email": "c@d.com", "first_name": "C"}]
        sendping.Contacts.batch(
            {"audience_id": "aud_1", "contacts": contacts, "on_conflict": "skip"}
        )
        self.assertCall(
            "POST", "/audiences/aud_1/contacts/batch?on_conflict=skip", {"contacts": contacts}
        )

    def test_batch_import_domain_first(self):
        # The domain-first bulk door. One batch takes the account's
        # contact-limit lock once; a create() loop takes it per contact.
        contacts = [{"email": "a@b.com"}, {"email": "c@d.com"}]
        sendping.Contacts.batch({"domain": "x.com", "contacts": contacts})
        # `domain` travels in the BODY here, exactly as for POST /contacts.
        self.assertCall("POST", "/contacts/batch", {"contacts": contacts, "domain": "x.com"})

        sendping.Contacts.batch(
            {"domain": "x.com", "contacts": contacts, "on_conflict": "skip"}
        )
        self.assertCall(
            "POST", "/contacts/batch?on_conflict=skip", {"contacts": contacts, "domain": "x.com"}
        )

        # The audience-scoped form must NOT start sending a domain.
        sendping.Contacts.batch({"audience_id": "aud_1", "contacts": contacts})
        self.assertCall("POST", "/audiences/aud_1/contacts/batch", {"contacts": contacts})

    def test_import_csv(self):
        sendping.Contacts.import_csv(
            {
                "audience_id": "aud_1",
                "csv": "email,company\na@b.com,Acme",
                "on_conflict": "skip",
                "create_properties": False,
            }
        )
        self.assertCall(
            "POST",
            "/audiences/aud_1/contacts/import?on_conflict=skip&create_properties=false",
            {"csv": "email,company\na@b.com,Acme"},
        )

    def test_import_csv_defaults(self):
        sendping.Contacts.import_csv({"audience_id": "aud_1", "csv": "email\na@b.com"})
        self.assertCall("POST", "/audiences/aud_1/contacts/import", {"csv": "email\na@b.com"})

    def test_import_csv_with_segment_and_file_name(self):
        sendping.Contacts.import_csv(
            {
                "audience_id": "aud_1",
                "csv": "email\na@b.com",
                "segment_id": "seg_1",
                "file_name": "leads.csv",
            }
        )
        self.assertCall(
            "POST",
            "/audiences/aud_1/contacts/import?segment_id=seg_1",
            {"csv": "email\na@b.com", "file_name": "leads.csv"},
        )

    def test_import_csv_from_storage_key(self):
        sendping.Contacts.import_csv({"audience_id": "aud_1", "storage_key": "imports/x.csv"})
        self.assertCall(
            "POST", "/audiences/aud_1/contacts/import", {"storage_key": "imports/x.csv"}
        )

    def test_create_import_upload(self):
        sendping.Contacts.create_import_upload(
            {"audience_id": "aud_1", "filename": "big.csv", "size": 90000000}
        )
        self.assertCall(
            "POST",
            "/audiences/aud_1/contacts/import/upload",
            {"filename": "big.csv", "size": 90000000},
        )

    def test_update_flat_email_with_domain(self):
        sendping.Contacts.update(
            {"id": "user@example.com", "domain": "acme.com", "unsubscribed": True}
        )
        self.assertCall(
            "PATCH",
            "/contacts/user%40example.com",
            {"unsubscribed": True, "domain": "acme.com"},
        )

    def test_update_flat_by_id_no_domain(self):
        sendping.Contacts.update({"id": "con_1", "first_name": "Ada"})
        self.assertCall("PATCH", "/contacts/con_1", {"first_name": "Ada"})

    def test_update_nested_audience(self):
        sendping.Contacts.update({"id": "con_1", "audience_id": "aud_1", "last_name": "L"})
        self.assertCall("PATCH", "/audiences/aud_1/contacts/con_1", {"last_name": "L"})

    def test_remove_flat_with_domain(self):
        sendping.Contacts.remove({"id": "user@example.com", "domain": "acme.com"})
        self.assertCall("DELETE", "/contacts/user%40example.com?domain=acme.com")

    def test_remove_nested(self):
        sendping.Contacts.remove({"id": "con_1", "audience_id": "aud_1"})
        self.assertCall("DELETE", "/audiences/aud_1/contacts/con_1")

    def test_segment_membership(self):
        sendping.Contacts.add_to_segment("con_1", "seg_1")
        self.assertCall("POST", "/contacts/con_1/segments/seg_1")
        sendping.Contacts.remove_from_segment("con_1", "seg_1")
        self.assertCall("DELETE", "/contacts/con_1/segments/seg_1")
        sendping.Contacts.list_segments("con_1")
        self.assertCall("GET", "/contacts/con_1/segments")
        sendping.Contacts.list_segments("con_1", {"limit": 5})
        self.assertCall("GET", "/contacts/con_1/segments?limit=5")

    def test_topics(self):
        sendping.Contacts.get_topics("con_1")
        self.assertCall("GET", "/contacts/con_1/topics")
        sendping.Contacts.get_topics("con_1", {"limit": 5})
        self.assertCall("GET", "/contacts/con_1/topics?limit=5")
        payload = {"topics": [{"id": "top_1", "subscription": "opt_in"}]}
        sendping.Contacts.update_topics("con_1", payload)
        self.assertCall("PATCH", "/contacts/con_1/topics", payload)
