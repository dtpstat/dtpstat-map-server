import {
  execFileSync,
} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  fileURLToPath,
} from 'node:url';

const MAX_TEXT_FILE_BYTES =
  10 * 1024 * 1024;

export const SECRET_PATTERNS =
  Object.freeze([
    {
      name:
        'private-key',
      pattern:
        /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gu,
    },
    {
      name:
        'github-token',
      pattern:
        /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/gu,
    },
    {
      name:
        'github-fine-grained-token',
      pattern:
        /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/gu,
    },
    {
      name:
        'aws-access-key',
      pattern:
        /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
    },
    {
      name:
        'google-api-key',
      pattern:
        /\bAIza[0-9A-Za-z_-]{35}\b/gu,
    },
    {
      name:
        'slack-token',
      pattern:
        /\bxox[baprs]-[0-9A-Za-z-]{10,255}\b/gu,
    },
    {
      name:
        'stripe-live-secret',
      pattern:
        /\bsk_live_[0-9A-Za-z]{16,255}\b/gu,
    },
    {
      name:
        'sendgrid-api-key',
      pattern:
        /\bSG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,}\b/gu,
    },
    {
      name:
        'npm-access-token',
      pattern:
        /\bnpm_[0-9A-Za-z]{36,255}\b/gu,
    },
  ]);

function lineNumberAt(
  text,
  index,
) {
  let line =
    1;

  for (
    let cursor = 0;
    cursor < index;
    cursor += 1
  ) {
    if (
      text.charCodeAt(
        cursor,
      ) === 10
    ) {
      line +=
        1;
    }
  }

  return line;
}

export function findSecretsInText(
  text,
) {
  const findings = [];

  for (
    const {
      name,
      pattern,
    } of SECRET_PATTERNS
  ) {
    pattern.lastIndex =
      0;

    for (
      const match of
      text.matchAll(
        pattern,
      )
    ) {
      findings.push({
        type:
          name,
        line:
          lineNumberAt(
            text,
            match.index ??
              0,
          ),
      });
    }
  }

  return findings;
}

function trackedFiles(
  root,
) {
  return execFileSync(
    'git',
    [
      '-C',
      root,
      'ls-files',
      '-z',
    ],
    {
      encoding:
        'utf8',
      maxBuffer:
        16 * 1024 * 1024,
    },
  )
    .split(
      '\0',
    )
    .filter(
      Boolean,
    );
}

function textFileContents(
  filename,
) {
  const stat =
    fs.statSync(
      filename,
    );

  if (
    stat.size >
    MAX_TEXT_FILE_BYTES
  ) {
    return null;
  }

  const buffer =
    fs.readFileSync(
      filename,
    );

  if (
    buffer.includes(
      0,
    )
  ) {
    return null;
  }

  return buffer.toString(
    'utf8',
  );
}

export function scanTrackedFiles(
  root = process.cwd(),
) {
  const findings = [];

  for (
    const relativePath of
    trackedFiles(
      root,
    )
  ) {
    const filename =
      path.join(
        root,
        relativePath,
      );
    const text =
      textFileContents(
        filename,
      );

    if (
      text === null
    ) {
      continue;
    }

    for (
      const finding of
      findSecretsInText(
        text,
      )
    ) {
      findings.push({
        file:
          relativePath,
        ...finding,
      });
    }
  }

  return findings;
}

function run() {
  const findings =
    scanTrackedFiles();

  if (
    findings.length ===
    0
  ) {
    console.log(
      'Secret scan passed: no high-confidence credentials found.',
    );
    return;
  }

  console.error(
    `Secret scan failed: ${findings.length} high-confidence credential candidate(s) found.`,
  );

  for (
    const finding of
    findings
  ) {
    console.error(
      `- ${finding.file}:${finding.line} [${finding.type}]`,
    );
  }

  process.exitCode =
    1;
}

const invokedAsScript =
  process.argv[1] &&
  path.resolve(
    process.argv[1],
  ) ===
    fileURLToPath(
      import.meta.url,
    );

if (
  invokedAsScript
) {
  run();
}
