export enum GiveawaySelectionMode {
  RANDOM = 'random',
  FIRST_COME = 'first_come',
  MANUAL = 'manual',
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
  // No public X API endpoint exposes "who bookmarked this tweet" (bookmarks are private to each
  // user) — unlike retweet/like/follow, this can never move to auto_api. Always self-report.
  X_BOOKMARK = 'x_bookmark',
  TELEGRAM_JOIN = 'telegram_join',
  DISCORD_JOIN = 'discord_join',
  // Covers "join a waitlist", "create an account", or any other single-URL action — the
  // free-text `instructions` in config says what to actually do there.
  VISIT_LINK = 'visit_link',
  // Free-form task with no fixed target/verification shape at all — creator writes the whole
  // thing in config.instructions, entrant self-reports, always reviewed manually.
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
  [GiveawayTaskType.X_LIKE]: GiveawayTaskVerificationMode.AUTO_API,
  [GiveawayTaskType.X_COMMENT]: GiveawayTaskVerificationMode.AUTO_API,
  [GiveawayTaskType.X_BOOKMARK]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.TELEGRAM_JOIN]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.DISCORD_JOIN]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.VISIT_LINK]: GiveawayTaskVerificationMode.SELF_REPORT,
  [GiveawayTaskType.CUSTOM]: GiveawayTaskVerificationMode.SELF_REPORT,
};

export interface GiveawayEligibility {
  min_followers?: number;
  min_account_age_days?: number;
}

export interface Giveaway {
  id: string;
  created_at: string;
  updated_at: string;
  created_by: string;

  title: string;
  description: string | null;
  logo_url: string | null;

  winner_count: number;
  selection_mode: GiveawaySelectionMode;
  prize_amount_usd: string;
  entries_close_at: string;

  eligibility: GiveawayEligibility;

  burner_address: string | null;
  burner_encrypted_secret: string | null;
  mint: string | null;
  is_devnet: boolean;
  funding_required_usd: string | null;
  funding_confirmed_usd: string;
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

  status: GiveawayStatus;
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
  eligibility_snapshot: GiveawayEntryEligibilitySnapshot;
  status: GiveawayEntryStatus;
  payout_choice: 'public' | 'private' | null;
  payout_destination: string | null;
  payout_status: 'not_applicable' | 'pending' | 'in_progress' | 'succeeded' | 'failed' | null;
  payout_tx_hash: string | null;
  payout_amount_usd: string | null;
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
