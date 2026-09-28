using System.Text.Json;
using System.Text.Json.Serialization;

namespace SendPing;

/// <summary>One DNS record a domain needs (DKIM / SPF / DMARC / Tracking / Receiving MX).</summary>
public class DomainRecord
{
    /// <summary><c>DKIM</c> | <c>SPF</c> | <c>DMARC</c> | <c>Tracking</c> | <c>Receiving MX</c>.</summary>
    [JsonPropertyName("record")]
    public string Record { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    /// <summary><c>CNAME</c> | <c>MX</c> | <c>TXT</c> | <c>CAA</c>.</summary>
    [JsonPropertyName("type")]
    public string Type { get; set; } = null!;

    [JsonPropertyName("ttl")]
    public string? Ttl { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("value")]
    public string Value { get; set; } = null!;

    [JsonPropertyName("priority")]
    public int? Priority { get; set; }
}

/// <summary>Sending/receiving capabilities of a domain.</summary>
public class DomainCapabilities
{
    /// <summary><c>enabled</c> | <c>disabled</c>.</summary>
    [JsonPropertyName("sending")]
    public string? Sending { get; set; }

    /// <summary><c>enabled</c> | <c>disabled</c>.</summary>
    [JsonPropertyName("receiving")]
    public string? Receiving { get; set; }
}

/// <summary>Capabilities to enable on create/update, e.g. <c>Receiving = "enabled"</c>.</summary>
public class DomainCapabilitiesOptions
{
    /// <summary><c>enabled</c> | <c>disabled</c>.</summary>
    [JsonPropertyName("receiving")]
    public string? Receiving { get; set; }
}

/// <summary>A sending (and optionally receiving) domain.</summary>
public class Domain
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "domain";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    /// <summary>
    /// Aggregated verification status: <c>not_started</c>, <c>pending</c>, <c>verified</c>,
    /// <c>partially_verified</c>, <c>partially_failed</c>, <c>failed</c>,
    /// <c>temporary_failure</c>, or <c>revoked</c>.
    /// </summary>
    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;

    [JsonPropertyName("region")]
    public string? Region { get; set; }

    /// <summary>
    /// The DNS zone the registrar manages (e.g. <c>acme.com</c> when Name is
    /// <c>replies.acme.com</c>). Record names should be entered relative to it.
    /// </summary>
    [JsonPropertyName("zone")]
    public string? Zone { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    [JsonPropertyName("records")]
    public List<DomainRecord> Records { get; set; } = new();

    /// <summary>MAIL FROM subdomain (Return-Path); defaults to <c>send</c>.</summary>
    [JsonPropertyName("custom_return_path")]
    public string? CustomReturnPath { get; set; }

    [JsonPropertyName("open_tracking")]
    public bool? OpenTracking { get; set; }

    [JsonPropertyName("click_tracking")]
    public bool? ClickTracking { get; set; }

    /// <summary>Open/click tracking subdomain label (null ⇒ tracking on the shared host).</summary>
    [JsonPropertyName("tracking_subdomain")]
    public string? TrackingSubdomain { get; set; }

    /// <summary>Outbound TLS policy: <c>opportunistic</c> | <c>enforced</c>.</summary>
    [JsonPropertyName("tls")]
    public string? Tls { get; set; }

    [JsonPropertyName("capabilities")]
    public DomainCapabilities? Capabilities { get; set; }

    [JsonPropertyName("tracking_domain")]
    public string? TrackingDomain { get; set; }

    [JsonPropertyName("tracking_verified")]
    public bool? TrackingVerified { get; set; }

    /// <summary>
    /// When the mail service last re-checked this domain's identity;
    /// <c>null</c> when it never has.
    /// </summary>
    [JsonPropertyName("aws_last_checked_at")]
    public string? AwsLastCheckedAt { get; set; }

    /// <summary>The last identity-check failure, if any.</summary>
    [JsonPropertyName("aws_check_error")]
    public string? AwsCheckError { get; set; }
}

/// <summary>Payload for creating a domain (POST /domains).</summary>
public class DomainCreateOptions
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("region")]
    public string? Region { get; set; }

    /// <summary>MAIL FROM subdomain (Return-Path); defaults to <c>send</c>.</summary>
    [JsonPropertyName("custom_return_path")]
    public string? CustomReturnPath { get; set; }

    [JsonPropertyName("open_tracking")]
    public bool? OpenTracking { get; set; }

    [JsonPropertyName("click_tracking")]
    public bool? ClickTracking { get; set; }

    /// <summary>Custom tracking host label, e.g. <c>email</c> ⇒ email.&lt;domain&gt;.</summary>
    [JsonPropertyName("tracking_subdomain")]
    public string? TrackingSubdomain { get; set; }

    /// <summary>Outbound TLS policy: <c>opportunistic</c> | <c>enforced</c>.</summary>
    [JsonPropertyName("tls")]
    public string? Tls { get; set; }

    /// <summary>Capabilities to enable, e.g. <c>new() { Receiving = "enabled" }</c>.</summary>
    [JsonPropertyName("capabilities")]
    public DomainCapabilitiesOptions? Capabilities { get; set; }
}

