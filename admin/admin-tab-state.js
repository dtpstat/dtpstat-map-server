const PREFIX = 'dtpstat.admin.tab.';

export function readTabState(key, allowed, fallback) {
  try {
    const value = sessionStorage.getItem(`${PREFIX}${key}`);
    return allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeTabState(key, value) {
  try {
    sessionStorage.setItem(`${PREFIX}${key}`, String(value));
  } catch {
    // sessionStorage may be unavailable in hardened/private contexts.
  }
}
