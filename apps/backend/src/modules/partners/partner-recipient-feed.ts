import { BadRequestException } from '@nestjs/common';

/** One person from a list a partner links to. Only these fields are ever read; anything else in the file is ignored. */
export type FeedRecipient = {
  email?: string;
  name?: string;
  handle?: string;
  handle_platform?: 'twitter' | 'discord' | 'github' | 'telegram';
  external_user_id?: string;
};

export const FEED_MAX_ROWS = 1000;
const PLATFORMS = ['twitter', 'discord', 'github', 'telegram'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clip = (v: unknown, n: number) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, n) : '');

/** Turns one loosely shaped record into a recipient, or says why it can not be one. */
export function toRecipient(raw: Record<string, unknown>): { ok: true; row: FeedRecipient } | { ok: false; error: string } {
  const email = clip(raw.email, 254).toLowerCase();
  const handle = clip(raw.handle, 100).replace(/^@/, '');
  const platform = clip(raw.handle_platform ?? raw.platform, 20).toLowerCase();
  const name = clip(raw.name ?? raw.display_name, 120);
  const ext = clip(raw.external_user_id ?? raw.id, 200);
  const row: FeedRecipient = {};
  if (email) {
    if (!EMAIL.test(email)) return { ok: false, error: 'not a valid email' };
    row.email = email;
  }
  if (handle) {
    if (!(PLATFORMS as readonly string[]).includes(platform)) return { ok: false, error: 'handle needs a platform (twitter, discord, github or telegram)' };
    row.handle = handle;
    row.handle_platform = platform as FeedRecipient['handle_platform'];
  }
  if (!row.email && !row.handle) return { ok: false, error: 'needs an email or a handle' };
  if (name) row.name = name;
  if (ext) row.external_user_id = ext;
  return { ok: true, row };
}

/** Minimal CSV: quoted fields, doubled quotes, CRLF. A header row names the columns. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
    if (rows.length > FEED_MAX_ROWS + 1) throw new BadRequestException(`That list has more than ${FEED_MAX_ROWS} people.`);
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * Reads a recipients list from JSON (an array, or an object with a `recipients` array) or CSV with a header row.
 * At most 1000 people. A bad row is reported and skipped, it never fails the list.
 */
export function parseRecipientFeed(body: string, contentType: string): { rows: FeedRecipient[]; errors: Array<{ row: number; error: string }> } {
  const records: Array<Record<string, unknown>> = [];
  const looksJson = /json/i.test(contentType) || /^\s*[[{]/.test(body);
  if (looksJson) {
    let data: unknown;
    try {
      data = JSON.parse(body);
    } catch {
      throw new BadRequestException('That list is not valid JSON.');
    }
    const list = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as { recipients?: unknown }).recipients) ? (data as { recipients: unknown[] }).recipients : null;
    if (!list) throw new BadRequestException('Send a JSON array, or an object with a "recipients" array.');
    if (list.length > FEED_MAX_ROWS) throw new BadRequestException(`That list has more than ${FEED_MAX_ROWS} people.`);
    for (const item of list) records.push(item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {});
  } else {
    const table = parseCsv(body);
    if (table.length < 2) throw new BadRequestException('A CSV list needs a header row and at least one person.');
    const head = table[0].map((h) => h.trim().toLowerCase());
    if (!head.some((h) => ['email', 'handle'].includes(h))) throw new BadRequestException('The first CSV row must name the columns, such as email,name.');
    for (const cells of table.slice(1)) {
      const rec: Record<string, unknown> = {};
      head.forEach((h, i) => { if (h) rec[h] = cells[i] ?? ''; });
      records.push(rec);
    }
  }
  const rows: FeedRecipient[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  const seen = new Set<string>();
  records.forEach((rec, i) => {
    const r = toRecipient(rec);
    if (!r.ok) return void errors.push({ row: i + 1, error: r.error });
    const key = r.row.email ?? `${r.row.handle_platform}:${r.row.handle?.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(r.row);
  });
  return { rows, errors: errors.slice(0, 20) };
}
