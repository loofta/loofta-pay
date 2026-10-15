export enum GiveawaySelectionMode {
  RANDOM = 'random',
  FIRST_COME = 'first_come',
  MANUAL = 'manual',
}

export enum GiveawayType {
  STANDARD = 'standard',
  /** Quick X giveaway: qualifying public posts are found by search, nobody clicks Enter. */
  QUICK_POST = 'quick_post',
}

export interface QuickCriteria {
  /** Handles (no @) every qualifying post must tag. */
  required_mentions: string[];
  /** Hashtags (no #) every qualifying post must contain. */
  required_hashtags: string[];
  /** Optional free text the post must contain (case-insensitive). */
  required_text?: string;
  /** Post must carry an image or video ("post a meme"). */
  require_media?: boolean;
  /** The creator's announcement post, shown on the page. */
  announcement_url?: string;
  /** Only posts at or after this time count. ISO 8601. */
  start_at: string;
}

export enum GiveawayRewardType {
  USDC = 'usdc',
  MEGAPOT_TICKET = 'megapot_ticket',
}

export enum GiveawayStatus {
  DRAFT = 'DRAFT',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  REJECTED = 'REJECTED',
  PENDING_FUNDING = 'PENDING_FUNDING',
  FUNDED = 'FUNDED',
  OPEN = 'OPEN',
  ENTRIES_CLOSED = 'ENTRIES_CLOSED',
  DRAWING = 'DRAWING',
  WINNERS_SELECTED = 'WINNERS_SELECTED',
  PAYOUT_IN_PROGRESS = 'PAYOUT_IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  UNDERFUNDED_EXPIRED = 'UNDERFUNDED_EXPIRED',
  REFUNDED = 'REFUNDED',
}

export enum GiveawayTaskType {
  X_FOLLOW = 'x_follow',
  X_RETWEET = 'x_retweet',
  X_LIKE = 'x_like',
  X_COMMENT = 'x_comment',
  // A brand-new original post (not a reply/retweet/quote of an existing tweet) containing exact
  // required text — config.required_text is also used to build a pre-filled x.com/intent/tweet
  // link so the entrant doesn't have to type anything. Unlike x_retweet/x_comment (which check
  // against a target tweet the creator supplies), this has no target tweet to check — it's
  // verified via Sorsa's /search-tweets (`from:{handle}`, latest order) against the entrant's own
  // recent posts instead. See XVerificationService.checkPostedExactly.
  X_POST = 'x_post',
  // No public X API endpoint exposes "who bookmarked this tweet" (bookmarks are private to each
  // user) — unlike retweet/like/follow, this can never move to auto_api. Always self-report.
  X_BOOKMARK = 'x_bookmark',
  TELEGRAM_JOIN = 'telegram_join',
  DISCORD_JOIN = 'discord_join',
  // Covers "join a waitlist", "create an account", or any other single-URL action — the
  // free-text `instructions` in config says what to actually do there.
  VISIT_LINK = 'visit_link',
  // Free-form task — creator gives it a config.title (e.g. "Join the stream") and an optional
  // config.target link, entrant self-reports, always reviewed manually. Legacy rows created
  // before `title` existed only have config.target as a free-text description.
  CUSTOM = 'custom',
}

export enum GiveawayTaskVerificationMode {
  AUTO_API = 'auto_api',
  SELF_REPORT = 'self_report',
}

/** Fixed per-task-type default — creators never choose this, since it's what makes the
 *  eligibility promise (real X verification) actually hold. See plan §Task verification. */
export const GIVEAWAY_TASK_VERIFICATION_MODE: Record<GiveawayTaskType, GiveawayTaskVerificationMode> = {
  [GiveawayTaskType.X_FOLLOW]: GiveawayTaskVerificationMode.AUTO_API,
  [GiveawayTaskType.X_RETWEET]: GiveawayTaskVerificationMode.AUTO_API,
  // Confirmed via live test (2026-08-05): X's "liking_users" lookup returns an empty list
  // regardless of who actually liked the tweet — a tier/access gap on this specific endpoint
  // (tweetRetweetedBy on the same tweet correctly returned real users). Auto-verifying against an
  // endpoint that always comes back empty means every genuine like gets rejected, so this falls
  // back to self-report/human review until that access gap is resolved. Revert to AUTO_API once
  // fixed on the X Developer Portal side.
  [GiveawayTaskType.X_LIKE]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.X_COMMENT]: GiveawayTaskVerificationMode.AUTO_API,
  [GiveawayTaskType.X_BOOKMARK]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.X_POST]: GiveawayTaskVerificationMode.AUTO_API,
  [GiveawayTaskType.TELEGRAM_JOIN]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.DISCORD_JOIN]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.VISIT_LINK]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.CUSTOM]: GiveawayTaskVerificationMode.SELF_REPORT,
};

export interface GiveawayEligibility {
  min_followers?: number;
  min_account_age_days?: number;
  verified_only?: boolean;
  /** Entrant's X account country (per Sorsa's /about endpoint) must be one of these, OR its
   *  continent must be in required_continents — the two lists are OR'd together, not AND'd. */
  required_countries?: string[];
  /** Entrant's X account country must fall in one of these continents — see required_countries. */
  required_continents?: string[];
  /** Entrant's X account country must NOT be one of these — checked after required_countries/
   *  required_continents, so a country can be excluded even if its continent would otherwise
   *  qualify. Not shown to entrants anywhere (pre- or post-entry) — see GiveawayEntriesService.enter. */
  excluded_countries?: string[];
}

