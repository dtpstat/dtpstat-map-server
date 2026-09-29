import crypto from 'node:crypto';

const BASE32_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MFA_SECRET_BYTES =
  20;
const MFA_IV_BYTES =
  12;
const MFA_TAG_BYTES =
  16;
const MFA_CIPHERTEXT_VERSION =
  1;
const TOTP_PERIOD_SECONDS =
  30;
const TOTP_DIGITS =
  6;
const MFA_TOKEN_BYTES =
  32;
const RECOVERY_CODE_BYTES =
  10;

export function decodeMfaEncryptionKey(
  value,
) {
  if (
    typeof value !==
      'string' ||
    !/^[A-Za-z0-9_-]{43}$/u
      .test(
        value,
      )
  ) {
    throw new Error(
      'ADMIN_MFA_ENCRYPTION_KEY must be an unpadded base64url encoding of exactly 32 bytes',
    );
  }

  const key =
    Buffer.from(
      value,
      'base64url',
    );

  if (
    key.length !==
    32
  ) {
    throw new Error(
      'ADMIN_MFA_ENCRYPTION_KEY must decode to exactly 32 bytes',
    );
  }

  return key;
}

export function encodeBase32(
  value,
) {
  const input =
    Buffer.from(
      value,
    );
  let bits = 0;
  let buffer = 0;
  let output = '';

  for (
    const byte of
    input
  ) {
    buffer =
      (
        buffer << 8
      ) |
      byte;
    bits += 8;

    while (
      bits >= 5
    ) {
      output +=
        BASE32_ALPHABET[
          (
            buffer >>
            (
              bits -
              5
            )
          ) &
          31
        ];
      bits -= 5;
    }
  }

  if (
    bits > 0
  ) {
    output +=
      BASE32_ALPHABET[
        (
          buffer <<
          (
            5 -
            bits
          )
        ) &
        31
      ];
  }

  return output;
}

export function decodeBase32(
  value,
) {
  const normalized =
    String(
      value ??
      '',
    )
      .replaceAll(
        '=',
        '',
      )
      .replace(
        /[\s-]+/gu,
        '',
      )
      .toUpperCase();

  if (
    !normalized ||
    !/^[A-Z2-7]+$/u
      .test(
        normalized,
      )
  ) {
    throw new Error(
      'Invalid base32 value',
    );
  }

  let bits = 0;
  let buffer = 0;
  const bytes = [];

  for (
    const character of
    normalized
  ) {
    const index =
      BASE32_ALPHABET
        .indexOf(
          character,
        );

    buffer =
      (
        buffer << 5
      ) |
      index;
    bits += 5;

    if (
      bits >= 8
    ) {
      bytes.push(
        (
          buffer >>
          (
            bits -
            8
          )
        ) &
        0xff,
      );
      bits -= 8;
    }
  }

  return Buffer.from(
    bytes,
  );
}

export function generateTotpSecret() {
  return encodeBase32(
    crypto.randomBytes(
      MFA_SECRET_BYTES,
    ),
  );
}

export function encryptMfaSecret(
  secret,
  encryptionKey,
) {
  const key =
    decodeMfaEncryptionKey(
      encryptionKey,
    );
  const iv =
    crypto.randomBytes(
      MFA_IV_BYTES,
    );
  const cipher =
    crypto.createCipheriv(
      'aes-256-gcm',
      key,
      iv,
    );
  const ciphertext =
    Buffer.concat([
      cipher.update(
        String(secret),
        'utf8',
      ),
      cipher.final(),
    ]);
  const tag =
    cipher.getAuthTag();

  return Buffer.concat([
    Buffer.from([
      MFA_CIPHERTEXT_VERSION,
    ]),
    iv,
    tag,
    ciphertext,
  ]);
}

export function decryptMfaSecret(
  payload,
  encryptionKey,
) {
  const input =
    Buffer.from(
      payload ??
      [],
    );

  if (
    input.length <=
      1 +
      MFA_IV_BYTES +
      MFA_TAG_BYTES ||
    input[0] !==
      MFA_CIPHERTEXT_VERSION
  ) {
    throw new Error(
      'Invalid MFA secret ciphertext',
    );
  }

  const key =
    decodeMfaEncryptionKey(
      encryptionKey,
    );
  const iv =
    input.subarray(
      1,
      1 +
        MFA_IV_BYTES,
    );
  const tag =
    input.subarray(
      1 +
        MFA_IV_BYTES,
      1 +
        MFA_IV_BYTES +
        MFA_TAG_BYTES,
    );
  const ciphertext =
    input.subarray(
      1 +
        MFA_IV_BYTES +
        MFA_TAG_BYTES,
    );
  const decipher =
    crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      iv,
    );

  decipher.setAuthTag(
    tag,
  );

  return Buffer.concat([
    decipher.update(
      ciphertext,
    ),
    decipher.final(),
  ]).toString(
    'utf8',
  );
}

export function totpStep(
  timestampMs =
    Date.now(),
) {
  return Math.floor(
    timestampMs /
    1000 /
    TOTP_PERIOD_SECONDS,
  );
}

