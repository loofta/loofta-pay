import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '@/database/supabase.service';
import { UsersService } from '../users/users.service';
import { isPrivyUserAdmin } from '@/common/admin-check';

export interface TwitterAutopayStatus {
  isAdmin: boolean;
  twitterHandle: string | null;
  enrolled: boolean;
  signerGranted: boolean;
}

/**
 * Admin-only for now (see isPrivyUserAdmin gate on enroll/unenroll) — the plan is to open this
 * up once the bot has run for a while under a small, hand-picked set of users, same rollout
 * shape as the integrators system. Only enrolled handles are ever eligible for the bot to act
 * on — see TwitterPaymentsService.create()'s enrollment check.
 */
@Injectable()
export class TwitterAutopayService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  async getStatus(userId: string): Promise<TwitterAutopayStatus> {
    const [isAdmin, identity, enrollment] = await Promise.all([
      isPrivyUserAdmin(this.supabaseService, this.configService, userId),
      this.usersService.findIdentityByPrivyId(userId),
      this.supabaseService.twitterAutopayEnrollments.select('enabled, signer_granted').eq('user_id', userId).maybeSingle(),
    ]);

    return {
      isAdmin,
      twitterHandle: identity?.twitterUsername ?? null,
      enrolled: !!enrollment.data?.enabled,
      signerGranted: !!enrollment.data?.signer_granted,
    };
  }

  /** Called after the client successfully completes useSigners().addSigners() on their wallet. */
  async enroll(userId: string): Promise<TwitterAutopayStatus> {
    await this.assertAdmin(userId);

    const identity = await this.usersService.findIdentityByPrivyId(userId);
    const twitterHandle = identity?.twitterUsername?.replace(/^@/, '').toLowerCase();
    if (!twitterHandle) {
      throw new BadRequestException('Link your X account in Loofta before enabling the bot');
    }

    const { error } = await this.supabaseService.twitterAutopayEnrollments.upsert(
      { user_id: userId, twitter_handle: twitterHandle, enabled: true, signer_granted: true },
      { onConflict: 'user_id' },
    );
    if (error) throw new Error(`Failed to enroll: ${error.message}`);

    return this.getStatus(userId);
  }

  async unenroll(userId: string): Promise<TwitterAutopayStatus> {
    await this.assertAdmin(userId);
    await this.supabaseService.twitterAutopayEnrollments.update({ enabled: false }).eq('user_id', userId);
    return this.getStatus(userId);
  }

  /** What the bot's create() flow checks — silently ignore anyone not on this list. */
  async isHandleEnrolled(twitterHandle: string): Promise<boolean> {
    const clean = twitterHandle.replace(/^@/, '').toLowerCase();
    const { data } = await this.supabaseService.twitterAutopayEnrollments
      .select('id')
      .eq('twitter_handle', clean)
      .eq('enabled', true)
      .maybeSingle();
    return !!data;
  }

  private async assertAdmin(userId: string): Promise<void> {
    const admin = await isPrivyUserAdmin(this.supabaseService, this.configService, userId);
    if (!admin) throw new ForbiddenException('Twitter auto-pay is admin-only for now');
  }
}
