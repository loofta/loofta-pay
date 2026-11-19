import { BadRequestException } from '@nestjs/common';

/** The cash-out routes a recipient can pick on the withdraw page. A partner may switch any of them off. */
export const WITHDRAW_METHODS = ['usdc', 'token', 'bank', 'p2p'] as const;
export type WithdrawMethod = (typeof WITHDRAW_METHODS)[number];

/** Cleans a list of methods to turn off: known names only, no repeats. Throws if it would leave no way out. */
export function normalizeDisabledMethods(input: unknown): WithdrawMethod[] {
  if (!Array.isArray(input)) throw new BadRequestException('disabled_withdraw_methods must be a list.');
  const out: WithdrawMethod[] = [];
  for (const m of input) {
    if (!WITHDRAW_METHODS.includes(m as WithdrawMethod)) throw new BadRequestException(`Unknown withdraw method: ${String(m)}.`);
    if (!out.includes(m as WithdrawMethod)) out.push(m as WithdrawMethod);
  }
  if (out.length >= WITHDRAW_METHODS.length) throw new BadRequestException('Keep at least one way to withdraw switched on.');
  return out;
}

/** The routes a partner leaves on. Rows from before the columns existed read as everything on. */
export function enabledMethods(disabled: unknown): WithdrawMethod[] {
  const off = new Set(Array.isArray(disabled) ? disabled : []);
  return WITHDRAW_METHODS.filter((m) => !off.has(m));
}
