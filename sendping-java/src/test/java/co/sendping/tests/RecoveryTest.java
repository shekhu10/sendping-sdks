package co.sendping.tests;

import co.sendping.SendPing;
import co.sendping.SendPingException;
import co.sendping.http.DefaultHttpTransport;
import co.sendping.http.HttpResult;
import co.sendping.json.Json;
import co.sendping.requests.ForwardEmailRequest;
import co.sendping.requests.ReplyEmailRequest;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public final class RecoveryTest {
    public static void run() throws Exception {
        Check.suite("Recovery");
        Path root = Path.of("").toAbsolutePath();
        while (!Files.exists(root.resolve("scripts/http-recovery-corpus.json"))) root = root.getParent();
        List<?> cases = (List<?>) Json.parse(Files.readString(root.resolve("scripts/http-recovery-corpus.json")));
        for (Object item : cases) {
            Map<?, ?> c = (Map<?, ?>) item;
            int status = ((Number) c.get("status")).intValue();
            int attempts = ((Number) c.get("attempts")).intValue();
            String key = (String) c.get("key");
            List<String> keys = Collections.synchronizedList(new ArrayList<>());
            List<String> bodies = Collections.synchronizedList(new ArrayList<>());
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/", exchange -> {
                keys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
                bodies.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
                byte[] response = (keys.size() == 1 ? Json.write(c.get("body")) : "{\"id\":\"em_retry\"}").getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Retry-After", "0");
                exchange.sendResponseHeaders(keys.size() == 1 ? status : 200, response.length);
                exchange.getResponseBody().write(response);
                exchange.close();
            });
            server.start();
            try {
                String payload = "{\"text\":\"a  b\\n\\n c\"}";
                HttpResult result = new DefaultHttpTransport(Duration.ofSeconds(2), 1).execute(
                    (String) c.get("method"), "http://127.0.0.1:" + server.getAddress().getPort() + c.get("path"),
                    key == null ? Collections.emptyMap() : Map.of("Idempotency-Key", key), payload);
                Check.eq(c.get("name") + " attempts", attempts, keys.size());
                Check.eq(c.get("name") + " status", attempts == 1 ? status : 200, result.statusCode());
                Check.isTrue(c.get("name") + " same payload", bodies.stream().allMatch(payload::equals));
                if (key != null) Check.isTrue(c.get("name") + " same key", keys.stream().allMatch(key::equals));
            } finally { server.stop(0); }
        }

        StubTransport t = new StubTransport();
        SendPing mb = new SendPing("mb_test", "https://api.test", t);
        t.respond(200, "{\"id\":\"em_one\"}");
        mb.emails().receiving().reply("rcv_one", ReplyEmailRequest.builder().text("a  b\n\n c").build(), "reply-1");
        Check.eq("reply key", "reply-1", t.lastHeaders.get("Idempotency-Key"));
        Check.eq("reply whitespace", "a  b\n\n c", ((Map<?, ?>) Json.parse(t.lastBody)).get("text"));
        mb.emails().receiving().forward("rcv_one", ForwardEmailRequest.builder().build(), "forward-1");
        Check.eq("forward key", "forward-1", t.lastHeaders.get("Idempotency-Key"));
        t.respond(200, "{\"custom_host\":null,\"status\":\"shared\",\"checked_at\":\"2026-09-10T00:00:00Z\"}");
        Check.eq("tracking health", "shared", mb.domains().trackingHealth("domain one").getString("status"));
        Check.eq("tracking health path", "https://api.test/domains/domain%20one/tracking-health", t.lastUrl);
        t.respond(422, "{\"statusCode\":503,\"name\":\"validation_error\",\"id\":\"em_one\",\"reserved\":[{\"id\":\"em_one\"}],\"unsent_count\":0}");
        try { mb.emails().get("em_one"); Check.isTrue("expected API error", false); }
        catch (SendPingException e) {
            Check.eq("actual HTTP status", 422, e.getStatusCode());
            Check.eq("original ID", "em_one", e.getId());
            Check.eq("reserved ID", "em_one", e.getReserved().get(0).get("id"));
            Check.eq("never attempted count", 0, e.getUnsentCount());
        }
    }
}
