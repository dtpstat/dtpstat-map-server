/**
 * Resolve the client IP from an Express request or a raw HTTP request.
 * Express request.ip is preferred so configured trust-proxy semantics remain
 * authoritative; socket.remoteAddress is the fallback for raw upgrades.
 *
 * @param {import('express').Request | import('node:http').IncomingMessage} request
 */
export function requestClientIp(request) {
  const expressIp =
    'ip' in request &&
    typeof request.ip === 'string'
      ? request.ip
      : null;

  const socketIp =
    request.socket?.remoteAddress ?? null;

  const value =
    (expressIp || socketIp || '').trim();

  if (!value) return null;

  return (
    value.startsWith('::ffff:')
      ? value.slice(7)
      : value
  ).slice(0, 128);
}
