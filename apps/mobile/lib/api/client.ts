/**
 * Base API client — same request shape as apps/frontend/src/services/api/client.ts, calling the
 * NestJS backend directly (there's no Next.js proxy layer on mobile, and React Native's fetch
 * isn't subject to browser CORS anyway, so a direct call is simpler, not riskier).
 */

const getBackendUrl = (): string => {
  const url = process.env.EXPO_PUBLIC_BACKEND_URL;
  if (!url) {
    console.warn('[API] EXPO_PUBLIC_BACKEND_URL not set, using localhost:3001');
    return 'http://localhost:3001';
  }
  return url.replace(/\/$/, '');
};

export const BACKEND_URL = getBackendUrl();

export interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Privy access token from getAccessToken(). Sent as Authorization: Bearer when provided. */
  accessToken?: string | null;
}

export async function fetchApi<T>(
  endpoint: string,
  options: RequestInit & RequestOptions = {},
): Promise<T> {
  const { headers, signal, accessToken, ...fetchOptions } = options;

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers && typeof headers === 'object' && !Array.isArray(headers) ? (headers as Record<string, string>) : {}),
  };
  if (accessToken) {
    requestHeaders['Authorization'] = `Bearer ${accessToken}`;
  }

  const url = `${BACKEND_URL}${endpoint}`;

  try {
    const response = await fetch(url, { ...fetchOptions, headers: requestHeaders, signal });

    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return {} as T;
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.message || data.error || `HTTP ${response.status}`);
    }
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') throw error;
    console.error(`[API] ${options.method || 'GET'} ${endpoint} failed:`, error.message);
    throw error;
  }
}