export interface Giveaway {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string;

  title: string;
  description: string | null;
  logo_url: string | null;
  project_name: string | null;
  short_id: string | null;

  winner_count: number;
  selection_mode: GiveawaySelectionMode;
  prize_amount_usd: string;
  /** 'usdc' (default): each winner gets a normal /c/[id] claim link. 'megapot_ticket': prize_amount_usd
   *  (must be a whole dollar amount, TICKET_PRICE_USDC = 1) is gifted as that many Megapot tickets
   *  instead — see GiveawayPayoutService.processGiveaway. */
  reward_type: GiveawayRewardType;
  /** SPL mint winners are paid in. Null means the prize is USDC (or Megapot tickets). The creator
   *  can send this token straight to the burner and the platform fee in USDC to Loofta, in one
   *  transaction. Funding in USDC still works and is swapped into this mint. */
  prize_mint: string | null;
  prize_token_symbol: string | null;
  prize_token_name: string | null;
  prize_token_logo: string | null;
  prize_token_decimals: number | null;
  prize_token_program: string | null;
  /** Total output of the funding swap, in base units. Split evenly across winners at payout. */
  prize_token_base_units: string | null;
  prize_swap_tx: string | null;
  entries_close_at: string;

  eligibility: GiveawayEligibility;

  burner_address: string | null;
  burner_encrypted_secret: string | null;
  mint: string | null;
  is_devnet: boolean;
  funding_required_usd: string | null;
  funding_confirmed_usd: string;
  /** Flat platform fee for posting this giveaway, snapshotted at creation — 0 for an official ("create as Loofta") giveaway. Lands in the Solana fee payer's own wallet at completion. */
  platform_fee_usd: string;
  burner_reclaimed_at: string | null;

  vrf_request_slot: number | null;
  vrf_randomness: string | null;
  vrf_requested_at: string | null;
  vrf_fulfilled_at: string | null;
  entry_snapshot_hash: string | null;

  admin_reviewed_by: string | null;
  admin_reviewed_at: string | null;
  rejection_reason: string | null;
  cancel_reason: string | null;

  /** True for an admin-created "Loofta official" giveaway — auto-approved, shown with the Loofta brand, pinned to the top of public listings. */
  is_official: boolean;

  giveaway_type: GiveawayType;
  quick_criteria: QuickCriteria | null;
  quick_last_synced_at: string | null;
  /** Quick giveaways: draw from every qualifying post or only the creator's shortlist. */
  quick_draw_pool: 'all' | 'shortlist';
  quick_duration_hours: number | null;
  quick_window_started_at: string | null;

  status: GiveawayStatus;

  /** Password-protected public review link — see GiveawaysService.generateReviewLink. Null until a creator generates one; regenerating overwrites all three. */
  review_link_token: string | null;
  review_link_password_hash: string | null;
  review_link_created_at: string | null;
}

export enum GiveawayEntryStatus {
  ENTERED = 'entered',
  DISQUALIFIED = 'disqualified',
  WINNER = 'winner',
  NOT_SELECTED = 'not_selected',
}

export interface GiveawayEntryEligibilitySnapshot {
  followers_count: number;
  account_created_at: string;
}

export interface GiveawayEntry {
  id: string;
  giveaway_id: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  entered_at: string;
  entry_index: number;
  x_user_id: string;
  x_handle: string;
  avatar_url: string | null;
  eligibility_snapshot: GiveawayEntryEligibilitySnapshot;
  status: GiveawayEntryStatus;
  payout_choice: 'public' | 'private' | null;
  payout_destination: string | null;
  payout_status: 'not_applicable' | 'pending' | 'in_progress' | 'succeeded' | 'failed' | null;
  payout_tx_hash: string | null;
  payout_amount_usd: string | null;
  /** payments.id for this winner's claim link (/c/[id]) once their prize has been delivered as a claimable payment. Null for megapot_ticket giveaways — see claim_gift_id. */
  claim_payment_id: string | null;
  /** lottery_gifts.id once a megapot_ticket giveaway's prize has been gifted as tickets — already 'claimed', winner goes straight to /gift/[shortId]. Null for usdc giveaways. */
  claim_gift_id: string | null;
  /** Quick X giveaways only: the qualifying post this entry was built from. */
  post_id: string | null;
  post_url: string | null;
  post_text: string | null;
  post_created_at: string | null;
  post_media: Array<{ type: string; preview?: string; link?: string }> | null;
  /** Quick giveaways: starred by the creator, public. */
  shortlisted: boolean;
}

export enum GiveawayTaskCompletionStatus {
  PENDING = 'pending',
  AUTO_VERIFIED = 'auto_verified',
  VERIFIED = 'verified',
  REJECTED = 'rejected',
  API_ERROR = 'api_error',
}

export interface GiveawayTaskCompletion {
  id: string;
  giveaway_entry_id: string;
  giveaway_task_id: string;
  created_at: string;
  updated_at: string;
  submission_data: Record<string, unknown> | null;
  verification_status: GiveawayTaskCompletionStatus;
  verification_detail: Record<string, unknown> | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  // When the entrant actually submitted/attempted this task — distinct from updated_at, which
  // also moves on a later human review. Null for rows created before this column existed.
  submitted_at: string | null;
}

export interface GiveawayTask {
  id: string;
  giveaway_id: string;
  created_at: string;
  updated_at: string;
  order_index: number;
  task_type: GiveawayTaskType;
  config: Record<string, unknown>;
  verification_mode: GiveawayTaskVerificationMode;
}
