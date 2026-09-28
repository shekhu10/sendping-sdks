namespace SendPing;

/// <summary>Optional configuration for <see cref="SendPingClient"/>.</summary>
public class SendPingClientOptions
{
    /// <summary>API host override. Defaults to <c>https://www.sendping.co/api</c>.</summary>
    public string BaseUrl { get; set; } = SendPingClient.DefaultBaseUrl;

    /// <summary>
    /// Supply your own <see cref="System.Net.Http.HttpClient"/> (e.g. from
    /// IHttpClientFactory). When set, the client is NOT disposed by the SDK.
    /// </summary>
    public HttpClient? HttpClient { get; set; }

    /// <summary>
    /// Supply a custom <see cref="HttpMessageHandler"/> (e.g. a test stub).
    /// Ignored when <see cref="HttpClient"/> is set.
    /// </summary>
    public HttpMessageHandler? HttpMessageHandler { get; set; }

    /// <summary>
    /// Per-request timeout applied to every attempt (a retry gets a fresh
    /// timeout). Defaults to 30 seconds. Set to <see cref="System.TimeSpan.Zero"/>
    /// to disable the timeout.
    /// </summary>
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// Maximum number of automatic retries for retryable responses (HTTP 429 and
    /// 503 only). Defaults to 2 (up to 3 total attempts). Set to 0 to disable.
    /// </summary>
    public int MaxRetries { get; set; } = 2;
}
