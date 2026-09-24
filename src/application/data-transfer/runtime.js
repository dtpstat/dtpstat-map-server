import {
  createStreamingExportRoute,
} from './export-http-runtime.js';
import {
  createPortableImportRuntime,
} from './import-runtime.js';

export {
  createStreamingExportRoute,
  createPortableImportRuntime,
};

/**
 * Compatibility composition surface. Production wiring uses the focused
 * export/import runtimes directly.
 */
export function createDataTransferRuntime({
  importApi,
  progressLog,
}) {
  return {
    ...createPortableImportRuntime({
      importApi,
      progressLog,
    }),
    streamingExportRoute:
      createStreamingExportRoute,
  };
}
