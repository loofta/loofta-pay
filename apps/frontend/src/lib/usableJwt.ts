/**
 * Returns the token only if it is still valid. An expired Near Intents (1Click) JWT makes the API answer
 * "Invalid or expired token" to every call, which broke deposits in production while localhost (no token set)
 * kept working. Dropping an expired token makes the call go out unauthenticated instead, which still works.
 * A token that cannot be decoded is passed through untouched, so we never hide a valid opaque key.
 */
export function usableJwt(token: string | undefined | null): string | undefined {
  const value = token?.trim();
  if (!value) return undefined;
  const parts = value.split(".");
  if (parts.length !== 3) return value;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("utf8");
    const exp = Number(JSON.parse(json)?.exp);
    if (Number.isFinite(exp) && exp * 1000 <= Date.now()) {
      console.warn("[1click] JWT expired, calling without it. Rotate ONECLICK_JWT / NEXT_PUBLIC_ONECLICK_JWT.");
      return undefined;
    }
  } catch {
    /* not decodable: keep it */
  }
  return value;
}
