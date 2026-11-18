import { api } from "@/trade/lib/api";

/** Buy USDC with Apple Pay, Google Pay or a card. The Loofta backend talks to Meld, we only pick and open. */

export interface BuyOption {
  /** Provider id. Sent back when the checkout opens, never shown. */
  id: string;
  /** APPLE_PAY, GOOGLE_PAY, CREDIT_DEBIT_CARD ... */
  method: string;
  label: string;
  eta: string;
  /** USDC received. */
  receive: number;
  /** All-in cost in dollars. */
  fee: number;
}

export const cardQuote = (amount: number, token: string | null) =>
  api<{ country: string; options: BuyOption[]; error?: string }>("/meld-onramp/quote", { body: { amount }, token });

export const cardSession = (b: { amount: number; serviceProvider: string; paymentMethodType: string; redirectUrl?: string }, token: string | null) =>
  api<{ widgetUrl: string }>("/meld-onramp/session", { body: b, token });
