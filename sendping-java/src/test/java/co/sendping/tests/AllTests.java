package co.sendping.tests;

/** Runs every suite in one JVM and exits non-zero if anything failed. */
public final class AllTests {
    public static void main(String[] args) throws Exception {
        EmailsTest.run();
        ContactsTest.run();
        SegmentsCampaignsTest.run();
        DomainsTest.run();
        WebhooksTest.run();
        WebhookKeyConformanceTest.run();
        MiscResourcesTest.run();
        ContractParityTest.run();
        HttpCoreTest.run();
        RecoveryTest.run();
        Check.finish();
    }
}
