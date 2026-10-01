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


export function isLoopbackClientIp(value) {
  const normalized =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : '';

  if (!normalized) {
    return false;
  }

  if (normalized === '::1') {
    return true;
  }

  const ipv4 =
    normalized.startsWith('::ffff:')
      ? normalized.slice(7)
      : normalized;

  return /^127(?:\.\d{1,3}){3}$/u
    .test(ipv4);
}
