import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

async function unlinkIfPresent(filePath) {
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function removeObsoleteFiles(
  directory,
  keepNames,
  obsoletePattern,
) {
  const entries = await fs.readdir(
    directory,
    { withFileTypes: true },
  );

  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          obsoletePattern.test(entry.name) &&
          !keepNames.has(entry.name),
      )
      .map(
        (entry) =>
          unlinkIfPresent(
            path.join(directory, entry.name),
          ),
      ),
  );
}

/**
 * Atomically replace a small related set of materialized files using temporary
 * siblings followed by rename. Obsolete matching files are removed only after
 * every requested file has been promoted.
 *
 * @param {{
 *   directory: string,
 *   files: Array<{ name: string, content: string | Buffer, encoding?: BufferEncoding }>,
 *   obsoletePattern?: RegExp
 * }} options
 */
export async function replaceAtomicSnapshotFiles({
  directory,
  files,
  obsoletePattern = /$^/,
}) {
  await fs.mkdir(directory, { recursive: true });

  const token =
    `${process.pid}-${Date.now()}-${crypto.randomUUID()}`;

  const pending = files.map((file) => ({
    ...file,
    finalPath: path.join(directory, file.name),
    tempPath: path.join(
      directory,
      `.${file.name}.${token}.tmp`,
    ),
  }));

  try {
    await Promise.all(
      pending.map(
        (file) =>
          fs.writeFile(
            file.tempPath,
            file.content,
            file.encoding,
          ),
      ),
    );

    for (const file of pending) {
      await fs.rename(
        file.tempPath,
        file.finalPath,
      );
    }

    await removeObsoleteFiles(
      directory,
      new Set(files.map((file) => file.name)),
      obsoletePattern,
    );
  } finally {
    await Promise.allSettled(
      pending.map(
        (file) => fs.unlink(file.tempPath),
      ),
    );
  }

  return Object.fromEntries(
    pending.map(
      (file) => [
        file.name,
        file.finalPath,
      ],
    ),
  );
}
