import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  fileURLToPath,
} from 'node:url';

const root =
  path.resolve(
    path.dirname(
      fileURLToPath(
        import.meta.url,
      ),
    ),
    '..',
  );

async function javascriptFiles(
  directory,
) {
  const result = [];

  for (
    const entry of
    await fs.readdir(
      directory,
      {
        withFileTypes: true,
      },
    )
  ) {
    const full =
      path.join(
        directory,
        entry.name,
      );

    if (entry.isDirectory()) {
      result.push(
        ...await javascriptFiles(
          full,
        ),
      );
      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith(
        '.js',
      )
    ) {
      result.push(full);
    }
  }

  return result;
}

test('online admin authentication remains session-only with no Basic fallback', async () => {
  await assert.rejects(
    fs.access(
      path.join(
        root,
        'src/http/basic-auth.js',
      ),
    ),
    (error) =>
      error?.code ===
      'ENOENT',
  );

  const files = [
    ...await javascriptFiles(
      path.join(
        root,
        'src',
      ),
    ),
    ...await javascriptFiles(
      path.join(
        root,
        'admin',
      ),
    ),
  ];

  const violations = [];

  for (const file of files) {
    const source =
      await fs.readFile(
        file,
        'utf8',
      );

    for (
      const pattern of [
        /parseBasicAuthorization/u,
        /verifyBasicAuthorization/u,
        /createBasicAuth/u,
        /WWW-Authenticate[^\n]*Basic/iu,
        /authMethod[^\n]*['"]basic['"]/iu,
        /logout-basic/u,
      ]
    ) {
      if (pattern.test(source)) {
        violations.push({
          file:
            path.relative(
              root,
              file,
            ),
          pattern:
            String(pattern),
        });
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
  );
});
