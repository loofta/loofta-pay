import { GachaService } from './gacha.service';

function makeBuilder(result: any) {
  const builder: any = {};
  for (const method of ['select', 'update', 'eq', 'is', 'lt', 'in', 'order', 'limit', 'range']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.single = jest.fn(async () => result);
  builder.maybeSingle = jest.fn(async () => result);
  builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeService(roomResults: any[], vrf: { pollFulfillment: jest.Mock; requestRandomness: jest.Mock }) {
  const builders: any[] = [];
  const db = {
    from: jest.fn(() => {
      const builder = makeBuilder(roomResults.shift() ?? { data: null, error: null });
      builders.push(builder);
      return builder;
    }),
  };
  const service = new GachaService({ getClient: () => db } as any, { get: jest.fn(() => undefined) } as any, {} as any, {} as any, { emit: jest.fn() } as any, vrf as any, {} as any);
  return { service, db, builders };
}

describe('Gacha room vote-lock and transaction-proof responses', () => {
  it.each([
    { endpoint: 'open', pending: true },
    { endpoint: 'mine', pending: true },
    { endpoint: 'admin', pending: true },
    { endpoint: 'detail', pending: true },
    { endpoint: 'detail', pending: false },
  ])('preserves both fields for $endpoint rooms (VRF pending: $pending)', async ({ endpoint, pending }) => {
    const room = {
      id: 'room-1', config_key: 'small-5', seats: 5, entry_usdc: 10,
      status: 'voting', vote_round: 2,
      vrf_requested_at: pending ? '2026-08-28T00:00:00.000Z' : null,
      buyback_amount_usdc: 40.8,
      purchase_tx_sig: 'purchase-sig', open_tx_sig: 'open-sig',
      buyback_tx_sig: 'buyback-sig', nft_transfer_tx_sig: 'transfer-sig',
    };
    const result = (data: unknown) => ({ data, error: null, count: 1 });
    const responses = endpoint === 'detail'
      ? [
          result(room),
          result({ seat_number: 1, payment_tx_hash: 'entry-sig', payout_tx_sig: 'payout-sig', payout_usdc: 20.4 }),
          result(null),
          result({ payment_tx_hash: 'bid-sig' }),
          result([]),
        ]
      : endpoint === 'mine'
        ? [result([{ room_id: room.id }]), result([room])]
        : [result([room])];
    const { service, builders } = makeService(responses, {
      pollFulfillment: jest.fn(), requestRandomness: jest.fn(),
    });
    jest.spyOn(service as any, 'countParticipantsByRoom').mockResolvedValue({ 'room-1': 1 });

    let summary;
    if (endpoint === 'detail') {
      const detail = await service.getRoomDetail(room.id, 'user-1');
      summary = detail.room;
      expect(detail.myParticipant).toMatchObject({
        entryPaymentTxSig: 'entry-sig', winningBidPaymentTxSig: 'bid-sig', payoutTxSig: 'payout-sig',
      });
      expect(detail.leaveRefundEligible).toBe(false);
    } else if (endpoint === 'admin') {
      summary = (await service.getAdminRooms(1, 10)).data[0];
    } else if (endpoint === 'mine') {
      summary = (await service.getMyRooms('user-1'))[0];
    } else {
      summary = (await service.listOpenRooms())[0];
    }

    expect(summary).toMatchObject({
      voteLocked: pending, seatsFilled: 1,
      purchaseTxSig: 'purchase-sig', openTxSig: 'open-sig',
      buybackTxSig: 'buyback-sig', nftTransferTxSig: 'transfer-sig',
    });
    // Assert the database projection too: a mock row alone would hide a dropped select field.
    const roomQuery = builders[endpoint === 'mine' ? 1 : 0];
    expect(roomQuery.select.mock.calls[0][0].split(', ')).toEqual(expect.arrayContaining([
      'vrf_requested_at', 'purchase_tx_sig', 'open_tx_sig', 'buyback_tx_sig', 'nft_transfer_tx_sig',
    ]));
  });
});

describe('GachaService stalled VRF recovery', () => {
  it('re-requests real VRF after the existing request exceeds the stall window', async () => {
    const oldRequest = new Date(Date.now() - 16 * 60_000).toISOString();
    const vrf = {
      pollFulfillment: jest.fn().mockResolvedValue(null),
      requestRandomness: jest.fn().mockResolvedValue({ slot: 12345 }),
    };
    const { service, builders } = makeService(
      [
        {
          data: { vrf_requested_at: oldRequest, vrf_randomness: null },
          error: null,
        },
        { data: [{ id: 'room-1' }], error: null },
        { data: null, error: null },
      ],
      vrf,
    );

    await expect((service as any).pollOrRequestVrf('room-1', 'room-1:vote:2')).resolves.toBeNull();

    expect(vrf.pollFulfillment).toHaveBeenCalledWith('room-1:vote:2');
    expect(vrf.requestRandomness).toHaveBeenCalledWith('room-1:vote:2');
    expect(builders[1].eq).toHaveBeenCalledWith('vrf_requested_at', oldRequest);
    expect(builders[1].is).toHaveBeenCalledWith('vrf_randomness', null);
    expect(builders[2].update).toHaveBeenCalledWith(expect.objectContaining({ vrf_request_slot: 12345 }));
  });

  it('keeps polling a recent request without replacing it', async () => {
    const recentRequest = new Date(Date.now() - 60_000).toISOString();
    const vrf = {
      pollFulfillment: jest.fn().mockResolvedValue(null),
      requestRandomness: jest.fn(),
    };
    const { service, db } = makeService(
      [
        {
          data: { vrf_requested_at: recentRequest, vrf_randomness: null },
          error: null,
        },
      ],
      vrf,
    );

    await expect((service as any).pollOrRequestVrf('room-1', 'room-1:vote:2')).resolves.toBeNull();

    expect(vrf.requestRandomness).not.toHaveBeenCalled();
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('releases the retry claim immediately when the replacement request fails', async () => {
    const oldRequest = new Date(Date.now() - 16 * 60_000).toISOString();
    const vrf = {
      pollFulfillment: jest.fn().mockResolvedValue(null),
      requestRandomness: jest.fn().mockRejectedValue(new Error('RPC unavailable')),
    };
    const { service, builders } = makeService(
      [
        {
          data: { vrf_requested_at: oldRequest, vrf_randomness: null },
          error: null,
        },
        { data: [{ id: 'room-1' }], error: null },
        { data: null, error: null },
      ],
      vrf,
    );

    await expect((service as any).pollOrRequestVrf('room-1', 'room-1:vote:2')).resolves.toBeNull();

    expect(builders[2].update).toHaveBeenCalledWith(
      expect.objectContaining({
        vrf_requested_at: null,
        vrf_request_slot: null,
      }),
    );
  });

  it('resumes a stale pre-submission buyback settlement', async () => {
    const vrf = { pollFulfillment: jest.fn(), requestRandomness: jest.fn() };
    const { service } = makeService([
      {
        data: [{
          id: 'room-1',
          seats: 5,
          buyback_tx_sig: null,
          updated_at: new Date(Date.now() - 6 * 60_000).toISOString(),
        }],
        error: null,
      },
      { data: [{ id: 'room-1' }], error: null },
    ], vrf);
    const execute = jest.spyOn(service as any, 'executeBuybackSettlement').mockResolvedValue(undefined);

    await service.advanceStalledBuybackSettlements();

    expect(execute).toHaveBeenCalledWith('room-1');
  });
});
