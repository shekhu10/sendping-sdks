using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Xunit;

namespace SendPing.Tests;

public class RecoveryTests
{
    private sealed class MutatingHandler : HttpMessageHandler
    {
        private readonly Action _mutate;
        public List<string> Bodies { get; } = new();
        public MutatingHandler(Action mutate) { _mutate = mutate; }
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Bodies.Add(await request.Content!.ReadAsStringAsync(cancellationToken));
            var first = Bodies.Count == 1;
            if (first) _mutate();
            var response = new HttpResponseMessage(first ? HttpStatusCode.TooManyRequests : HttpStatusCode.OK) {
                Content = new StringContent(first ? "{}" : "{\"id\":\"em_one\"}") };
            response.Headers.TryAddWithoutValidation("Retry-After", "0");
            return response;
        }
    }

    [Fact]
    public async Task RetryKeepsOriginalSerializedPayloadWhenCallerChangesOptions()
    {
        var options = new ReceivedEmailReplyOptions { TextBody = "a  b\n\n c" };
        var handler = new MutatingHandler(() => options.TextBody = "changed by caller");
        using var client = new SendPingClient("mb_test", new SendPingClientOptions { HttpMessageHandler = handler });
        await client.ReceivedEmailReplyWithIdempotencyKeyAsync("rcv_one", options, "operation-1");
        Assert.Equal(2, handler.Bodies.Count);
        Assert.Equal(handler.Bodies[0], handler.Bodies[1]);
        Assert.Equal("changed by caller", options.TextBody);
    }

    private static string CorpusPath()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null)
        {
            var path = Path.Combine(dir.FullName, "scripts", "http-recovery-corpus.json");
            if (File.Exists(path)) return path;
            dir = dir.Parent;
        }
        throw new FileNotFoundException("Shared recovery corpus is required");
    }

    [Fact]
    public async Task SharedRecoveryCorpus()
    {
        using var cases = JsonDocument.Parse(File.ReadAllText(CorpusPath()));
        foreach (var c in cases.RootElement.EnumerateArray())
        {
            var status = c.GetProperty("status").GetInt32();
            var attempts = c.GetProperty("attempts").GetInt32();
            var stub = new StubHttpMessageHandler { ResponseBody = "{\"id\":\"em_retry\"}" };
            stub.ScriptedResponses.Enqueue(((HttpStatusCode)status, c.GetProperty("body").GetRawText(), "0"));
            using var client = new SendPingClient("mb_test", new SendPingClientOptions { HttpMessageHandler = stub });
            var key = c.TryGetProperty("key", out var keyValue) ? keyValue.GetString() : null;
            // Drive the common executor to cover arbitrary methods/paths, including
            // a key supplied to an endpoint which does not implement idempotency.
            var request = typeof(SendPingClient).GetMethod("RequestAsync", BindingFlags.Instance | BindingFlags.NonPublic)!.MakeGenericMethod(typeof(JsonElement));
            var task = (Task<JsonElement>)request.Invoke(client, new object?[] {
                new HttpMethod(c.GetProperty("method").GetString()!), c.GetProperty("path").GetString(), new { text = "a  b\n\n c" }, key, CancellationToken.None
            })!;
            if (attempts == 1)
            {
                var error = await Assert.ThrowsAsync<SendPingException>(async () => await task);
                Assert.Equal(status, error.StatusCode);
            }
            else await task;
            Assert.True(stub.Requests.Count == attempts, c.GetProperty("name").GetString());
            if (key is not null) Assert.All(stub.Requests, req => Assert.Equal(key, req.Headers.GetValues("Idempotency-Key").Single()));
        }
    }

    [Fact]
    public async Task ReplyForwardAndHealthContracts()
    {
        var stub = new StubHttpMessageHandler { ResponseBody = "{\"object\":\"email\",\"id\":\"em_one\"}" };
        using var client = new SendPingClient("mb_test", new SendPingClientOptions { HttpMessageHandler = stub });
        await client.ReceivedEmailReplyWithIdempotencyKeyAsync("rcv_one", new ReceivedEmailReplyOptions { TextBody = "a  b\n\n c" }, "reply-1");
        Assert.Equal("reply-1", stub.LastRequest.Headers.GetValues("Idempotency-Key").Single());
        using var body = JsonDocument.Parse(stub.LastRequestBody!);
        Assert.Equal("a  b\n\n c", body.RootElement.GetProperty("text").GetString());
        await client.ReceivedEmailForwardWithIdempotencyKeyAsync("rcv_one", new ReceivedEmailForwardOptions(), "forward-1");
        Assert.Equal("forward-1", stub.LastRequest.Headers.GetValues("Idempotency-Key").Single());
        stub.ResponseBody = "{\"custom_host\":null,\"status\":\"shared\",\"checked_at\":\"2026-09-10T00:00:00Z\"}";
        var health = await client.DomainTrackingHealthAsync("domain one");
        Assert.Equal("shared", health.Status);
        Assert.Null(health.CustomHost);
        Assert.EndsWith("/domains/domain%20one/tracking-health", stub.LastRequest.RequestUri!.AbsoluteUri);
    }

    private static async Task RespondOnce(TcpListener listener, string response, Task? holdBody = null)
    {
        using var connection = await listener.AcceptTcpClientAsync();
        using var stream = connection.GetStream();
        using var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, leaveOpen: true);
        int length = 0;
        while (await reader.ReadLineAsync() is { Length: > 0 } line)
            if (line.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) length = int.Parse(line.Split(':')[1]);
        var data = new char[length];
        await reader.ReadBlockAsync(data);
        await stream.WriteAsync(Encoding.ASCII.GetBytes(response));
        if (holdBody is not null) await holdBody;
    }

    [Fact]
    public async Task DefaultClientRefusesRedirects()
    {
        using var target = new TcpListener(IPAddress.Loopback, 0);
        using var origin = new TcpListener(IPAddress.Loopback, 0);
        target.Start(); origin.Start();
        var response = RespondOnce(origin, $"HTTP/1.1 307 Temporary Redirect\r\nLocation: http://127.0.0.1:{((IPEndPoint)target.LocalEndpoint).Port}/collect\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}");
        using var client = new SendPingClient("mb_test", new SendPingClientOptions {
            BaseUrl = $"http://127.0.0.1:{((IPEndPoint)origin.LocalEndpoint).Port}", Timeout = TimeSpan.FromSeconds(1) });
        var error = await Assert.ThrowsAsync<SendPingException>(() => client.ReceivedEmailReplyAsync("rcv_one", new ReceivedEmailReplyOptions { TextBody = "private body" }));
        Assert.Equal(307, error.StatusCode);
        Assert.False(target.Pending());
        await response;
    }

    [Fact]
    public async Task DefaultTimeoutIncludesResponseBody()
    {
        using var origin = new TcpListener(IPAddress.Loopback, 0);
        origin.Start();
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var response = RespondOnce(origin, "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{", release.Task);
        using var client = new SendPingClient("mb_test", new SendPingClientOptions {
            BaseUrl = $"http://127.0.0.1:{((IPEndPoint)origin.LocalEndpoint).Port}", Timeout = TimeSpan.FromMilliseconds(100) });
        try {
            var call = client.EmailRetrieveAsync("em_one");
            var error = await Assert.ThrowsAsync<SendPingException>(async () => await call.WaitAsync(TimeSpan.FromSeconds(3)));
            Assert.Equal(0, error.StatusCode); Assert.Equal("timeout", error.Name);
        } finally { release.TrySetResult(); await response; }
    }

    [Fact]
    public async Task RecoveryDetailsUseActualStatusAndTolerateUnknownShapes()
    {
        var stub = new StubHttpMessageHandler { StatusCode = HttpStatusCode.UnprocessableEntity,
            ResponseBody = "{\"statusCode\":503,\"name\":\"validation_error\",\"id\":\"em_one\",\"reserved\":[{\"id\":\"em_one\"}],\"unsent_count\":0}" };
        using var client = new SendPingClient("mb_test", new SendPingClientOptions { HttpMessageHandler = stub });
        var error = await Assert.ThrowsAsync<SendPingException>(() => client.EmailRetrieveAsync("em_one"));
        Assert.Equal(422, error.StatusCode); Assert.Equal("em_one", error.Id);
        Assert.Equal("em_one", Assert.Single(error.Reserved!).Id); Assert.Equal(0, error.UnsentCount);
        stub.ResponseBody = "{\"id\":{},\"reserved\":7,\"unsent_count\":\"unexpected\"}";
        error = await Assert.ThrowsAsync<SendPingException>(() => client.EmailRetrieveAsync("em_one"));
        Assert.Null(error.Id); Assert.Null(error.Reserved); Assert.Null(error.UnsentCount);
        Assert.True(error.Extra.ContainsKey("reserved"));
    }
}
