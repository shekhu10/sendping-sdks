'use strict';

const { withPagination, pagination } = require('../helpers');

function register({ group, leaf, act }) {
  const polls = group('polls', 'Read in-email poll results');

  act(
    withPagination(leaf(polls, 'list', 'One summary row per email with poll responses')),
    ({ client, opts }) => client.polls.list(pagination(opts)),
  );

  act(
    leaf(polls, 'get <emailId>', 'Aggregated answer breakdown for one email'),
    ({ client, args: [emailId] }) => client.polls.get(emailId),
  );
}

module.exports = { register };
