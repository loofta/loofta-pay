/**
 * Base API Client
 *
 * Shared fetch wrapper for all API services.
 * Sends credentials in priority order:
 *  1. Authorization: Bearer <accessToken>  ← preferred (cryptographically verified by backend)
 *  2. x-privy-user-id                      ← legacy fallback (backend verifies via Privy API)
 */

const getBackendUrl = (): string => {
  const url = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!url) {
    console.warn('[API] NEXT_PUBLIC_BACKEND_URL not set, using localhost:3001');
    return 'http://localhost:3001';
  }
  return url.replace(/\/$/, '');
};

export const BACKEND_URL = getBackendUrl();

/**
 * Base URL for a Nest call made from UI code.
 * In the browser this is a same-origin Next route, so the page can live on
 * loofta.com, pay.loofta.com, or a preview host without a CORS allowlist.
 * Server code keeps calling Railway directly.
 */
export function clientApiBase(): string {
  if (typeof window === "undefined") return getBackendUrl();
  return "/api/backend";
}

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Privy user ID — sent as x-privy-user-id (legacy). Prefer accessToken when available. */
  userId?: string;
  /** Privy access token from getAccessToken(). Sent as Authorization: Bearer when provided. */
  accessToken?: string | null;
}

/**
 * Generic fetch wrapper with error handling.
 */
export async function fetchApi<T>(
  endpoint: string,
  options: RequestInit & RequestOptions = {},
): Promise<T> {
  const { headers, signal, userId, accessToken, ...fetchOptions } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers && typeof headers === 'object' && !Array.isArray(headers)
      ? (headers as Record<string, string>)
      : {}),
  };

  // Prefer JWT bearer token; only fall back to x-privy-user-id when no token is available
  if (accessToken) {
    requestHeaders['Authorization'] = `Bearer ${accessToken}`;
  } else if (userId) {
    requestHeaders['x-privy-user-id'] = userId;
  }

  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  const url = `${clientApiBase()}${path}`;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers: requestHeaders,
      signal,
    });

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      // NestJS sends a body-less, content-type-less response for a controller returning `null`
      // (verified against the exact @nestjs/core version this backend uses — it does the same
      // for `undefined`). `{}` here used to read as a truthy "profile exists" to every caller
      // expecting `T | null`, e.g. getNestProfile — always mean "no content" for our own API.
      return null as T;
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }

    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw error;
    }
    console.error(`[API] ${options.method || 'GET'} ${endpoint} failed:`, error.message);
    throw error;
  }
}
