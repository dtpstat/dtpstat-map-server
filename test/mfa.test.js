import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  decodeMfaEncryptionKey,
  decryptMfaSecret,
  encodeBase32,
  encryptMfaSecret,
  generateMfaChallengeToken,
  generateRecoveryCodes,
  generateTotpSecret,
  mfaChallengeTokenHash,
  normalizeRecoveryCode,
  recoveryCodeHash,
  totpCode,
  totpProvisioningUri,
  verifyTotpCode,
} from '../src/modules/security/mfa.js';

const KEY =
  Buffer.alloc(
    32,
    7,
  ).toString(
    'base64url',
  );

test('MFA encryption key requires exactly 32 base64url bytes', () => {
  assert.equal(
    decodeMfaEncryptionKey(
      KEY,
    ).length,
    32,
  );
  assert.throws(
    () =>
      decodeMfaEncryptionKey(
        'too-short',
      ),
    /exactly 32 bytes/u,
  );
});

test('TOTP implementation matches the RFC 6238 SHA1 vector', () => {
  const secret =
    encodeBase32(
      Buffer.from(
        '12345678901234567890',
        'ascii',
      ),
    );

  assert.equal(
    totpCode(
      secret,
      {
        timestampMs:
          59_000,
        digits: 8,
      },
    ),
    '94287082',
  );
});

test('TOTP verification accepts a bounded clock window and rejects replayed steps', () => {
  const secret =
    generateTotpSecret();
  const timestampMs =
    1_700_000_000_000;
  const code =
    totpCode(
      secret,
      {
        timestampMs,
      },
    );
  const result =
    verifyTotpCode(
      secret,
      code,
      {
        timestampMs:
          timestampMs +
          20_000,
        window: 1,
      },
    );

  assert.equal(
    result.valid,
    true,
  );
  assert.equal(
    verifyTotpCode(
      secret,
      code,
      {
        timestampMs:
          timestampMs +
          20_000,
        window: 1,
        lastUsedStep:
          result.step,
      },
    ).valid,
    false,
  );
});

test('MFA TOTP secret encryption round-trips and rejects tampering', () => {
  const secret =
    generateTotpSecret();
  const encrypted =
    encryptMfaSecret(
      secret,
      KEY,
    );

  assert.equal(
    decryptMfaSecret(
      encrypted,
      KEY,
    ),
    secret,
  );
  assert.notEqual(
    encrypted
      .includes(
        Buffer.from(
          secret,
        ),
      ),
    true,
  );

  const tampered =
    Buffer.from(
      encrypted,
    );
  tampered[
    tampered.length -
    1
  ] ^=
    1;

  assert.throws(
    () =>
      decryptMfaSecret(
        tampered,
        KEY,
      ),
  );
});

test('MFA provisioning URI carries only the enrollment secret and public labels', () => {
  const uri =
    totpProvisioningUri({
      secret:
        'JBSWY3DPEHPK3PXP',
      accountName:
        'admin@example',
      issuer:
        'DTP-Stat',
    });

  assert.match(
    uri,
    /^otpauth:\/\/totp\//u,
  );
  assert.match(
    uri,
    /secret=JBSWY3DPEHPK3PXP/u,
  );
  assert.match(
    uri,
    /issuer=DTP-Stat/u,
  );
});

test('MFA recovery codes are unique high-entropy values stored as hashes', () => {
  const codes =
    generateRecoveryCodes(
      10,
    );

  assert.equal(
    codes.length,
    10,
  );
  assert.equal(
    new Set(
      codes,
    ).size,
    10,
  );

  for (
    const code of
    codes
  ) {
    assert.match(
      code,
      /^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){3}$/u,
    );
    assert.equal(
      normalizeRecoveryCode(
        code.toLowerCase(),
      ),
      code.replaceAll(
        '-',
        '',
      ),
    );
    assert.equal(
      recoveryCodeHash(
        code,
      ).length,
      32,
    );
  }
});

test('MFA login challenges use opaque tokens with SHA-256 persistence hashes', () => {
  const token =
    generateMfaChallengeToken();
  const hash =
    mfaChallengeTokenHash(
      token,
    );

  assert.match(
    token,
    /^[A-Za-z0-9_-]{40,}$/u,
  );
  assert.equal(
    hash.length,
    32,
  );
  assert.equal(
    crypto
      .timingSafeEqual(
        hash,
        mfaChallengeTokenHash(
          token,
        ),
      ),
    true,
  );
});
