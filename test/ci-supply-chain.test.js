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

test('GitHub Actions dependencies are pinned to immutable full commit SHAs', async () => {
  const workflowsDir =
    path.join(
      root,
      '.github',
      'workflows',
    );
  const entries =
    await fs.readdir(
      workflowsDir,
      {
        withFileTypes: true,
      },
    );
  const workflowFiles =
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /\.ya?ml$/u.test(
            entry.name,
          ),
      )
      .map(
        (entry) =>
          entry.name,
      );

  assert.ok(
    workflowFiles.length >
      0,
    'Expected at least one GitHub Actions workflow',
  );

  for (
    const file of
    workflowFiles
  ) {
    const source =
      await fs.readFile(
        path.join(
          workflowsDir,
          file,
        ),
        'utf8',
      );
    const uses =
      [
        ...source.matchAll(
          /^\s*-?\s*uses:\s*([^\s#]+)(?:\s+#.*)?$/gmu,
        ),
      ].map(
        (match) =>
          match[1],
      );

    for (
      const dependency of
      uses
    ) {
      if (
        dependency.startsWith(
          './',
        )
      ) {
        continue;
      }

      assert.match(
        dependency,
        /^[^@\s]+@[0-9a-f]{40}$/u,
        `${file}: action dependency must use a full 40-character commit SHA: ${dependency}`,
      );
    }
  }
});

test('GitHub Actions checkout never persists repository credentials', async () => {
  const source =
    await fs.readFile(
      path.join(
        root,
        '.github',
        'workflows',
        'geometry-editor-check.yml',
      ),
      'utf8',
    );

  const checkoutSteps =
    source.match(
      /uses:\s*actions\/checkout@[0-9a-f]{40}[\s\S]*?(?=\n\s*-\s+(?:uses:|name:|run:)|\n\s{2}[a-zA-Z_-]+:|$)/gu,
    ) ??
    [];

  assert.ok(
    checkoutSteps.length >
      0,
  );

  for (
    const step of
    checkoutSteps
  ) {
    assert.match(
      step,
      /persist-credentials:\s*false/u,
    );
  }
});

test('CI keeps the workflow token read-only', async () => {
  const source =
    await fs.readFile(
      path.join(
        root,
        '.github',
        'workflows',
        'geometry-editor-check.yml',
      ),
      'utf8',
    );

  assert.match(
    source,
    /^permissions:\n\s+contents:\s+read$/mu,
  );
  assert.doesNotMatch(
    source,
    /^\s+(?:actions|checks|contents|deployments|id-token|issues|packages|pull-requests|security-events|statuses):\s+write$/mu,
  );
});
