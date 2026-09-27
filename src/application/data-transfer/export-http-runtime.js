import {
  Readable,
} from 'node:stream';
import {
  pipeline,
} from 'node:stream/promises';
import {
  createSingleFileZipStream,
} from '../../shared/streaming/single-file-zip.js';

/**
 * Build one streamed portable-download HTTP handler. The caller owns
 * authorization/audit middleware and supplies either a streaming loader or a
 * materialized fallback.
 */
export function createStreamingExportRoute(
  fileName,
  contentType,
  streamLoader,
  fallbackLoader,
  zip = false,
) {
  return async function streamingExportRoute(
    request,
    response,
    next,
  ) {
    try {
      const source =
        typeof streamLoader === 'function'
          ? streamLoader()
          : [
            JSON.stringify(
              await fallbackLoader(),
            ),
            '\n',
          ];

      const output =
        zip
          ? createSingleFileZipStream(
            fileName,
            source,
            {
              signal:
                request.signal,
            },
          )
          : Readable.from(source);

      const downloadName =
        zip
          ? `${fileName.replace(
            /\.(?:geojson|json)$/iu,
            '',
          )}.zip`
          : fileName;

      response
        .set(
          'Cache-Control',
          'no-store',
        )
        .set(
          'Content-Disposition',
          `attachment; filename="${downloadName}"`,
        )
        .type(
          zip
            ? 'application/zip'
            : contentType,
        );

      await pipeline(
        output,
        response,
      );
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }

      next(error);
    }
  };
}
