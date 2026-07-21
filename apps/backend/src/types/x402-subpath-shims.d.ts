/**
 * @x402/core (v2.19.0) declares its subpath exports (`./server`, `./types`, etc.) via a
 * package.json `exports` map that this project's `moduleResolution` ("node10", the default
 * paired with `module: commonjs`) cannot resolve for type-checking — Node itself resolves these
 * subpaths at runtime without any issue, since that's independent of TypeScript's setting.
 * Rather than changing the whole project's `module`/`moduleResolution` (a much bigger, riskier
 * change tightly coupled to output format) just for two subpaths, these ambient declarations
 * transcribe the real shapes from `node_modules/@x402/core/dist/cjs/{server,types}/index.d.ts`
 * for exactly what this codebase imports. Keep in sync with those files if @x402/core is
 * upgraded — a version bump won't fail the build silently if a shape actually changed, since any
 * mismatch (e.g. a renamed field) would surface as a real type error where these are used.
 */

declare module '@x402/core/types' {
  type Network = `${string}:${string}`;

  interface ResourceInfo {
    url: string;
    description?: string;
    mimeType?: string;
    serviceName?: string;
    tags?: string[];
    iconUrl?: string;
  }

  export type PaymentRequirements = {
    scheme: string;
    network: Network;
    asset: string;
    amount: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra: Record<string, unknown>;
  };

  export type PaymentRequired = {
    x402Version: number;
    error?: string;
    resource: ResourceInfo;
    accepts: PaymentRequirements[];
    extensions?: Record<string, unknown>;
  };

  export type PaymentPayload = {
    x402Version: number;
    resource?: ResourceInfo;
    accepted: PaymentRequirements;
    payload: Record<string, unknown>;
    extensions?: Record<string, unknown>;
  };

  export type VerifyResponse = {
    isValid: boolean;
    invalidReason?: string;
    invalidMessage?: string;
    payer?: string;
    extensions?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  };

  export type SettleResponse = {
    success: boolean;
    errorReason?: string;
    errorMessage?: string;
    payer?: string;
    transaction: string;
    network: Network;
    amount?: string;
    extensions?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  };
}

declare module '@x402/core/server' {
  import type { PaymentPayload, PaymentRequirements, VerifyResponse, SettleResponse } from '@x402/core/types';

  type CreateHeaders = () => Promise<{
    verify: Record<string, string>;
    settle: Record<string, string>;
    supported: Record<string, string>;
    list?: Record<string, string>;
  }>;

  export interface FacilitatorConfig {
    url: string;
    createAuthHeaders?: CreateHeaders;
  }

  export class HTTPFacilitatorClient {
    readonly url: string;
    constructor(config?: FacilitatorConfig);
    verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse>;
    settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResponse>;
  }
}
