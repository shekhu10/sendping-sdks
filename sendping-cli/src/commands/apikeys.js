'use strict';

const { withPagination, pagination } = require('../helpers');

// `list` is the whole group on purpose. Creating, re-scoping and revoking keys
// happens in the dashboard, behind a signed-in session — so a key that leaks
// cannot mint itself a replacement or widen its own access from the CLI.
function register({ group, leaf, act }) {
  const apiKeys = group('api-keys', 'Inspect API keys (create/revoke live in the dashboard)');

  act(withPagination(leaf(apiKeys, 'list', 'List API keys')), ({ client, opts }) =>
    client.apiKeys.list(pagination(opts)),
  );
}

module.exports = { register };