/// <summary>Payload for updating a domain (PATCH /domains/:id).</summary>
public class DomainUpdateOptions
{
    [JsonPropertyName("open_tracking")]
    public bool? OpenTracking { get; set; }

    [JsonPropertyName("click_tracking")]
    public bool? ClickTracking { get; set; }

    [JsonPropertyName("tracking_subdomain")]
    public string? TrackingSubdomain { get; set; }

    /// <summary>Enable/disable the custom open/click tracking host for this domain.</summary>
    [JsonPropertyName("custom_tracking")]
    public bool? CustomTracking { get; set; }

    /// <summary>Outbound TLS policy: <c>opportunistic</c> | <c>enforced</c>.</summary>
    [JsonPropertyName("tls")]
    public string? Tls { get; set; }

    [JsonPropertyName("capabilities")]
    public DomainCapabilitiesOptions? Capabilities { get; set; }
}

/// <summary>The TXT record proving a domain claim.</summary>
public class DomainClaimRecord
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "TXT";

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("value")]
    public string? Value { get; set; }

    [JsonPropertyName("ttl")]
    public string? Ttl { get; set; }
}

/// <summary>A claim on a domain already verified by another account.</summary>
public class DomainClaim
{
    [JsonPropertyName("object")]
    public string Object { get; set; } = "domain_claim";

    [JsonPropertyName("id")]
    public string Id { get; set; } = null!;

    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("domain_id")]
    public string DomainId { get; set; } = null!;

    [JsonPropertyName("region")]
    public string? Region { get; set; }

    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;

    [JsonPropertyName("record")]
    public DomainClaimRecord Record { get; set; } = null!;

    [JsonPropertyName("blocked_reason")]
    public string? BlockedReason { get; set; }

    [JsonPropertyName("failure_reason")]
    public string? FailureReason { get; set; }

    [JsonPropertyName("created_at")]
    public string CreatedAt { get; set; } = null!;

    [JsonPropertyName("expires_at")]
    public string? ExpiresAt { get; set; }
}

/// <summary>Payload for claiming a domain verified elsewhere (POST /domains/claim).</summary>
public class DomainClaimOptions
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = null!;

    [JsonPropertyName("region")]
    public string? Region { get; set; }
}

/// <summary>
/// Result of DNS-provider detection (GET /domains/:id/dns/detect): the provider,
/// its nameservers and the one-click apply methods available.
/// </summary>
public class DnsDetectionResult
{
    [JsonPropertyName("provider")]
    public JsonElement? Provider { get; set; }

    [JsonPropertyName("nameservers")]
    public List<string> Nameservers { get; set; } = new();

    [JsonPropertyName("methods")]
    public List<JsonElement> Methods { get; set; } = new();
}

/// <summary>One MX host published for a domain.</summary>
public class MxRecord
{
    [JsonPropertyName("exchange")]
    public string Exchange { get; set; } = null!;

    [JsonPropertyName("priority")]
    public int Priority { get; set; }
}

/// <summary>
/// Result of GET /domains/mx-check. Fails open: a DNS lookup failure returns
/// <c>HasMx = false</c> with an empty <see cref="Records"/> list, not an error.
/// </summary>
public class MxCheckResult
{
    /// <summary>Whether the domain publishes any MX record at all.</summary>
    [JsonPropertyName("has_mx")]
    public bool HasMx { get; set; }

    /// <summary>True only when EVERY published MX host is a SendPing host.</summary>
    [JsonPropertyName("ours")]
    public bool Ours { get; set; }

    /// <summary>Published MX hosts, ascending by priority.</summary>
    [JsonPropertyName("records")]
    public List<MxRecord> Records { get; set; } = new();
}

/// <summary>
/// Namecheap API credentials for one-click DNS apply. Namecheap must have the
/// calling server's IP whitelisted in the account's API settings.
/// </summary>
public class NamecheapDnsCredentials
{
    [JsonPropertyName("apiUser")]
    public string ApiUser { get; set; } = null!;

    [JsonPropertyName("apiKey")]
    public string ApiKey { get; set; } = null!;

    [JsonPropertyName("userName")]
    public string? UserName { get; set; }
}

/// <summary>HTTPS tracking readiness, separate from sending DNS verification.</summary>
public class DomainTrackingHealth
{
    [JsonPropertyName("custom_host")]
    public string? CustomHost { get; set; }
    [JsonPropertyName("status")]
    public string Status { get; set; } = null!;
    [JsonPropertyName("checked_at")]
    public DateTimeOffset CheckedAt { get; set; }
}
