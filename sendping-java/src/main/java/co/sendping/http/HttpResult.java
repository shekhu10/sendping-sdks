package co.sendping.http;

import java.nio.charset.StandardCharsets;

/** Raw outcome of a transport call: status code + body bytes. */
public final class HttpResult {
    private final int statusCode;
    private final byte[] body;

    public HttpResult(int statusCode, byte[] body) {
        this.statusCode = statusCode;
        this.body = body == null ? new byte[0] : body;
    }

    public HttpResult(int statusCode, String body) {
        this(statusCode, body == null ? null : body.getBytes(StandardCharsets.UTF_8));
    }

    public int statusCode() { return statusCode; }

    public byte[] body() { return body; }

    public String bodyText() { return new String(body, StandardCharsets.UTF_8); }
}