export function totpCode(
  secret,
  {
    timestampMs =
      Date.now(),
    digits =
      TOTP_DIGITS,
  } = {},
) {
  if (
    !Number.isInteger(
      digits,
    ) ||
    digits < 6 ||
    digits > 8
  ) {
    throw new Error(
      'TOTP digits must be between 6 and 8',
    );
  }

  const step =
    BigInt(
      totpStep(
        timestampMs,
      ),
    );
  const counter =
    Buffer.alloc(
      8,
    );
  counter.writeBigUInt64BE(
    step,
  );

  const digest =
    crypto
      .createHmac(
        'sha1',
        decodeBase32(
          secret,
        ),
      )
      .update(
        counter,
      )
      .digest();
  const offset =
    digest[
      digest.length -
      1
    ] &
    0x0f;
  const binary =
    (
      (
        digest[offset] &
        0x7f
      ) <<
      24
    ) |
    (
      digest[offset + 1] <<
      16
    ) |
    (
      digest[offset + 2] <<
      8
    ) |
    digest[offset + 3];
  const modulus =
    10 **
    digits;

  return String(
    binary %
    modulus,
  ).padStart(
    digits,
    '0',
  );
}

export function verifyTotpCode(
  secret,
  code,
  {
    timestampMs =
      Date.now(),
    window = 1,
    lastUsedStep =
      null,
  } = {},
) {
  const normalized =
    String(
      code ??
      '',
    ).trim();

  if (
    !/^\d{6}$/u.test(
      normalized,
    ) ||
    !Number.isInteger(
      window,
    ) ||
    window < 0 ||
    window > 5
  ) {
    return {
      valid: false,
      step: null,
    };
  }

  const currentStep =
    totpStep(
      timestampMs,
    );
  const offsets = [
    0,
  ];

  for (
    let distance = 1;
    distance <= window;
    distance += 1
  ) {
    offsets.push(
      -distance,
      distance,
    );
  }

  for (
    const offset of
    offsets
  ) {
    const step =
      currentStep +
      offset;

    if (
      step < 0 ||
      (
        Number.isSafeInteger(
          lastUsedStep,
        ) &&
        step <=
          lastUsedStep
      )
    ) {
      continue;
    }

    const expected =
      totpCode(
        secret,
        {
          timestampMs:
            step *
            TOTP_PERIOD_SECONDS *
            1000,
        },
      );

    if (
      crypto.timingSafeEqual(
        Buffer.from(
          normalized,
        ),
        Buffer.from(
          expected,
        ),
      )
    ) {
      return {
        valid: true,
        step,
      };
    }
  }

  return {
    valid: false,
    step: null,
  };
}

export function totpProvisioningUri({
  secret,
  accountName,
  issuer,
}) {
  const normalizedIssuer =
    String(
      issuer ??
      '',
    ).trim();
  const normalizedAccount =
    String(
      accountName ??
      '',
    ).trim();

  if (
    !normalizedIssuer ||
    !normalizedAccount
  ) {
    throw new Error(
      'TOTP issuer and account name are required',
    );
  }

  const parameters =
    new URLSearchParams({
      secret:
        String(secret),
      issuer:
        normalizedIssuer,
      algorithm:
        'SHA1',
      digits:
        String(
          TOTP_DIGITS,
        ),
      period:
        String(
          TOTP_PERIOD_SECONDS,
        ),
    });

  return (
    'otpauth://totp/' +
    encodeURIComponent(
      normalizedIssuer,
    ) +
    ':' +
    encodeURIComponent(
      normalizedAccount,
    ) +
    '?' +
    parameters.toString()
  );
}

export function normalizeRecoveryCode(
  value,
) {
  const normalized =
    String(
      value ??
      '',
    )
      .replace(
        /[\s-]+/gu,
        '',
      )
      .toUpperCase();

  return /^[A-Z2-7]{16}$/u
    .test(
      normalized,
    )
    ? normalized
    : null;
}

export function generateRecoveryCodes(
  count = 10,
) {
  if (
    !Number.isInteger(
      count,
    ) ||
    count < 1 ||
    count > 32
  ) {
    throw new Error(
      'Recovery code count must be between 1 and 32',
    );
  }

  const codes =
    new Set();

  while (
    codes.size <
    count
  ) {
    const compact =
      encodeBase32(
        crypto.randomBytes(
          RECOVERY_CODE_BYTES,
        ),
      );

    codes.add(
      compact.match(
        /.{1,4}/gu,
      ).join(
        '-',
      ),
    );
  }

  return [
    ...codes,
  ];
}

export function recoveryCodeHash(
  value,
) {
  const normalized =
    normalizeRecoveryCode(
      value,
    );

  if (!normalized) {
    return null;
  }

  return crypto
    .createHash(
      'sha256',
    )
    .update(
      normalized,
      'utf8',
    )
    .digest();
}

export function generateMfaChallengeToken() {
  return crypto
    .randomBytes(
      MFA_TOKEN_BYTES,
    )
    .toString(
      'base64url',
    );
}

export function mfaChallengeTokenHash(
  token,
) {
  return crypto
    .createHash(
      'sha256',
    )
    .update(
      String(
        token ??
        '',
      ),
      'utf8',
    )
    .digest();
}
