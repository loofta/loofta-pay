/**
 * A guest sender has no Loofta account, so there's nothing server-side to tie a claim back to
 * "the person who sent it" once they navigate away — this is the only record of that on their own
 * device. Used to recognize "this is a link I sent" on a later visit (e.g. after paying, or
 * coming back to check status) without requiring sign-in. Capped and deliberately not shared with
 * the backend — purely a local convenience, never a security boundary.
 */
const STORAGE_KEY = "loofta_guest_sent_claims";
const MAX_ENTRIES = 50;

function readAll(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function markGuestSentClaim(claimId: string): void {
  try {
    const existing = readAll().filter((id) => id !== claimId);
    const next = [claimId, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort only (private browsing, storage disabled, quota, ...) — never block the send.
  }
}

export function isGuestSentClaim(claimId: string): boolean {
  try {
    return readAll().includes(claimId);
  } catch {
    return false;
  }
}
