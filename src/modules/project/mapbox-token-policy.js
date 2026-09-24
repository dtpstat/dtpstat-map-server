export class MapboxAccessTokenValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MapboxAccessTokenValidationError';
  }
}

export function normalizeMapboxAccessToken(value, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new MapboxAccessTokenValidationError('Mapbox access token is required');
  }
  if (typeof value !== 'string') {
    throw new MapboxAccessTokenValidationError('Mapbox access token must be a string');
  }
  const token = value.trim();
  if (
    token.length < 20 ||
    token.length > 2048 ||
    !token.startsWith('pk.') ||
    /\s|[\u0000-\u001f\u007f]/.test(token) ||
    !/^pk\.[A-Za-z0-9._-]+$/.test(token)
  ) {
    throw new MapboxAccessTokenValidationError(
      'Mapbox access token must be a public pk.* token without whitespace',
    );
  }
  return token;
}
