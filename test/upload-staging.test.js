import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  cleanupStagedUploads,
  removeStagedUpload,
  stageUploadStream,
} from '../src/shared/files/upload-staging.js';

async function withDirectory(callback) {
  const directory =
    await fs.mkdtemp(
      path.join(
        os.tmpdir(),
        'dtpstat-upload-',
      ),
    );

  try {
    await callback(directory);
  } finally {
    await fs.rm(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }
}

test('upload staging streams bytes to a private spool and fingerprints them', async () => {
  await withDirectory(
    async (directory) => {
      const payload =
        Buffer.from(
          '{"ok":true}',
        );

      const upload =
        await stageUploadStream(
          Readable.from(
            [payload],
          ),
          {
            directory,
            maxUploadBytes: 1024,
          },
        );

      assert.equal(
        upload.bytes,
        payload.length,
      );

      assert.equal(
        upload.sha256,
        crypto
          .createHash('sha256')
          .update(payload)
          .digest('hex'),
      );

      assert.deepEqual(
        await fs.readFile(
          upload.path,
        ),
        payload,
      );

      const stat =
        await fs.stat(
          upload.path,
        );

      assert.equal(
        stat.mode & 0o777,
        0o600,
      );

      await removeStagedUpload(
        upload,
      );

      await assert.rejects(
        fs.stat(upload.path),
        /ENOENT/u,
      );
    },
  );
});

test('upload staging removes a partial spool when the byte limit is exceeded', async () => {
  await withDirectory(
    async (directory) => {
      await assert.rejects(
        stageUploadStream(
          Readable.from([
            Buffer.alloc(8),
            Buffer.alloc(8),
          ]),
          {
            directory,
            maxUploadBytes: 10,
          },
        ),
        /Upload exceeds the configured limit/u,
      );

      assert.deepEqual(
        await fs.readdir(
          directory,
        ),
        [],
      );
    },
  );
});

test('orphan upload cleanup removes only stale portable spools', async () => {
  await withDirectory(
    async (directory) => {
      const stale =
        path.join(
          directory,
          '.portable-upload-old.tmp',
        );

      const fresh =
        path.join(
          directory,
          '.portable-upload-new.tmp',
        );

      const unrelated =
        path.join(
          directory,
          'keep.tmp',
        );

      await Promise.all([
        fs.writeFile(stale, 'old'),
        fs.writeFile(fresh, 'new'),
        fs.writeFile(unrelated, 'keep'),
      ]);

      const oldTime =
        new Date(
          Date.now() -
          48 * 60 * 60 * 1000,
        );

      await fs.utimes(
        stale,
        oldTime,
        oldTime,
      );

      const removed =
        await cleanupStagedUploads(
          directory,
          {
            olderThanMs:
              24 * 60 * 60 * 1000,
          },
        );

      assert.equal(
        removed,
        1,
      );

      assert.deepEqual(
        (
          await fs.readdir(
            directory,
          )
        ).sort(),
        [
          '.portable-upload-new.tmp',
          'keep.tmp',
        ],
      );
    },
  );
});
