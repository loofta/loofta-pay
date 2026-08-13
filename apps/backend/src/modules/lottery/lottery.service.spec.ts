import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LotteryService } from './lottery.service';
import { SupabaseService } from '@/database/supabase.service';
import { NearIntentsService } from '../intents/near-intents.service';
import { SendPaymentEncryptionService } from '../send-payment/encryption.service';
import { MegapotService } from './megapot.service';
import { RhinestoneService } from './rhinestone.service';
import { LifiService } from './lifi.service';
import { RelayService } from './relay.service';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { MagicblockQuestService } from '../magicblock-quest/magicblock-quest.service';

// Regression coverage for the 2026-08-13 incident: a ticket the user explicitly cancelled (or
// that was already made whole via rescue) got auto-retried into 'buying' with no bridge ever
// restarted — stuck forever, and no longer eligible for the fee-refund cron since it was no
// longer 'failed'. See project memory: lottery tickets stuck in buying / CANCELLED bridge_status.
//
// No money-moving code runs here — reconcileOrRetryFailedTicket only ever writes a DB status, it
// never signs or broadcasts a transaction. The wallet-drain risk this guards against is a ticket
// silently getting queued for re-purchase after the user (or the rescue flow) already decided its
// funds should not move again.

/** Chainable Supabase query-builder mock: every method returns itself and is a jest.fn so calls
 *  can be asserted on; awaiting the chain resolves to whatever `result` currently holds. */
function makeQueryBuilder(result: { data?: any; error?: any } = { data: null, error: null }) {
  const builder: any = {};
  const chainMethods = ['select', 'update', 'insert', 'eq', 'lt', 'gte', 'is', 'or', 'not', 'in', 'order', 'limit'];
  for (const m of chainMethods) {
    builder[m] = jest.fn(() => builder);
  }
  builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

describe('LotteryService — auto-retry never resurrects a CANCELLED/RESCUED ticket', () => {
  let service: LotteryService;
  let dbFrom: jest.Mock;
  let megapot: { getTicketNumbersFromNft: jest.Mock; getActiveRound: jest.Mock };

  beforeEach(async () => {
    dbFrom = jest.fn();
    megapot = {
      getTicketNumbersFromNft: jest.fn().mockResolvedValue({ tokenIds: [], ticketNumbers: [] }),
      getActiveRound: jest.fn().mockResolvedValue({ id: 'round-1', drawTime: null }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LotteryService,
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: SupabaseService, useValue: { getClient: () => ({ from: dbFrom }) } },
        { provide: NearIntentsService, useValue: {} },
        { provide: SendPaymentEncryptionService, useValue: {} },
        { provide: MegapotService, useValue: megapot },
        { provide: RhinestoneService, useValue: {} },
        { provide: LifiService, useValue: {} },
        { provide: RelayService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: MagicblockQuestService, useValue: {} },
      ],
    }).compile();

    service = module.get(LotteryService);
  });

  // ── reconcileOrRetryFailedTicket: the shared choke point both the cron and the manual "Retry
  // purchase" button funnel through — this is the last line of defense, so it must hold even if
  // a caller's own filter is ever loosened or gets a query bug. ──────────────────────────────
  describe('reconcileOrRetryFailedTicket (private, invoked via cast)', () => {
    it('refuses to touch a ticket the user explicitly cancelled — no on-chain check, no DB write', async () => {
      const ticket = { id: 't-cancelled', bridge_status: 'CANCELLED', companion_address: '0xabc', retry_count: 0 };

      await (service as any).reconcileOrRetryFailedTicket(ticket);

      expect(megapot.getTicketNumbersFromNft).not.toHaveBeenCalled();
      expect(dbFrom).not.toHaveBeenCalled();
    });

    it('refuses to touch a ticket that was already rescued — no on-chain check, no DB write', async () => {
      const ticket = { id: 't-rescued', bridge_status: 'RESCUED', companion_address: '0xabc', retry_count: 0 };

      await (service as any).reconcileOrRetryFailedTicket(ticket);

      expect(megapot.getTicketNumbersFromNft).not.toHaveBeenCalled();
      expect(dbFrom).not.toHaveBeenCalled();
    });

    it('never re-buys when an on-chain mint already exists — corrects to active instead', async () => {
      megapot.getTicketNumbersFromNft.mockResolvedValueOnce({
        tokenIds: ['123'],
        ticketNumbers: [{ main: [1, 2, 3, 4, 5], bonus: 6 }],
      });
      const builder = makeQueryBuilder({ data: [{ id: 't-minted' }], error: null });
      dbFrom.mockReturnValue(builder);
      const ticket = { id: 't-minted', bridge_status: null, companion_address: '0xabc', retry_count: 0, round_id: 'round-1', draw_time: null };

      await (service as any).reconcileOrRetryFailedTicket(ticket);

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
      expect(builder.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'buying' }));
    });

    it('queues a genuine retry (status -> buying) only when no on-chain mint and no CANCELLED/RESCUED bridge_status', async () => {
      const builder = makeQueryBuilder({ data: [{ id: 't-retry' }], error: null });
      dbFrom.mockReturnValue(builder);
      const ticket = { id: 't-retry', bridge_status: null, companion_address: '0xabc', retry_count: 1 };

      await (service as any).reconcileOrRetryFailedTicket(ticket);

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'buying', retry_count: 2 }));
    });

    it('treats a never-set (null) bridge_status as retryable — the common case for ordinary failures', async () => {
      const builder = makeQueryBuilder({ data: [{ id: 't-null-bridge' }], error: null });
      dbFrom.mockReturnValue(builder);
      const ticket = { id: 't-null-bridge', bridge_status: null, companion_address: '0xabc', retry_count: 0 };

      await (service as any).reconcileOrRetryFailedTicket(ticket);

      expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'buying' }));
    });
  });

  // ── autoRetryFailedTickets: the cron's selection query itself. Postgres/PostgREST semantics
  // mean `NOT IN ('CANCELLED','RESCUED')` silently excludes rows where bridge_status IS NULL
  // (NULL IN (...) evaluates to NULL, not FALSE) — most ordinary 'failed' tickets never set
  // bridge_status at all, so a naive `.not('bridge_status','in',...)` would break auto-retry for
  // them entirely. This locks in the NULL-safe `.or(...)` form instead. ────────────────────────
  describe('autoRetryFailedTickets query filter', () => {
    it('excludes CANCELLED/RESCUED via an explicit NULL-safe OR clause, not a NULL-unsafe NOT IN', async () => {
      const builder = makeQueryBuilder({ data: [], error: null });
      dbFrom.mockReturnValue(builder);

      await (service as any).autoRetryFailedTickets();

      expect(builder.or).toHaveBeenCalledWith('bridge_status.is.null,bridge_status.not.in.(CANCELLED,RESCUED)');
      expect(builder.not).not.toHaveBeenCalledWith('bridge_status', 'in', expect.anything());
    });

    it('reconciles each ticket the query returns', async () => {
      const selectBuilder = makeQueryBuilder({
        data: [{ id: 't-1', bridge_status: null, companion_address: '0xabc', retry_count: 0 }],
        error: null,
      });
      const updateBuilder = makeQueryBuilder({ data: [{ id: 't-1' }], error: null });
      dbFrom.mockReturnValueOnce(selectBuilder).mockReturnValueOnce(updateBuilder);

      await (service as any).autoRetryFailedTickets();

      expect(megapot.getTicketNumbersFromNft).toHaveBeenCalledWith('0xabc', undefined);
      expect(updateBuilder.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'buying' }));
    });
  });
});
