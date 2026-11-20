import { Logger, ForbiddenException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { getClientIp } from '@/common/get-client-ip';

const logger = new Logger('EnsureAppUser');
const ensured = new Set<string>();

/**
 * Every authenticated request must belong to an app_users row. Accounts that exist only in Privy never ran
 * the profile sync, so suspension, the per-IP signup limit and the auto-suspend rule (all keyed on that row)
 * silently did nothing for them (2026-11-20: three attacker accounts, 21 payments, no row). Creating the
 * row here applies those rules. A ForbiddenException (IP limit, disposable email) propagates; anything else
 * fails open so a DB hiccup never locks real users out.
 */
export async function ensureAppUserRow(moduleRef: ModuleRef, userId: string, request: { headers: Record<string, unknown>; ip?: string }): Promise<void> {
  if (ensured.has(userId)) return;
  try {
    // Lazy require: importing UsersService at load time would create a circular import (users module -> guards).
    const { UsersService } = require('@/modules/users/users.service');
    const users = moduleRef.get(UsersService, { strict: false });
    await users.ensureAppUser(userId, getClientIp(request));
    if (ensured.size > 20000) ensured.clear();
    ensured.add(userId);
  } catch (e) {
    if (e instanceof ForbiddenException) throw e;
    logger.warn(`ensureAppUserRow failed for ${userId}: ${(e as Error)?.message}`);
  }
}
