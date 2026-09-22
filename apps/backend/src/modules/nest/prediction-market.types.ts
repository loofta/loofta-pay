/**
 * One shape for a prediction market regardless of where it lives, so the product can present a
 * single Yes/No affordance and swap what's behind it without touching the UI.
 *
 * The venues differ in one way that actually matters to a user, and it's captured here as
 * `tradeable`:
 *
 *  - Kalshi (live today) is a CFTC-regulated exchange. An order needs the user's own KYC'd,
 *    funded account signed with their own credentials, so a third party can only ever link out.
 *    `tradeable: false`.
 *  - DFlow (not built yet) tokenizes Kalshi's markets as SPL tokens on Solana. Because the
 *    position is just a token, a user can hold and trade it from the embedded Solana wallet they
 *    already have — no second account, no KYC handoff, no bridge. That's `tradeable: true`, and
 *    it's the reason this abstraction exists rather than the UI hardcoding Kalshi.
 *
 * Adding a venue means implementing PredictionMarketProvider and registering it. The UI renders
 * from PredictionMarket alone and decides "in-app order sheet" vs "open on the venue" purely from
 * `tradeable` — it never learns which venue it's drawing.
 */
export interface PredictionMarket {
  /** Venue-qualified so ids from different venues can never collide, e.g. "kalshi:KXMETA-26". */
  id: string;
  venue: PredictionVenue;
  /** The xStock symbol this market relates to, when it was found via a holding. */
  symbol: string | null;
  question: string;
  /** Probability the market assigns to Yes, 0-1. The venue's own live pricing, never our view. */
  yesPrice: number | null;
  closeTime: string | null;
  /** Whether a user can take a position from inside this app, or must go to the venue to do it. */
  tradeable: boolean;
  /** Where to send someone to trade it themselves — always present, including for tradeable
   *  venues, as the fallback when an in-app order can't be built. */
  url: string;
}

export type PredictionVenue = 'kalshi' | 'dflow' | 'polymarket';

export interface PredictionMarketProvider {
  readonly venue: PredictionVenue;
  /** Whether this venue supports taking a position without leaving the app. */
  readonly tradeable: boolean;
  /** Live markets relating to one company. Must never throw — an empty array means "nothing
   *  relevant", so one unavailable venue degrades to silence instead of breaking the section. */
  listForCompany(companyName: string, underlyingSymbol: string): Promise<PredictionMarket[]>;
}
