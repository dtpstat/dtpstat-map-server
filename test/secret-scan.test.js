import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findSecretsInText,
} from '../scripts/check-secrets.js';

function token(
  prefix,
  body,
) {
  return (
    prefix +
    body
  );
}

test('secret scanner recognizes high-confidence credential formats without returning secret values', () => {
  const input = [
    'safe line',
    token(
      'ghp_',
      'A'.repeat(
        40,
      ),
    ),
    token(
      'AKIA',
      'B'.repeat(
        16,
      ),
    ),
    token(
      'AIza',
      'C'.repeat(
        35,
      ),
    ),
    token(
      'sk_live_',
      'D'.repeat(
        24,
      ),
    ),
  ].join(
    '\n',
  );

  const findings =
    findSecretsInText(
      input,
    );

  assert.deepEqual(
    findings.map(
      ({
        type,
        line,
      }) => ({
        type,
        line,
      }),
    ),
    [
      {
        type:
          'github-token',
        line: 2,
      },
      {
        type:
          'aws-access-key',
        line: 3,
      },
      {
        type:
          'google-api-key',
        line: 4,
      },
      {
        type:
          'stripe-live-secret',
        line: 5,
      },
    ],
  );

  assert.equal(
    JSON.stringify(
      findings,
    ).includes(
      'A'.repeat(
        40,
      ),
    ),
    false,
  );
});

test('secret scanner detects private keys and common service tokens', () => {
  const input = [
    [
      '-----BEGIN ',
      'PRIVATE KEY-----',
    ].join(
      '',
    ),
    token(
      'xoxb-',
      '1234567890-abcdefghij',
    ),
    [
      'SG.',
      'A'.repeat(
        20,
      ),
      '.',
      'B'.repeat(
        24,
      ),
    ].join(
      '',
    ),
    token(
      'npm_',
      'C'.repeat(
        40,
      ),
    ),
  ].join(
    '\n',
  );

  assert.deepEqual(
    findSecretsInText(
      input,
    ).map(
      ({
        type,
        line,
      }) => ({
        type,
        line,
      }),
    ),
    [
      {
        type:
          'private-key',
        line: 1,
      },
      {
        type:
          'slack-token',
        line: 2,
      },
      {
        type:
          'sendgrid-api-key',
        line: 3,
      },
      {
        type:
          'npm-access-token',
        line: 4,
      },
    ],
  );
});

test('secret scanner ignores placeholders and ordinary test credentials', () => {
  const input = [
    'DATABASE_ROLE_PASSWORD=app-ci-password',
    'METRICS_BEARER_TOKEN=replace-with-random-token',
    'token: test-token',
    'password: migration-secret',
    'Authorization: Bearer example',
  ].join(
    '\n',
  );

  assert.deepEqual(
    findSecretsInText(
      input,
    ),
    [],
  );
});
