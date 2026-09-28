using System.Net;
using System.Text;

namespace SendPing.Tests;

/// <summary>
/// Injectable HttpMessageHandler stub: records every request (method, URL,
/// headers, body) and replies with a canned status + JSON body.
/// </summary>
public sealed class StubHttpMessageHandler : HttpMessageHandler
{
    public List<HttpRequestMessage> Requests { get; } = new();

    /// <summary>Request bodies read eagerly (index-aligned with <see cref="Requests"/>).</summary>
    public List<string?> RequestBodies { get; } = new();

    public HttpStatusCode StatusCode { get; set; } = HttpStatusCode.OK;

    public string ResponseBody { get; set; } = "{}";

    /// <summary>
    /// Optional scripted responses returned in order (one per request). When
    /// non-empty, each request dequeues the next entry; once drained the handler
    /// falls back to <see cref="StatusCode"/>/<see cref="ResponseBody"/>. The
    /// optional <c>RetryAfter</c> sets the <c>Retry-After</c> response header.
    /// </summary>
    public Queue<(HttpStatusCode Status, string Body, string? RetryAfter)> ScriptedResponses { get; } = new();

    public HttpRequestMessage LastRequest => Requests[^1];

    public string? LastRequestBody => RequestBodies[^1];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Requests.Add(request);
        RequestBodies.Add(request.Content is null
            ? null
            : await request.Content.ReadAsStringAsync(cancellationToken));

        var status = StatusCode;
        var body = ResponseBody;
        string? retryAfter = null;
        if (ScriptedResponses.Count > 0)
        {
            (status, body, retryAfter) = ScriptedResponses.Dequeue();
        }

        var response = new HttpResponseMessage(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
            RequestMessage = request,
        };
        if (retryAfter is not null)
        {
            response.Headers.TryAddWithoutValidation("Retry-After", retryAfter);
        }
        return response;
    }
}
