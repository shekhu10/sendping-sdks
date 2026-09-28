package co.sendping.tests;

import co.sendping.SendPing;
import co.sendping.requests.ClaimDomainRequest;
import co.sendping.requests.CreateDomainRequest;
import co.sendping.requests.UpdateDomainRequest;

/** Domains incl. claim flow and one-click DNS applies. */
public final class DomainsTest {
    public static void run() {
        Check.suite("DomainsTest");
        StubTransport t = new StubTransport();
        SendPing mb = new SendPing("mb_test_key", "https://api.test", t);
        t.respond(200, "{\"object\":\"domain\",\"id\":\"dom_1\",\"status\":\"pending\"}");

        // --- create with capabilities ---
        mb.domains().create(CreateDomainRequest.builder()
                .name("example.com")
                .region("us-east-1")
                .clickTracking(true)
                .receiving(true)
                .build());
        Check.eq("domain create url", "https://api.test/domains", t.lastUrl);
        Check.eq("domain create body",
                "{\"name\":\"example.com\",\"region\":\"us-east-1\",\"click_tracking\":true,"
                        + "\"capabilities\":{\"receiving\":\"enabled\"}}",
                t.lastBody);

        // --- verify / update ---
        mb.domains().verify("dom_1");
        Check.eq("verify url", "https://api.test/domains/dom_1/verify", t.lastUrl);
        Check.eq("verify method", "POST", t.lastMethod);
        mb.domains().update("dom_1", UpdateDomainRequest.builder().tls("enforced").build());
        Check.eq("update method", "PATCH", t.lastMethod);
        Check.eq("update body", "{\"tls\":\"enforced\"}", t.lastBody);

        // --- claim flow ---
        t.respond(200, "{\"object\":\"domain_claim\",\"id\":\"clm_1\"}");
        mb.domains().claim(ClaimDomainRequest.builder().name("example.com").build());
        Check.eq("claim url", "https://api.test/domains/claim", t.lastUrl);
        Check.eq("claim body", "{\"name\":\"example.com\"}", t.lastBody);
        mb.domains().getClaim("dom_1");
        Check.eq("getClaim url", "https://api.test/domains/dom_1/claim", t.lastUrl);
        Check.eq("getClaim method", "GET", t.lastMethod);
        mb.domains().verifyClaim("dom_1");
        Check.eq("verifyClaim url", "https://api.test/domains/dom_1/claim/verify", t.lastUrl);

        // --- DNS detection + one-click applies ---
        t.respond(200, "{}");
        mb.domains().detectDns("dom_1");
        Check.eq("detectDns url", "https://api.test/domains/dom_1/dns/detect", t.lastUrl);
        mb.domains().applyCloudflareDns("dom_1", "cf_token");
        Check.eq("cloudflare url", "https://api.test/domains/dom_1/dns/cloudflare", t.lastUrl);
        Check.eq("cloudflare body", "{\"token\":\"cf_token\"}", t.lastBody);
        mb.domains().applyGoDaddyDns("dom_1", "gd_key", "gd_secret");
        Check.eq("godaddy body", "{\"key\":\"gd_key\",\"secret\":\"gd_secret\"}", t.lastBody);
        mb.domains().applyNamecheapDns("dom_1", "ncuser", "nckey", "ncname");
        Check.eq("namecheap body",
                "{\"apiUser\":\"ncuser\",\"apiKey\":\"nckey\",\"userName\":\"ncname\"}", t.lastBody);
        mb.domains().applyNamecheapDns("dom_1", "ncuser", "nckey");
        Check.eq("namecheap body without userName",
                "{\"apiUser\":\"ncuser\",\"apiKey\":\"nckey\"}", t.lastBody);

        // --- remove ---
        mb.domains().remove("dom_1");
        Check.eq("remove method", "DELETE", t.lastMethod);
        Check.eq("remove url", "https://api.test/domains/dom_1", t.lastUrl);
    }

    public static void main(String[] args) {
        run();
        Check.finish();
    }
}
