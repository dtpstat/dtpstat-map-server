import compression from 'compression';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import {
  CITY_MARKER_ICON,
} from '../../public/js/city-marker-icon.js';

const CITY_MARKER_PNG =
  Buffer.from(
    CITY_MARKER_ICON.split(',')[1],
    'base64',
  );

// Keep this list aligned with Yandex Metrica's published CSP requirements.
// The collector can switch between regional mc.yandex.* endpoints, while
// Session Replay also uses mc.webvisor.* and websocket connections.
const YANDEX_METRIKA_HTTPS_ORIGINS =
  Object.freeze([
    'https://mc.yandex.ru',
    'https://mc.yandex.az',
    'https://mc.yandex.by',
    'https://mc.yandex.co.il',
    'https://mc.yandex.com',
    'https://mc.yandex.com.am',
    'https://mc.yandex.com.ge',
    'https://mc.yandex.com.tr',
    'https://mc.yandex.ee',
    'https://mc.yandex.fr',
    'https://mc.yandex.kg',
    'https://mc.yandex.kz',
    'https://mc.yandex.lt',
    'https://mc.yandex.lv',
    'https://mc.yandex.md',
    'https://mc.yandex.tj',
    'https://mc.yandex.tm',
    'https://mc.yandex.uz',
    'https://mc.webvisor.com',
    'https://mc.webvisor.org',
    'https://yastatic.net',
  ]);

const YANDEX_METRIKA_WSS_ORIGINS =
  Object.freeze([
    'wss://mc.yandex.ru',
    'wss://mc.yandex.az',
    'wss://mc.yandex.by',
    'wss://mc.yandex.co.il',
    'wss://mc.yandex.com',
    'wss://mc.yandex.com.am',
    'wss://mc.yandex.com.ge',
    'wss://mc.yandex.com.tr',
    'wss://mc.yandex.ee',
    'wss://mc.yandex.fr',
    'wss://mc.yandex.kg',
    'wss://mc.yandex.kz',
    'wss://mc.yandex.lt',
    'wss://mc.yandex.lv',
    'wss://mc.yandex.md',
    'wss://mc.yandex.tj',
    'wss://mc.yandex.tm',
    'wss://mc.yandex.uz',
    'wss://mc.webvisor.com',
    'wss://mc.webvisor.org',
  ]);

const YANDEX_METRIKA_FRAME_ANCESTORS =
  Object.freeze([
    'metrika.yandex.ru',
    'analytics.yandex.by',
    'analytics.yandex.com',
    'analytics.yandex.com.tr',
    'analytics.yandex.kz',
    'analytics.yandex.ru',
    'metr.yandex.by',
    'metr.yandex.com',
    'metr.yandex.com.tr',
    'metr.yandex.kz',
    'metr.yandex.ru',
    'metrica.ya.ru',
    'metrica.yandex',
    'metrica.yandex.by',
    'metrica.yandex.com',
    'metrica.yandex.com.tr',
    'metrica.yandex.kz',
    'metrica.yandex.ru',
    'metrika.ya.ru',
    'metrika.yandex',
    'metrika.yandex.by',
    'metrika.yandex.com',
    'metrika.yandex.com.tr',
    'metrika.yandex.kz',
    'metrika.yandex.uz',
  ]);

export function installAppHttpMiddleware(
  app,
  {
    config,
    adminAuth,
  },
) {
  const isProduction =
    config.environment ===
    'production';

  const publicDirectory =
    path.join(
      config.projectRoot,
      'public',
    );

  const adminDirectory =
    path.join(
      config.projectRoot,
      'admin',
    );

  app.disable('x-powered-by');

  app.set(
    'trust proxy',
    config.http
      ?.trustProxyHops > 0
      ? config.http
        .trustProxyHops
      : false,
  );

  app.use(
    helmet({
      crossOriginEmbedderPolicy:
        false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: [
            "'self'",
          ],
          scriptSrc: [
            "'self'",
            "'wasm-unsafe-eval'",
            ...YANDEX_METRIKA_HTTPS_ORIGINS,
            'https://*.googletagmanager.com',
          ],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
          ],
          imgSrc: [
            "'self'",
            'data:',
            'blob:',
            'https://*.mapbox.com',
            ...YANDEX_METRIKA_HTTPS_ORIGINS,
            // Current Metrica tag uses this image-only endpoint for mapuid sync.
            'https://yandex.ru',
            'https://*.google-analytics.com',
            'https://*.googletagmanager.com',
          ],
          connectSrc: [
            "'self'",
            'ws:',
            'wss:',
            'https://*.mapbox.com',
            ...YANDEX_METRIKA_HTTPS_ORIGINS,
            ...YANDEX_METRIKA_WSS_ORIGINS,
            'https://*.google-analytics.com',
            'https://*.analytics.google.com',
            'https://*.googletagmanager.com',
          ],
          workerSrc: [
            "'self'",
            'blob:',
          ],
          childSrc: [
            "'self'",
            'blob:',
            ...YANDEX_METRIKA_HTTPS_ORIGINS,
          ],
          frameSrc: [
            "'self'",
            'blob:',
            ...YANDEX_METRIKA_HTTPS_ORIGINS,
          ],
          frameAncestors: [
            "'self'",
            ...YANDEX_METRIKA_FRAME_ANCESTORS,
          ],
        },
      },
    }),
  );

  app.use(
    compression(),
  );

  app.get(
    '/images/city-marker.png',
    (
      _request,
      response,
    ) => {
      response
        .set(
          'Cache-Control',
          isProduction
            ? 'public, max-age=86400'
            : 'no-cache',
        )
        .type('image/png')
        .send(CITY_MARKER_PNG);
    },
  );

  for (
    const route of [
      '/admin',
      '/admin/',
      '/admin/index.html',
    ]
  ) {
    app.get(
      route,
      adminAuth
        .requireAdminEntry,
      (
        _request,
        response,
      ) => {
        response.set(
          'Cache-Control',
          'no-store',
        );

        response.sendFile(
          'index.html',
          {
            root:
              adminDirectory,
          },
        );
      },
    );
  }

  app.use(
    '/admin',
    express.static(
      adminDirectory,
      {
        index: false,
        maxAge:
          isProduction
            ? '5m'
            : 0,
      },
    ),
  );

  app.use(
    '/vendor/mapbox-gl',
    express.static(
      path.join(
        config.projectRoot,
        'node_modules/mapbox-gl/dist',
      ),
      {
        immutable:
          isProduction,
        maxAge:
          isProduction
            ? '30d'
            : 0,
      },
    ),
  );

  app.use(
    express.static(
      publicDirectory,
      {
        index: false,
        maxAge:
          isProduction
            ? '1h'
            : 0,
      },
    ),
  );
}
