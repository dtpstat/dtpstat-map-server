import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';

/**
 * @param {import('node:http').Server} server
 * @param {{ host: string, port: number, protocol: string }} endpoint
 */
function listen(server, endpoint) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint.port, endpoint.host, () => {
      server.off('error', reject);
      console.log(
        `${endpoint.protocol} server listening on ${endpoint.host}:${endpoint.port}`,
      );
      resolve(server);
    });
  });
}

/**
 * Start every protocol enabled in configuration.
 *
 * @param {{ app: import('express').Express, config: any, webSocketGateway?: { attach: Function } }} dependencies
 * @returns {Promise<import('node:http').Server[]>}
 */
export async function startServers({ app, config, webSocketGateway }) {
  /** @type {Array<{ server: import('node:http').Server, host: string, port: number, protocol: string }>} */
  const endpoints = [];

  if (config.http.enabled) {
    endpoints.push({
      server: http.createServer(app),
      host: config.host,
      port: config.http.port,
      protocol: 'HTTP',
    });
  }

  if (config.https.enabled) {
    const [key, cert] = await Promise.all([
      fs.readFile(config.https.keyPath),
      fs.readFile(config.https.certPath),
    ]);
    endpoints.push({
      server: https.createServer({ key, cert }, app),
      host: config.host,
      port: config.https.port,
      protocol: 'HTTPS',
    });
  }

  for (const endpoint of endpoints) {
    webSocketGateway?.attach(endpoint.server);
  }

  const servers = [];
  try {
    for (const endpoint of endpoints) {
      servers.push(await listen(endpoint.server, endpoint));
    }
    return servers;
  } catch (error) {
    await Promise.allSettled(servers.map((server) => closeServer(server)));
    throw error;
  }
}

/** @param {import('node:http').Server} server */
export function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
