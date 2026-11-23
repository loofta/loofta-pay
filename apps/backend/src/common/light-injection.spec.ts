import 'reflect-metadata';
import { LightCompressionService } from './light-compression.service';
import { PartnerWithdrawService } from '@/modules/partners/partner-withdraw.service';
import { ClaimsService } from '@/modules/claims/claims.service';

/**
 * A constructor parameter typed `Service | null` is emitted as `Object`, which Nest cannot resolve; with @Optional the
 * service then arrives as null and compressed payouts silently never work (they showed "processing" forever in
 * production on 2026-11-23). The fix is an explicit @Inject token, and this test keeps it there.
 */
describe('the Light compression service is injected by an explicit token', () => {
  const tokens = (cls: unknown): unknown[] => ((Reflect.getMetadata('self:paramtypes', cls as object) ?? []) as Array<{ index: number; param: unknown }>).map((p) => p.param);

  it('in the partner withdraw service', () => {
    expect(tokens(PartnerWithdrawService)).toContain(LightCompressionService);
  });

  it('in the claims service', () => {
    expect(tokens(ClaimsService)).toContain(LightCompressionService);
  });
});
