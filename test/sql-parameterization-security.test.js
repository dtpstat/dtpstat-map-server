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

const LOWERCASE_SQL_INTERPOLATION_ALLOWLIST =
  Object.freeze({
    'src/db/migration-runner.js':
      new Set([
        'target',
        'historyTable',
      ]),
    'src/db/data-export-storage-repository.js':
      new Set([
        'cursorName',
        'sql',
        'fetchSize',
      ]),
    'src/db/migration-state.js':
      new Set([
        'table',
      ]),
  });

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

function sqlTemplateInterpolations(
  source,
) {
  const result = [];
  const queryTemplate =
    /\.query\s*\(\s*`([\s\S]*?)`/gmu;

  for (
    const query of
    source.matchAll(
      queryTemplate,
    )
  ) {
    for (
      const interpolation of
      query[1].matchAll(
        /\$\{([^}]+)\}/gmu,
      )
    ) {
      result.push(
        interpolation[1]
          .trim(),
      );
    }
  }

  return result;
}

function compileTimeSqlFragment(
  expression,
) {
  return /^[A-Z][A-Z0-9_]*(?:\([\s\S]*\))?$/u
    .test(expression);
}

test('database SQL templates never interpolate unreviewed runtime values', async () => {
  const directories = [
    path.join(
      root,
      'src/db',
    ),
    path.join(
      root,
      'src/modules',
    ),
  ];
  const violations = [];

  for (const directory of directories) {
    for (
      const file of
      await javascriptFiles(
        directory,
      )
    ) {
      const relative =
        path.relative(
          root,
          file,
        );

      if (
        relative.startsWith(
          'src/modules/',
        ) &&
        !/(?:repository|storage)\.js$/u
          .test(relative)
      ) {
        continue;
      }

      const source =
        await fs.readFile(
          file,
          'utf8',
        );

      for (
        const expression of
        sqlTemplateInterpolations(
          source,
        )
      ) {
        if (
          compileTimeSqlFragment(
            expression,
          )
        ) {
          continue;
        }

        if (
          LOWERCASE_SQL_INTERPOLATION_ALLOWLIST[
            relative
          ]?.has(
            expression,
          )
        ) {
          continue;
        }

        violations.push({
          file:
            relative,
          expression,
        });
      }

      assert.doesNotMatch(
        source,
        /\.query\s*\(\s*`[\s\S]*?\$\{\s*(?:request|response|payload|body|params|query)\b/iu,
        relative +
          ' must never interpolate HTTP/domain input directly into SQL',
      );
    }
  }

  assert.deepEqual(
    violations,
    [],
    'New dynamic SQL interpolation requires explicit security review and allowlisting',
  );
});

test('known dynamic SQL identifiers are internal infrastructure only', async () => {
  const migration =
    await fs.readFile(
      path.join(
        root,
        'src/db/migration-runner.js',
      ),
      'utf8',
    );
  const exportStorage =
    await fs.readFile(
      path.join(
        root,
        'src/db/data-export-storage-repository.js',
      ),
      'utf8',
    );

  assert.match(
    migration,
    /migrationHistoryTable\(target\)/u,
  );
  assert.match(
    exportStorage,
    /cursorRows\(client, cursorName, sql, fetchSize = 100\)/u,
  );
  assert.match(
    exportStorage,
    /'portable_city_export'/u,
  );
  assert.match(
    exportStorage,
    /'portable_line_export'/u,
  );
  assert.match(
    exportStorage,
    /'portable_population_export'/u,
  );
});


function runtimeSqlBoundaryFile(
  relative,
) {
  return (
    relative.startsWith(
      'src/db/',
    ) &&
    (
      /(?:repository|storage)\.js$/u
        .test(relative) ||
      [
        'src/db/cities-repository.js',
        'src/db/city-boundary-hierarchy.js',
        'src/db/database-locks.js',
      ].includes(relative)
    )
  ) ||
  (
    relative.startsWith(
      'src/modules/',
    ) &&
    /(?:repository|storage)\.js$/u
      .test(relative)
  );
}

test('runtime SQL bind parameters always declare an explicit PostgreSQL type', async () => {
  const directories = [
    path.join(
      root,
      'src/db',
    ),
    path.join(
      root,
      'src/modules',
    ),
  ];
  const violations = [];

  for (const directory of directories) {
    for (
      const file of
      await javascriptFiles(
        directory,
      )
    ) {
      const relative =
        path.relative(
          root,
          file,
        );

      if (
        !runtimeSqlBoundaryFile(
          relative,
        )
      ) {
        continue;
      }

      const source =
        await fs.readFile(
          file,
          'utf8',
        );

      for (
        const match of
        source.matchAll(
          /\$(\d+)(?!\d)(?!::)/gmu,
        )
      ) {
        violations.push({
          file:
            relative,
          parameter:
            '$' + match[1],
        });
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    'Every runtime SQL bind parameter must use an explicit PostgreSQL cast such as $1::bigint or $2::text',
  );
});
