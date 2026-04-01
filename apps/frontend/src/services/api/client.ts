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

  const url = `${BACKEND_URL}${endpoint}`;

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
      return {} as T;
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
