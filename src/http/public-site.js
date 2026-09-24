import {
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  publicDownloadFiles,
} from '../data/public-download-name.js';
import {
  projectManifest,
  renderProjectPage,
} from './project-page.js';

const PUBLIC_ASSETS = new Map([
  [
    '/favicon.ico',
    'favicon.ico',
  ],
  [
    '/favicon-16x16.png',
    'favicon-16x16.png',
  ],
  [
    '/favicon-32x32.png',
    'favicon-32x32.png',
  ],
  [
    '/apple-touch-icon.png',
    'apple-touch-icon.png',
  ],
  [
    '/android-chrome-192x192.png',
    'android-chrome-192x192.png',
  ],
  [
    '/android-chrome-512x512.png',
    'android-chrome-512x512.png',
  ],
]);

export function installPublicSiteRoutes(
  app,
  {
    config,
    projectSettingsRepository,
  },
) {
  const publicDownloadDirectory =
    path.join(
      config.projectRoot,
      'var',
      'public-downloads',
    );

  const publicPageTemplate =
    readFileSync(
      path.join(
        config.projectRoot,
        'index.html',
      ),
      'utf8',
    );

  for (
    const [
      route,
      fileName,
    ] of PUBLIC_ASSETS
  ) {
    app.get(
      route,
      (
        _request,
        response,
      ) => {
        response.sendFile(
          fileName,
          {
            root:
              config.projectRoot,
          },
        );
      },
    );
  }

  app.get(
    '/:publicDownloadFile',
    async (
      request,
      response,
      next,
    ) => {
      const requestedFile =
        request.params
          .publicDownloadFile;

      if (
        !/\.(?:csv|geojson)$/i
          .test(requestedFile)
      ) {
        next();
        return;
      }

      try {
        const settings =
          await projectSettingsRepository
            .get();

        const files =
          publicDownloadFiles(
            settings
              .publicDownloadName,
          );

        const contentTypes =
          new Map([
            [
              files.csvFileName,
              'text/csv; charset=utf-8',
            ],
            [
              files.geoJsonFileName,
              'application/geo+json; charset=utf-8',
            ],
          ]);

        const contentType =
          contentTypes.get(
            requestedFile,
          );

        if (!contentType) {
          next();
          return;
        }

        response
          .set(
            'Cache-Control',
            'no-cache',
          )
          .type(contentType)
          .attachment(
            requestedFile,
          );

        response.sendFile(
          requestedFile,
          {
            root:
              publicDownloadDirectory,
          },
          (error) => {
            if (!error) return;

            if (
              error.status ===
                404 ||
              error.code ===
                'ENOENT'
            ) {
              response
                .status(404)
                .type('text')
                .send('Not found');

              return;
            }

            next(error);
          },
        );
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/site.webmanifest',
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const settings =
          await projectSettingsRepository
            .get();

        response
          .set(
            'Cache-Control',
            'no-cache',
          )
          .type(
            'application/manifest+json',
          )
          .send(
            JSON.stringify(
              projectManifest(
                settings,
              ),
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    '/',
    async (
      _request,
      response,
      next,
    ) => {
      try {
        const settings =
          await projectSettingsRepository
            .get();

        response
          .set(
            'Cache-Control',
            'no-cache',
          )
          .type('html')
          .send(
            renderProjectPage(
              publicPageTemplate,
              settings,
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );
}
