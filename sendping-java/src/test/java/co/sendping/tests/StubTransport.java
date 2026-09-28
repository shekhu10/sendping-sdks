package co.sendping.tests;

import co.sendping.http.HttpResult;
import co.sendping.http.HttpTransport;

import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * Injectable {@link HttpTransport} stub: records the last request
 * (method / URL / headers / body) and returns a canned response.
 */
public final class StubTransport implements HttpTransport {
    public String lastMethod;
    public String lastUrl;
    public Map<String, String> lastHeaders;
    public String lastBody;

    private int status = 200;
    private byte[] body = "{}".getBytes(StandardCharsets.UTF_8);

    /** Set the canned response for the next call(s). */
    public void respond(int status, String body) {
        this.status = status;
        this.body = body.getBytes(StandardCharsets.UTF_8);
    }

    public void respondBytes(int status, byte[] body) {
        this.status = status;
        this.body = body;
    }

    @Override
    public HttpResult execute(String method, String url, Map<String, String> headers, String requestBody) {
        this.lastMethod = method;
        this.lastUrl = url;
        this.lastHeaders = headers;
        this.lastBody = requestBody;
        return new HttpResult(status, body);
    }
}
