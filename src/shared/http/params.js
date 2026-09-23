export function parseCoordinates(value, count) {
  if (typeof value !== 'string') return null;
  const parts = value.split(',');
  if (
    parts.length !== count ||
    parts.some((part) => part.trim() === '')
  ) {
    return null;
  }
  const coordinates = parts.map((part) => Number(part));
  return coordinates.every(Number.isFinite) ? coordinates : null;
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return null;
}
