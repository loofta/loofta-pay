const TTL_MS = 60 * 60 * 1000; // 1 hour

function cacheKey(userId: string) {
  return `mainnet_access_${userId}`;
}

export function getCachedMainnetAccess(userId: string): boolean | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    if (!raw) return null;
    const { access, ts } = JSON.parse(raw) as { access: boolean; ts: number };
    if (Date.now() - ts > TTL_MS) {
      localStorage.removeItem(cacheKey(userId));
      return null;
    }
    return access;
  } catch {
    return null;
  }
}

export function setCachedMainnetAccess(userId: string, access: boolean) {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify({ access, ts: Date.now() }));
  } catch { /* storage full or SSR */ }
}
