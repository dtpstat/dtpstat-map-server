import assert from 'node:assert/strict';
import test from 'node:test';
import {
  StreamUploadError,
  validateStreamUploadTransport,
} from '../src/shared/http/upload-policy.js';

const options = {
  maxUploadBytes: 1024,
  allowedContentTypes: new Set([
    'application/json',
    'application/geo+json',
    'application/zip',
  ]),
};

test('stream upload transport policy normalizes allowed JSON metadata', () => {
  assert.deepEqual(
    validateStreamUploadTransport(
      {
        contentTypeHeader:
          'Application/JSON; charset=utf-8',
        contentEncodingHeader:
          ' GZIP ',
        contentLengthHeader:
          '512',
      },
      options,
    ),
    {
      contentType:
        'application/json',
      contentEncoding: 'gzip',
      declaredLength: 512,
    },
  );

  assert.deepEqual(
    validateStreamUploadTransport(
      {
        contentTypeHeader:
          'application/geo+json',
      },
      options,
    ),
    {
      contentType:
        'application/geo+json',
      contentEncoding:
        'identity',
      declaredLength: null,
    },
  );
});

test('stream upload transport policy rejects unsafe type encoding and declared size', () => {
  assert.throws(
    () =>
      validateStreamUploadTransport(
        {
          contentTypeHeader:
            'text/plain',
        },
        options,
      ),
    (error) =>
      error instanceof
        StreamUploadError &&
      error.statusCode === 415,
  );

  assert.throws(
    () =>
      validateStreamUploadTransport(
        {
          contentTypeHeader:
            'application/json',
          contentEncodingHeader:
            'compress',
        },
        options,
      ),
    /Unsupported Content-Encoding/u,
  );

  assert.throws(
    () =>
      validateStreamUploadTransport(
        {
          contentTypeHeader:
            'application/json',
          contentLengthHeader:
            '1025',
        },
        options,
      ),
    (error) =>
      error instanceof
        StreamUploadError &&
      error.statusCode === 413,
  );
});

test('stream upload transport policy forbids extra HTTP encoding around ZIP', () => {
  assert.throws(
    () =>
      validateStreamUploadTransport(
        {
          contentTypeHeader:
            'application/zip',
          contentEncodingHeader:
            'gzip',
        },
        options,
      ),
    /ZIP uploads must not use an additional HTTP Content-Encoding/u,
  );
});
