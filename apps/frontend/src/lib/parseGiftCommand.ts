/**
 * Free-text "gift 5 tickets to @alice on X" parser for the terminal chat's ticket-gifting path —
 * kept separate from parseAgentCommand.ts since the quantity unit (a ticket count, not a $amount)
 * and the resulting action (POST /lottery/buy-gift, not a claim) are different enough that
 * merging them would tangle two unrelated regex grammars. Reuses parseAgentCommand's
 * recipient/platform extraction so both commands resolve "@alice on X" identically.
 */

import {
  type AgentRecipientPlatform,
  detectPlatformKeyword,
  stripToRecipientPart,
  looksLikeHandle,
  looksLikeEmail,
  FILLER_TOKENS,
} from "./parseAgentCommand";

export interface ParsedGiftRecipient {
  raw: string;
  platform: AgentRecipientPlatform;
  identifier: string;
}

export interface ParsedGiftCommand {
  numTickets: number;
  recipient: ParsedGiftRecipient;
  isPrivate: boolean;
  error?: string;
}

export const MIN_GIFT_TICKETS = 1;
export const MAX_GIFT_TICKETS = 100;

const TICKET_COUNT_RE = /\b(\d{1,3})\s*(?:megapot\s+)?(?:lottery\s+)?tickets?\b/i;

/**
 * Returns null (not an error) when the text has no "N ticket(s)" shape at all — that means it's
 * not a gift command, so the caller should fall through to parseAgentCommand unchanged. Once the
 * ticket-count pattern is found, this always returns a result object; genuine problems (bad
 * count, no recipient) come back as `.error` rather than null, so the caller can tell "not a gift
 * command" apart from "a gift command with a mistake in it".
 */
export function parseGiftCommand(input: string): ParsedGiftCommand | null {
  const text = input.trim();
  const countMatch = text.match(TICKET_COUNT_RE);
  if (!countMatch) return null;

  const isPrivate = /\bprivate(ly)?\b/i.test(text);
  const numTickets = parseInt(countMatch[1], 10);
  const platform = detectPlatformKeyword(text);

  // Strip the "N ticket(s)" phrase and the gift-specific leading verb ("gift"/"give" — stripToRecipientPart
  // only recognizes "send"/"pay") BEFORE calling stripToRecipientPart — its own internal "strip
  // leading to" step only fires when the verb is already gone and "to" is at the very start.
  const withoutTicketCount = text.replace(TICKET_COUNT_RE, "").replace(/^\s*(gift|give)\b/i, "");
  const recipientPart = stripToRecipientPart(withoutTicketCount).trim();

  const rawRecipients = recipientPart
    .split(/,|;|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !FILLER_TOKENS.has(s.toLowerCase()))
    .filter(looksLikeHandle);

  if (rawRecipients.length === 0) {
    return {
      numTickets,
      recipient: { raw: "", platform: "username", identifier: "" },
      isPrivate,
      error: 'I couldn\'t find a recipient. Try "gift 5 tickets to @alice on X".',
    };
  }

  // Single recipient only for v1 — an extra token is silently dropped, same permissiveness
  // parseAgentCommand already applies to stray trailing words.
  const rawToken = rawRecipients[0];
  const cleaned = rawToken.replace(/^@/, "").trim();
  let recipientPlatform: AgentRecipientPlatform = platform ?? "username";
  if (!platform && looksLikeEmail(cleaned)) recipientPlatform = "email";
  const recipient: ParsedGiftRecipient = { raw: rawToken, platform: recipientPlatform, identifier: cleaned.toLowerCase() };

  if (numTickets < MIN_GIFT_TICKETS || numTickets > MAX_GIFT_TICKETS) {
    return {
      numTickets,
      recipient,
      isPrivate,
      error: `I can gift between ${MIN_GIFT_TICKETS} and ${MAX_GIFT_TICKETS} tickets at once — you asked for ${numTickets}.`,
    };
  }

  return { numTickets, recipient, isPrivate };
}
