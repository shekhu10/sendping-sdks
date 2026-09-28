<?php

declare(strict_types=1);

[$mb, $t] = make_client();

$mb->domains->create(['name' => 'example.com', 'capabilities' => ['receiving' => 'enabled']]);
check_same('domains.create: method', 'POST', $t->last()['method']);
check_same('domains.create: path', '/domains', $t->lastPath());
check_same('domains.create: body', ['name' => 'example.com', 'capabilities' => ['receiving' => 'enabled']], $t->lastJson());
check_auth('domains.create', $t->last());

$mb->domains->get('dom_1');
check_same('domains.get: path', '/domains/dom_1', $t->lastPath());

$mb->domains->list(['limit' => 3]);
check_same('domains.list: path', '/domains?limit=3', $t->lastPath());

$mb->domains->mxCheck('example.com');
check_same('domains.mxCheck: method', 'GET', $t->last()['method']);
check_same('domains.mxCheck: path', '/domains/mx-check?name=example.com', $t->lastPath());

// records.csv streams CSV text, not JSON
$t->queue(200, "Type,Host\r\nTXT,@\r\n");
$csv = $mb->domains->recordsCsv('dom_1');
check_same('domains.recordsCsv: raw CSV returned', "Type,Host\r\nTXT,@\r\n", $csv);
check_same('domains.recordsCsv: path', '/domains/dom_1/records.csv', $t->lastPath());
check_auth('domains.recordsCsv', $t->last());

$mb->domains->update('dom_1', ['click_tracking' => true, 'tls' => 'enforced']);
check_same('domains.update: method', 'PATCH', $t->last()['method']);
check_same('domains.update: body', ['click_tracking' => true, 'tls' => 'enforced'], $t->lastJson());

$mb->domains->verify('dom_1');
check_same('domains.verify: method', 'POST', $t->last()['method']);
check_same('domains.verify: path', '/domains/dom_1/verify', $t->lastPath());
check_same('domains.verify: no body', null, $t->last()['body']);

// ---- claim flow ----
$mb->domains->claim(['name' => 'example.com']);
check_same('domains.claim: path', '/domains/claim', $t->lastPath());
check_same('domains.claim: body', ['name' => 'example.com'], $t->lastJson());

$mb->domains->getClaim('dom_1');
check_same('domains.getClaim: path', '/domains/dom_1/claim', $t->lastPath());

$mb->domains->verifyClaim('dom_1');
check_same('domains.verifyClaim: method', 'POST', $t->last()['method']);
check_same('domains.verifyClaim: path', '/domains/dom_1/claim/verify', $t->lastPath());

// ---- one-click DNS ----
$mb->domains->detectDns('dom_1');
check_same('domains.detectDns: path', '/domains/dom_1/dns/detect', $t->lastPath());

$mb->domains->applyCloudflareDns('dom_1', ['token' => 'cf_token']);
check_same('domains.applyCloudflareDns: path', '/domains/dom_1/dns/cloudflare', $t->lastPath());
check_same('domains.applyCloudflareDns: body', ['token' => 'cf_token'], $t->lastJson());

$mb->domains->applyGoDaddyDns('dom_1', ['key' => 'k', 'secret' => 's']);
check_same('domains.applyGoDaddyDns: path', '/domains/dom_1/dns/godaddy', $t->lastPath());

$mb->domains->applyNamecheapDns('dom_1', ['apiUser' => 'u', 'apiKey' => 'k']);
check_same('domains.applyNamecheapDns: path', '/domains/dom_1/dns/namecheap', $t->lastPath());

$mb->domains->remove('dom_1');
check_same('domains.remove: method', 'DELETE', $t->last()['method']);
check_same('domains.remove: path', '/domains/dom_1', $t->lastPath());
