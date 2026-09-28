<?php

declare(strict_types=1);

use SendPing\WebhookSignature;

$rawKey = 'topsecretkey';
$secret = 'whsec_' . base64_encode($rawKey);
$payload = '{"type":"email.delivered","data":{"id":"em_1"}}';
$id = 'msg_2abc';
$timestamp = (string) time();
$goodSig = base64_encode(hash_hmac('sha256', $id . '.' . $timestamp . '.' . $payload, $rawKey, true));

// Valid signature; mixed-case header names must be read case-insensitively.
$result = WebhookSignature::verify($payload, [
    'Svix-Id' => $id,
    'SVIX-TIMESTAMP' => $timestamp,
    'svix-signature' => 'v1,' . $goodSig,
], $secret);
check_same('webhook.verify: valid whsec_ signature', ['valid' => true], $result);

// Also reachable through the client resource.
[$mb, $t] = make_client();
$viaClient = $mb->webhooks->verify($payload, [
    'svix-id' => $id,
    'svix-timestamp' => $timestamp,
    'svix-signature' => 'v1,' . $goodSig,
], $secret);
check_same('webhook.verify via webhooks resource', ['valid' => true], $viaClient);
check_same('webhook.verify: no HTTP request made', [], $t->requests);

// Raw (non-whsec_) secret is used as UTF-8 bytes.
$rawSecretSig = base64_encode(hash_hmac('sha256', $id . '.' . $timestamp . '.' . $payload, 'plain-secret', true));
$result = WebhookSignature::verify($payload, [
    'svix-id' => $id,
    'svix-timestamp' => $timestamp,
    'svix-signature' => 'v1,' . $rawSecretSig,
], 'plain-secret');
check_same('webhook.verify: raw secret', ['valid' => true], $result);

// A caller-supplied `whsec_` secret whose suffix is not valid STANDARD base64
// still has to verify: the server derives its signing key with Node's lenient
// Buffer.from(suffix, 'base64'), which skips characters outside the alphabet and
// accepts the URL-safe one. Decoding strictly here fell back to the raw secret as
// the key and rejected every genuine delivery as no_match.
$looseSuffix = 'top-secret key!';
$looseSecret = 'whsec_' . $looseSuffix;
// What the server signs with: URL-safe chars folded in, everything else dropped.
$serverKey = base64_decode(strtr($looseSuffix, '-_', '+/'), false);
check('webhook.verify: lenient secret decodes to a non-empty key', $serverKey !== '');
$looseSig = base64_encode(hash_hmac('sha256', $id . '.' . $timestamp . '.' . $payload, $serverKey, true));
$result = WebhookSignature::verify($payload, [
    'svix-id' => $id,
    'svix-timestamp' => $timestamp,
    'svix-signature' => 'v1,' . $looseSig,
], $looseSecret);
check_same('webhook.verify: non-strict whsec_ suffix matches the server key', ['valid' => true], $result);

// Multiple space-separated signatures: any match wins.
$result = WebhookSignature::verify($payload, [
    'svix-id' => $id,
    'svix-timestamp' => $timestamp,
    'svix-signature' => 'v1,bogus v1,' . $goodSig,
], $secret);
check_same('webhook.verify: any of multiple signatures', ['valid' => true], $result);

// Tampered payload fails.
$result = WebhookSignature::verify($payload . 'x', [
    'svix-id' => $id,
    'svix-timestamp' => $timestamp,
    'svix-signature' => 'v1,' . $goodSig,
], $secret);
check_same('webhook.verify: tampered payload', ['valid' => false, 'reason' => 'no_match'], $result);

// Missing headers.
$result = WebhookSignature::verify($payload, ['svix-id' => $id], $secret);
check_same('webhook.verify: missing headers', ['valid' => false, 'reason' => 'missing_headers'], $result);

// Missing secret.
$result = WebhookSignature::verify($payload, [
    'svix-id' => $id,
    'svix-timestamp' => $timestamp,
    'svix-signature' => 'v1,' . $goodSig,
], '');
check_same('webhook.verify: missing secret', ['valid' => false, 'reason' => 'missing_secret'], $result);

// Stale timestamp is rejected by default…
$oldTs = (string) (time() - 3600);
$oldSig = base64_encode(hash_hmac('sha256', $id . '.' . $oldTs . '.' . $payload, $rawKey, true));
$result = WebhookSignature::verify($payload, [
    'svix-id' => $id,
    'svix-timestamp' => $oldTs,
    'svix-signature' => 'v1,' . $oldSig,
], $secret);
check_same('webhook.verify: stale timestamp rejected', ['valid' => false, 'reason' => 'timestamp_out_of_tolerance'], $result);

// …but toleranceSec = 0 disables the freshness check.
$result = WebhookSignature::verify($payload, [
    'svix-id' => $id,
    'svix-timestamp' => $oldTs,
    'svix-signature' => 'v1,' . $oldSig,
], $secret, ['toleranceSec' => 0]);
check_same('webhook.verify: tolerance 0 skips freshness check', ['valid' => true], $result);

// Non-numeric timestamp.
$result = WebhookSignature::verify($payload, [
    'svix-id' => $id,
    'svix-timestamp' => 'not-a-number',
    'svix-signature' => 'v1,' . $goodSig,
], $secret);
check_same('webhook.verify: invalid timestamp', ['valid' => false, 'reason' => 'invalid_timestamp'], $result);

// Array header values (e.g. from a framework) use the first entry.
$result = WebhookSignature::verify($payload, [
    'svix-id' => [$id],
    'svix-timestamp' => [$timestamp],
    'svix-signature' => ['v1,' . $goodSig],
], $secret);
check_same('webhook.verify: array header values', ['valid' => true], $result);
