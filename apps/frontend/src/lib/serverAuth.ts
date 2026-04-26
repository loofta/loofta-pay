/**
 * Server-side auth utilities for Next.js API routes.
 * Verifies identity by proxying to the NestJS backend (/users/me),
 * which calls Privy's API to validate the token — never trusts headers blindly.
 */

const backendUrl = () =>
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

/**
 * Returns the verified Privy user ID for the incoming request, or null.
 *
 * Tries in order:
 *  1. Authorization: Bearer <privy-jwt>  — verified by NestJS via Privy API
 *  2. x-privy-user-id header (legacy)    — also verified by NestJS via Privy API
 */
export async function getVerifiedUserId(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization");

  if (authHeader?.startsWith("Bearer ")) {
    try {
      const res = await fetch(`${backendUrl()}/users/me`, {
        headers: { authorization: authHeader },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.userId) return data.userId;
      }
    } catch (e) {
      console.warn("[serverAuth] Bearer verify failed:", e);
    }
    // If Bearer is present but invalid, don't fall through to legacy header
    return null;
  }

  const legacyId = request.headers.get("x-privy-user-id");
  if (legacyId) {
    try {
      const res = await fetch(`${backendUrl()}/users/me`, {
        headers: { "x-privy-user-id": legacyId },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.userId) return data.userId;
      }
    } catch (e) {
      console.warn("[serverAuth] Legacy ID verify failed:", e);
    }
    return null;
  }

  return null;
}
