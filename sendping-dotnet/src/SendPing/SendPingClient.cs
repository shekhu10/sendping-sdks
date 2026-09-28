using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace SendPing;

/// <summary>
/// The SendPing API client. Create one via <see cref="Create(string)"/> and
/// reuse it for the lifetime of your application:
/// <code>
/// ISendPing sendping = SendPingClient.Create("mb_xxxxxxxxx");
/// </code>
/// </summary>
public partial class SendPingClient : ISendPing, IDisposable
{
    /// <summary>Default API host.</summary>
    public const string DefaultBaseUrl = "https://www.sendping.co/api";

    /// <summary>SDK version. Keep in sync with the csproj &lt;Version&gt;.</summary>
    public const string Version = "1.0.0";

    /// <summary>
    /// Sent as <c>User-Agent</c> on every request. The API rejects a request with
    /// a missing or blank User-Agent with HTTP 403 <c>validation_error</c>, so
    /// this header is never optional.
    /// </summary>
    private const string UserAgent = "sendping-dotnet/" + Version;

    /// <summary>
    /// Maximum accepted <c>Idempotency-Key</c> length, measured after the server
    /// trims the value (<c>api_idempotency.key</c> is VARCHAR(255)) — 255, not
    /// 256. A key outside 1–255 is rejected by the API with
    /// 400 <c>invalid_idempotency_key</c>.
    /// <para>
    /// The header is honoured by <c>POST /emails</c>, <c>POST /emails/batch</c>, and received-email reply/forward
    /// ONLY; every other endpoint ignores it, so a retry there creates a second
    /// resource.
    /// </para>
    /// <para>
    /// This client does not check the length itself — the server is the
    /// authority. The constant is exposed so the rule is discoverable.
    /// </para>
    /// </summary>
    public const int MaxIdempotencyKeyLength = 255;

    /// <summary>Maximum wait between eligible retries (see RetryAllowed).</summary>
    private static readonly TimeSpan MaxRetryWait = TimeSpan.FromSeconds(30);

    private readonly HttpClient _http;
    private readonly bool _ownsHttpClient;
    private readonly string _apiKey;
    private readonly string _baseUrl;
    private readonly TimeSpan _timeout;
    private readonly int _maxRetries;

    /// <summary>Create a client with the default configuration.</summary>
    /// <param name="apiKey">Your SendPing API key, e.g. <c>mb_xxxxxxxxx</c>.</param>
    public static ISendPing Create(string apiKey) => new SendPingClient(apiKey);

    /// <summary>Create a client with custom options (base URL, HttpClient/handler).</summary>
    public static ISendPing Create(string apiKey, SendPingClientOptions options) => new SendPingClient(apiKey, options);

