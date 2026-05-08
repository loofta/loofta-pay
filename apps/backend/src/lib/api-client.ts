/**
 * API Client for frontend to use with NestJS backend
 * 
 * This client provides type-safe access to all backend endpoints.
 * Import types from @/types/database.types for full type safety.
 */

type RequestOptions = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string, userId?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultHeaders = {
      'Content-Type': 'application/json',
    };
    if (userId) {
      this.defaultHeaders['x-privy-user-id'] = userId;
    }
  }

  setUserId(userId: string): void {
    this.defaultHeaders['x-privy-user-id'] = userId;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = { ...this.defaultHeaders, ...options?.headers };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: options?.signal,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new ApiError(response.status, error.message || 'Request failed', error.code);
    }

    return response.json();
  }

  // Health
  async health() {
    return this.request<{
      status: string;
      timestamp: string;
      version: string;
      services: { database: string; redis: string };
    }>('GET', '/health');
  }

  // Organizations
  organizations = {
    list: () =>
      this.request<{ organizations: any[] }>('GET', '/organizations'),

    get: (id: string) =>
      this.request<{ organization: any }>('GET', `/organizations/${id}`),

    getPublic: (referralCode: string) =>
      this.request<{ name: string; logo_url: string | null; bg_color: string | null }>(
        'GET',
        `/organizations/public/by-referral?code=${encodeURIComponent(referralCode)}`,
      ),

    create: (data: any) =>
      this.request<{ organization: any }>('POST', '/organizations', data),

    update: (data: any) =>
      this.request<{ organization: any }>('PUT', '/organizations', data),

    delete: (id: string) =>
      this.request<{ success: boolean }>('DELETE', `/organizations?id=${id}`),
  };

  // Claims
  claims = {
    create: (data: {
      amount: number;
      toSel: { symbol: string; chain: string };
      recipient: string;
      userId?: string;
      userEmail?: string;
    }) =>
      this.request<{ id: string; link: string }>('POST', '/claims/create', data),

    get: (id: string) =>
      this.request<{ claim: any }>('GET', `/claims/${id}`),

    getWithIntent: (id: string) =>
      this.request<{ claim: any; intent: any | null }>('GET', `/claims/${id}/latest-intent`),

    requestDeposit: (data: {
      claimId: string;
      fromToken: {
        tokenId: string;
        symbol: string;
        chain: string;
        decimals: number;
      };
      amount: string;
      userAddress?: string;
      orgReferral?: string;
    }) =>
      this.request<{
        depositAddress?: string;
        memo?: string | null;
        deadline?: string;
        timeEstimate?: number;
        quoteId?: string;
        minAmountInFormatted?: string;
        directTransfer?: boolean;
      }>('POST', '/claims/deposit', data),
  };

  // Tokens
  tokens = {
    list: () =>
      this.request<{ tokens: any[] }>('GET', '/tokens'),

    search: (query: string) =>
      this.request<{ tokens: any[] }>('GET', `/tokens/search?q=${encodeURIComponent(query)}`),

    byChain: (chain: string) =>
      this.request<{ tokens: any[] }>('GET', `/tokens/by-chain?chain=${encodeURIComponent(chain)}`),

    popular: () =>
      this.request<{ tokens: any[] }>('GET', '/tokens/popular'),

    stablecoins: () =>
      this.request<{ tokens: any[] }>('GET', '/tokens/stablecoins'),

    price: (symbol: string, chain: string) =>
      this.request<{ price: number | null }>(
        'GET',
        `/tokens/price?symbol=${encodeURIComponent(symbol)}&chain=${encodeURIComponent(chain)}`,
      ),
  };

  // Intents
  intents = {
    quote: (data: {
      fromTokenId: string;
      fromChain: string;
      fromDecimals: number;
      toTokenId: string;
      toChain: string;
      toDecimals: number;
      amount: string;
      slippageBps?: number;
    }) =>
      this.request<{
        amountOut?: string;
        error?: { type: string; message?: string };
      }>('POST', '/intents/quote', data),

    status: (params: {
      depositAddress?: string;
    }) => {
      const searchParams = new URLSearchParams();
      if (params.depositAddress) searchParams.set('depositAddress', params.depositAddress);
      return this.request<{
        provider: string;
        status: string;
        normalizedStatus: string;
        txHash?: string;
      }>('GET', `/intents/status?${searchParams.toString()}`);
    },
  };

  // Cron (admin only)
  cron = {
    status: () =>
      this.request<{ isProcessing: boolean }>('GET', '/cron/status'),

    process: (cronSecret?: string) => {
      const headers: Record<string, string> = {};
      if (cronSecret) headers['Authorization'] = `Bearer ${cronSecret}`;
      return this.request<{ success: boolean; processed: number; results: any[] }>(
        'GET',
        '/cron/process-claims',
        undefined,
        { headers },
      );
    },
  };
}

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Factory function
export function createApiClient(baseUrl: string, userId?: string): ApiClient {
  return new ApiClient(baseUrl, userId);
}

export { ApiClient, ApiError };
