import type { InlineKeyboard, ReplyKeyboard } from './telegram-api';
import { TELEGRAM_HANDLE_RE } from './telegram-parser';

/** The guided /send flow: pick someone, then tap an amount. Private is on unless turned off. */
export const SEND_AMOUNTS = [5, 10, 50, 100, 200];
export const SEND_REQUEST_ID = 1;

export interface SendDraft {
  handle?: string;
  isPrivate: boolean;
  awaiting: 'recipient' | 'amount';
  /** Wallet balance in USD, fetched once when the flow starts so every card can show it. */
  balanceUsd?: number | null;
  expires: number;
}

/** The last few different people this person paid, newest first. */
export function distinctRecents(rows: Array<{ recipient_handle: string }>, limit = 4, exclude?: string): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const h = r.recipient_handle?.toLowerCase();
    if (h && h !== exclude?.toLowerCase()) seen.add(h);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

/**
 * A reply keyboard: one button opens Telegram's own people picker (their chats and contacts, which is
 * the closest a bot can get to "the people I talk to"; a bot cannot read anyone's chat list), and the
 * people they paid before are one tap each. Tapping a name just sends it as a message.
 */
export function recipientKeyboard(recents: string[]): ReplyKeyboard {
  const rows: ReplyKeyboard['keyboard'] = [
    [{ text: 'Choose from Telegram', request_users: { request_id: SEND_REQUEST_ID, user_is_bot: false, max_quantity: 1, request_username: true, request_name: true } }],
  ];
  for (let i = 0; i < recents.length; i += 2) rows.push(recents.slice(i, i + 2).map((h) => ({ text: `@${h}` })));
  return { keyboard: rows, resize_keyboard: true, one_time_keyboard: true, input_field_placeholder: '@username' };
}

/** What someone typed or tapped as the recipient: "@name" or a bare name, nothing else. */
export function parseRecipientText(text: string): string | null {
  const m = /^@?([a-z0-9_]{1,40})$/i.exec(text.trim());
  if (!m) return null;
  const h = m[1].toLowerCase();
  return TELEGRAM_HANDLE_RE.test(h) ? h : null;
}

/** The card with the privacy choice and the amounts. The selected privacy option is shown in [brackets]. */
export function amountCard(handle: string, isPrivate: boolean, balanceUsd?: number | null): { text: string; keyboard: InlineKeyboard } {
  const text = [
    `Pay <b>@${handle}</b>`,
    ...(balanceUsd != null ? [`Your balance: <b>$${balanceUsd.toFixed(2)}</b>`] : []),
    isPrivate
      ? 'Private hides the link between your wallet and theirs. A small fee applies and it arrives after a short delay.'
      : 'Not private: this payment is visible on-chain.',
    'Choose an amount.',
  ].join('\n');
  return {
    text,
    keyboard: {
      inline_keyboard: [
        [
          { text: isPrivate ? '[Private]' : 'Private', callback_data: 'snd:priv:1' },
          { text: !isPrivate ? '[Not private]' : 'Not private', callback_data: 'snd:priv:0' },
        ],
        SEND_AMOUNTS.map((a) => ({ text: `$${a}`, callback_data: `snd:amt:${a}` })),
        [{ text: 'Custom amount', callback_data: 'snd:custom' }, { text: 'Change person', callback_data: 'snd:change' }],
        [{ text: 'Cancel', callback_data: 'snd:cancel' }],
      ],
    },
  };
}

/** The ordinary command sentence for a tapped amount, which then goes through the normal Confirm card. */
export const commandForAmount = (handle: string, isPrivate: boolean, amount: number) =>
  `${isPrivate ? 'payprivately' : 'pay'} ${amount} to @${handle}`;
