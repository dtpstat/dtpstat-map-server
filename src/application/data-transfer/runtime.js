import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createSingleFileZipStream } from '../../shared/streaming/single-file-zip.js';
import {
  openUploadedJson,
  receiveStreamUpload,
  removeStreamUpload,
  StreamUploadError,
} from '../../http/stream-upload.js';

const portableContentTypes = new Set([
  'application/json',
  'application/geo+json',
  'application/zip',
]);

export function createDataTransferRuntime({
  importApi,
  progressLog,
}) {
  const streamTransfer = {
    uploadDirectory: importApi.streamUploadDirectory ??
      path.join(process.cwd(), 'var', 'import-staging'),
    maxUploadBytes: importApi.maxStreamUploadBytes ?? importApi.maxBodyBytes,
    maxJsonBytes: importApi.maxStreamJsonBytes ?? importApi.maxBodyBytes,
    maxItemBytes: importApi.maxStreamItemBytes ?? importApi.maxBodyBytes,
    maxZipCompressionRatio:
      importApi.maxStreamZipCompressionRatio ?? 1000,
    maxZipEntries: importApi.maxStreamZipEntries ?? 64,
    maxJsonDepth: importApi.maxStreamJsonDepth ?? 128,
    maxJsonItems: importApi.maxStreamJsonItems ?? 5_000_000,
  };

  const streamingExportRoute = (
    fileName,
    contentType,
    streamLoader,
    fallbackLoader,
    zip = false,
  ) => async (request, response, next) => {
    try {
      const source = typeof streamLoader === 'function'
        ? streamLoader()
        : [JSON.stringify(await fallbackLoader()), '\n'];
      const output = zip
        ? createSingleFileZipStream(fileName, source, {
            signal: request.signal,
          })
        : Readable.from(source);
      const downloadName = zip
        ? `${fileName.replace(/\.(?:geojson|json)$/iu, '')}.zip`
        : fileName;
      response
        .set('Cache-Control', 'no-store')
        .set(
          'Content-Disposition',
          `attachment; filename="${downloadName}"`,
        )
        .type(zip ? 'application/zip' : contentType);
      await pipeline(output, response);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      next(error);
    }
  };

  const receivePortableUpload = async (request, response, next) => {
    try {
      return await receiveStreamUpload(request, {
        directory: streamTransfer.uploadDirectory,
        maxUploadBytes: streamTransfer.maxUploadBytes,
        allowedContentTypes: portableContentTypes,
      });
    } catch (error) {
      if (error instanceof StreamUploadError) {
        response.status(error.statusCode).json({ error: error.message });
        return null;
      }
      next(error);
      return null;
    }
  };

  const portableServiceMethod = (service, streamingName) => {
    if (typeof service?.[streamingName] !== 'function') {
      throw new Error(
        `Streaming transfer service method is unavailable: ${streamingName}`,
      );
    }
    return service[streamingName].bind(service);
  };

  const executePortableUpload = async (
    upload,
    context,
    serviceMethod,
    operation = {},
  ) => {
    try {
      const input = await openUploadedJson(upload, {
        maxJsonBytes: streamTransfer.maxJsonBytes,
        maxZipCompressionRatio: streamTransfer.maxZipCompressionRatio,
        maxZipEntries: streamTransfer.maxZipEntries,
        signal: context.signal,
      });
      context.log('Входной поток подготовлен', {
        transport: input.transport,
        archiveEntry: input.fileName,
        uploadBytes: upload.bytes,
        expectedJsonBytes: input.expectedJsonBytes,
      });
      return await serviceMethod(input.stream, {
        ...operation,
        maxJsonBytes: streamTransfer.maxJsonBytes,
        maxItemBytes: streamTransfer.maxItemBytes,
        maxJsonDepth: streamTransfer.maxJsonDepth,
        maxJsonItems: streamTransfer.maxJsonItems,
        signal: context.signal,
        onCommit: () => context.beginCommit(),
        onProgress: (progress) => progressLog(context, progress),
      });
    } finally {
      await removeStreamUpload(upload).catch((error) => {
        context.log(
          'Не удалось удалить временный upload-файл',
          { message: error.message },
          'warning',
        );
      });
    }
  };

  return {
    executePortableUpload,
    portableServiceMethod,
    receivePortableUpload,
    removeStreamUpload,
    streamTransfer,
    streamingExportRoute,
  };
}
