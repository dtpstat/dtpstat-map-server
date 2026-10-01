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

  for (
    const entry of
    entries
  ) {
    if (
      !entry.isFile() ||
      !/\.ya?ml$/u.test(
        entry.name,
      )
    ) {
      continue;
    }

    const source =
      await fs.readFile(
        path.join(
          workflowsDir,
          entry.name,
        ),
        'utf8',
      );

    const checkoutSteps =
      source.match(
        /uses:\s*actions\/checkout@[0-9a-f]{40}[\s\S]*?(?=\n\s*-\s+(?:uses:|name:|run:)|\n\s{2}[a-zA-Z_-]+:|$)/gu,
      ) ??
      [];

    for (
      const step of
      checkoutSteps
    ) {
      assert.match(
        step,
        /persist-credentials:\s*false/u,
        `${entry.name}: checkout must disable persisted credentials`,
      );
    }
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


test('CodeQL workflow uses bounded security-event permission and pinned analysis actions', async () => {
  const source =
    await fs.readFile(
      path.join(
        root,
        '.github',
        'workflows',
        'codeql.yml',
      ),
      'utf8',
    );

  assert.match(
    source,
    /^permissions:\n\s+contents:\s+read$/mu,
  );
  assert.match(
    source,
    /permissions:\n\s+contents:\s+read\n\s+security-events:\s+write/u,
  );
  assert.doesNotMatch(
    source,
    /^\s+contents:\s+write$/mu,
  );
  assert.match(
    source,
    /github\/codeql-action\/init@[0-9a-f]{40}/u,
  );
  assert.match(
    source,
    /github\/codeql-action\/analyze@[0-9a-f]{40}/u,
  );
  assert.match(
    source,
    /languages:\s+javascript-typescript/u,
  );
});

test('Dependabot covers npm and GitHub Actions on a weekly bounded cadence', async () => {
  const source =
    await fs.readFile(
      path.join(
        root,
        '.github',
        'dependabot.yml',
      ),
      'utf8',
    );

  assert.match(
    source,
    /package-ecosystem:\s+npm/u,
  );
  assert.match(
    source,
    /package-ecosystem:\s+github-actions/u,
  );

  const weekly =
    source.match(
      /interval:\s+weekly/gu,
    ) ??
    [];

  assert.equal(
    weekly.length,
    2,
  );

  const limits =
    source.match(
      /open-pull-requests-limit:\s+5/gu,
    ) ??
    [];

  assert.equal(
    limits.length,
    2,
  );
});