    public SendPingClient(string apiKey, SendPingClientOptions? options = null)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new ArgumentException("SendPing: an API key is required, e.g. SendPingClient.Create(\"mb_...\").", nameof(apiKey));
        }

        _apiKey = apiKey;
        options ??= new SendPingClientOptions();
        _baseUrl = string.IsNullOrEmpty(options.BaseUrl) ? DefaultBaseUrl : options.BaseUrl.TrimEnd('/');
        _timeout = options.Timeout < TimeSpan.Zero ? TimeSpan.Zero : options.Timeout;
        _maxRetries = options.MaxRetries < 0 ? 0 : options.MaxRetries;

        if (options.HttpClient is not null)
        {
            _http = options.HttpClient;
            _ownsHttpClient = false;
        }
        else
        {
            _http = options.HttpMessageHandler is null ? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) : new HttpClient(options.HttpMessageHandler);
            _ownsHttpClient = true;
            // We own this client, so let our per-attempt CancellationTokenSource
            // fully govern the timeout instead of HttpClient's default 100s.
            _http.Timeout = Timeout.InfiniteTimeSpan;
        }
    }

    public void Dispose()
    {
        if (_ownsHttpClient)
        {
            _http.Dispose();
        }
        GC.SuppressFinalize(this);
    }

    // ---- HTTP core ----

    private HttpRequestMessage BuildRequest(HttpMethod method, string path, string? body, string? idempotencyKey)
    {
        var request = new HttpRequestMessage(method, _baseUrl + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _apiKey);
        request.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
        // Sent verbatim: the server trims the value and owns the 1–255 bound
        // (see MaxIdempotencyKeyLength), answering an out-of-range key with
        // 400 invalid_idempotency_key. Validating here would only risk drifting
        // from the server. A null or empty key means "no idempotency".
        if (!string.IsNullOrEmpty(idempotencyKey))
        {
            request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
        }
        if (body is not null)
        {
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        }
        return request;
    }

    private async Task<T> RequestAsync<T>(HttpMethod method, string path, object? body, string? idempotencyKey, CancellationToken cancellationToken)
    {
        // Snapshot once: caller mutations during backoff must not change the
        // content associated with the original operation key.
        var json = body is null ? null : JsonSerializer.Serialize(body, SendPingJson.Options);
        using var response = await SendWithRetriesAsync(
            () => BuildRequest(method, path, json, idempotencyKey), cancellationToken).ConfigureAwait(false);

        var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            throw CreateError((int)response.StatusCode, text);
        }
        try
        {
            var value = JsonSerializer.Deserialize<T>(text, SendPingJson.Options);
            if (value is null)
            {
                throw new SendPingException((int)response.StatusCode, "invalid_response", "The API returned an empty response body.");
            }
            return value;
        }
        catch (JsonException ex)
        {
            throw new SendPingException((int)response.StatusCode, "invalid_response", $"Failed to parse the API response as JSON: {ex.Message}", ex);
        }
    }

    /// <summary>For endpoints that stream raw binary bytes (attachment / raw MIME downloads).</summary>
    private async Task<byte[]> RequestBytesAsync(HttpMethod method, string path, CancellationToken cancellationToken)
    {
        using var response = await SendWithRetriesAsync(
            () => BuildRequest(method, path, body: null, idempotencyKey: null), cancellationToken).ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            throw CreateError((int)response.StatusCode, text);
        }
        return await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);
    }

    /// <summary>For endpoints that return a non-JSON text document (e.g. the DNS records CSV).</summary>
    private async Task<string> RequestTextAsync(HttpMethod method, string path, CancellationToken cancellationToken)
    {
        using var response = await SendWithRetriesAsync(
            () => BuildRequest(method, path, body: null, idempotencyKey: null), cancellationToken).ConfigureAwait(false);

        var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (!response.IsSuccessStatusCode)
        {
            // Errors on these routes still use the JSON envelope, not the document type.
            throw CreateError((int)response.StatusCode, text);
        }
        return text;
    }

    /// <summary>
    /// The single send chokepoint shared by the JSON and raw-bytes paths. Applies
    /// the per-attempt timeout and the bounded 429/503 retry loop. The factory is
    /// invoked once per attempt because an <see cref="HttpRequestMessage"/> can only
    /// be sent a single time.
    /// </summary>
    private async Task<HttpResponseMessage> SendWithRetriesAsync(Func<HttpRequestMessage> requestFactory, CancellationToken cancellationToken)
    {
        for (int attempt = 0; ; attempt++)
        {
            HttpResponseMessage response;
            bool isRead;
            bool protectedSend;
            using (var request = requestFactory())
            using (var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken))
            {
                isRead = request.Method == HttpMethod.Get || request.Method == HttpMethod.Head;
                protectedSend = request.Method == HttpMethod.Post
                    && System.Text.RegularExpressions.Regex.IsMatch(request.RequestUri!.AbsolutePath, @"/emails(?:/batch|/receiving/[^/]+/(?:reply|forward))?$")
                    && request.Headers.TryGetValues("Idempotency-Key", out var keys) && keys.Any(key => !string.IsNullOrWhiteSpace(key));
                if (_timeout > TimeSpan.Zero)
                {
                    timeoutCts.CancelAfter(_timeout);
                }
                try
                {
                    response = await _http.SendAsync(request, timeoutCts.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException) when (timeoutCts.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
                {
                    // The per-attempt timeout fired (not the caller's cancellation). Not retried.
                    throw new SendPingException(0, "timeout",
                        $"The request timed out after {_timeout.TotalSeconds.ToString(CultureInfo.InvariantCulture)}s.");
                }
                catch (HttpRequestException ex)
                {
                    // Network/connection failures are not retried (may have applied).
                    throw new SendPingException(0, "network_error", ex.Message, ex);
                }
            }

            var status = (int)response.StatusCode;
            if ((status != 429 && status != 503) || attempt >= _maxRetries
                || !RetryAllowed(status, await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false), isRead, protectedSend))
            {
                return response;
            }

            var wait = RetryAfterDelay(response.Headers.RetryAfter) ?? ExponentialBackoff(attempt);
            response.Dispose();
            if (wait > TimeSpan.Zero)
            {
                await Task.Delay(wait, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    private static bool RetryAllowed(int status, string raw, bool isRead, bool protectedSend)
    {
        var error = CreateError(status, raw);
        // Inspect raw progress separately from typed convenience accessors:
        // a newer/malformed item shape must not make reserved work disappear.
        bool HasItems(string key) => error.Extra.TryGetValue(key, out var items)
            && items.ValueKind == JsonValueKind.Array && items.GetArrayLength() > 0;
        var progress = error.Extra.TryGetValue("sent_count", out var count)
            && count.ValueKind == JsonValueKind.Number && count.TryGetDouble(out var number) && number > 0;
        if (!string.IsNullOrEmpty(error.Id) || progress || HasItems("sent")
            || HasItems("reserved") || error.Name == "batch_incomplete") return false;
        return status != 503 || isRead || protectedSend || error.Name is "service_unavailable"
            or "sending_service_unavailable" or "sending_configuration_unavailable" or "contacts_busy" or "contacts_timeout";
    }

    /// <summary>
    /// Parse the <c>Retry-After</c> header into a wait duration: a delta-seconds
    /// value, or an HTTP-date to wait until. Negative is clamped to zero, the wait
    /// is capped at 30s, and an absent/unparseable header yields <c>null</c>.
    /// </summary>
    private static TimeSpan? RetryAfterDelay(System.Net.Http.Headers.RetryConditionHeaderValue? retryAfter)
    {
        if (retryAfter is null)
        {
            return null;
        }

        TimeSpan wait;
        if (retryAfter.Delta is TimeSpan delta)
        {
            wait = delta;
        }
        else if (retryAfter.Date is DateTimeOffset date)
        {
            wait = date - DateTimeOffset.UtcNow;
        }
        else
        {
            return null;
        }

        if (wait < TimeSpan.Zero) wait = TimeSpan.Zero;
        if (wait > MaxRetryWait) wait = MaxRetryWait;
        return wait;
    }

    /// <summary>Exponential backoff = min(30s, 0.5s * 2^attempt), attempt 0 = first retry.</summary>
    private static TimeSpan ExponentialBackoff(int attempt)
    {
        var seconds = 0.5 * Math.Pow(2, attempt);
        if (seconds > MaxRetryWait.TotalSeconds) seconds = MaxRetryWait.TotalSeconds;
        return TimeSpan.FromSeconds(seconds);
    }

    private static SendPingException CreateError(int httpStatus, string body)
    {
        var status = httpStatus;
        var name = "application_error";
        var message = $"Request failed with status {httpStatus}.";
        Dictionary<string, JsonElement>? extra = null;
        if (!string.IsNullOrEmpty(body))
        {
            try
            {
                using var parsed = JsonDocument.Parse(body);
                if (parsed.RootElement.ValueKind == JsonValueKind.Object)
                {
                    extra = new Dictionary<string, JsonElement>();
                    foreach (var field in parsed.RootElement.EnumerateObject())
                    {
                        if (field.Name == "statusCode") continue; // Transport status is authoritative.
                        if (field.Name is "name" or "message")
                        {
                            if (field.Value.ValueKind != JsonValueKind.String) continue;
                            var value = field.Value.GetString();
                            if (string.IsNullOrEmpty(value)) continue;
                            if (field.Name == "name") name = value; else message = value;
                        }
                        else extra[field.Name] = field.Value.Clone();
                    }
                }
            }
            catch (JsonException)
            {
                // Non-JSON error body; keep the defaults.
            }
        }
        return new SendPingException(status, name, message, extra);
    }

    // ---- URL helpers ----

    /// <summary>Percent-encode an id-bearing path segment so it cannot traverse the URL path.</summary>
    private static string E(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return Uri.EscapeDataString(value);
    }

    /// <summary>Build a query string from key/value pairs, skipping null values.</summary>
    private static string Query(params (string Key, string? Value)[] pairs)
    {
        var sb = new StringBuilder();
        foreach (var (key, value) in pairs)
        {
            if (value is null) continue;
            sb.Append(sb.Length == 0 ? '?' : '&');
            sb.Append(key).Append('=').Append(Uri.EscapeDataString(value));
        }
        return sb.ToString();
    }

    /// <summary>Build a <c>?limit=&amp;after=&amp;before=</c> query string from pagination options.</summary>
    private static string Paginate(PaginationOptions? pagination) => Query(
        ("limit", pagination?.Limit?.ToString(CultureInfo.InvariantCulture)),
        ("after", pagination?.After),
        ("before", pagination?.Before));
}
