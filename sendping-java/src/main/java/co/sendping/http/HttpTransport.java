package co.sendping.http;

import java.util.Map;

/**
 * The single seam between the SDK and the network. The default implementation
 * ({@link DefaultHttpTransport}) uses {@code java.net.http.HttpClient}; tests
 * inject a stub to assert on method / URL / headers / body without any I/O.
 */
public interface HttpTransport {
    /**
     * Execute an HTTP request and return the raw result.
     *
     * @param method HTTP method (GET/POST/PATCH/DELETE)
     * @param url    absolute URL including any query string
     * @param headers request headers (Authorization, Content-Type, …)
     * @param body   JSON request body, or {@code null} for body-less requests
     */
    HttpResult execute(String method, String url, Map<String, String> headers, String body) throws Exception;
}
