import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  isPointTypeIconFileName,
} from './type-icon.js';

function safeFileName(
  value,
) {
  const fileName =
    String(
      value ?? '',
    );

  if (
    !isPointTypeIconFileName(
      fileName,
    ) ||
    path.basename(
      fileName,
    ) !== fileName
  ) {
    throw new Error(
      'Unsafe point type icon file name',
    );
  }

  return fileName;
}

export function createPointTypeIconFileStore(
  directory,
) {
  if (
    typeof directory !== 'string' ||
    !directory
  ) {
    throw new TypeError(
      'Point type icon directory is required',
    );
  }

  async function ensureDirectory() {
    await fs.mkdir(
      directory,
      {
        recursive: true,
        mode: 0o750,
      },
    );
  }

  function filePath(fileName) {
    return path.join(
      directory,
      safeFileName(
        fileName,
      ),
    );
  }

  return {
    directory,

    async save(
      fileName,
      data,
    ) {
      await ensureDirectory();

      const safeName =
        safeFileName(
          fileName,
        );
      const destination =
        filePath(safeName);
      const temporary =
        path.join(
          directory,
          '.point-type-icon-' +
          process.pid +
          '-' +
          crypto.randomUUID() +
          '.tmp',
        );

      try {
        const handle =
          await fs.open(
            temporary,
            'wx',
            0o640,
          );
        try {
          await handle.writeFile(
            data,
          );
          await handle.sync();
        } finally {
          await handle.close();
        }

        await fs.rename(
          temporary,
          destination,
        );

        return {
          fileName:
            safeName,
          path:
            destination,
        };
      } catch (error) {
        await fs
          .unlink(
            temporary,
          )
          .catch(() => {});
        throw error;
      }
    },

    async read(fileName) {
      return fs.readFile(
        filePath(fileName),
      );
    },

    async reconcile(
      referencedFileNames,
    ) {
      await ensureDirectory();

      const referenced =
        new Set();

      for (
        const fileName of
        referencedFileNames ?? []
      ) {
        referenced.add(
          safeFileName(
            fileName,
          ),
        );
      }

      const entries =
        await fs.readdir(
          directory,
          {
            withFileTypes: true,
          },
        );

      let removed = 0;
      let removedTemporary = 0;

      for (
        const entry of entries
      ) {
        if (!entry.isFile()) {
          continue;
        }

        const candidate =
          entry.name;

        if (
          candidate.startsWith(
            '.point-type-icon-',
          ) &&
          candidate.endsWith(
            '.tmp',
          )
        ) {
          await fs.unlink(
            path.join(
              directory,
              candidate,
            ),
          );
          removedTemporary += 1;
          continue;
        }

        if (
          !isPointTypeIconFileName(
            candidate,
          ) ||
          referenced.has(
            candidate,
          )
        ) {
          continue;
        }

        await fs.unlink(
          path.join(
            directory,
            candidate,
          ),
        );
        removed += 1;
      }

      let missing = 0;

      for (
        const fileName of
        referenced
      ) {
        try {
          await fs.access(
            filePath(
              fileName,
            ),
          );
        } catch (error) {
          if (
            error?.code ===
            'ENOENT'
          ) {
            missing += 1;
            continue;
          }
          throw error;
        }
      }

      return {
        referenced:
          referenced.size,
        removed,
        removedTemporary,
        missing,
      };
    },

    async remove(fileName) {
      if (!fileName) {
        return false;
      }

      try {
        await fs.unlink(
          filePath(fileName),
        );
        return true;
      } catch (error) {
        if (
          error?.code ===
          'ENOENT'
        ) {
          return false;
        }
        throw error;
      }
    },
  };
}
