import { GachaService } from "./gacha.service";

/**
 * Phase gates (migration 20260819120000) — the client-aware state transitions. These tests pin
 * the release rule `ack_count >= required_count OR now >= phase_deadline`, the participant-only
 * / idempotent ack contract, and the atomic release claims (a racing second release is a no-op).
 */

/** Chainable Supabase mock: each from(table) call consumes the table's result queue in order;
 *  every builder is also thenable (the service awaits mid-chain builders for count queries and
 *  conditional updates). */
function makeDb(tableQueues: Record<string, any[]>) {
  const builders: any[] = [];
  const from = jest.fn((table: string) => {
    const queue = tableQueues[table] ?? [];
    const result = queue.length ? queue.shift() : { data: null, count: null, error: null };
    const builder: any = {};
    for (const m of ["select", "update", "insert", "upsert", "eq", "is", "not", "in", "order", "limit"]) {
      builder[m] = jest.fn(() => builder);
    }
    builder.maybeSingle = jest.fn(async () => result);
    builder.single = jest.fn(async () => result);
    builder.then = (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject);
    builders.push(builder);
    return builder;
  });
  return { from, builders };
}

function makeService(db: any) {
  const events = { emit: jest.fn() };
  const service = new GachaService(
    { getClient: () => db } as any,
    { get: jest.fn(() => undefined) } as any, // config — every onchain flag reads false/undefined
    {} as any,
    {} as any,
    events as any,
    {} as any,
    {} as any,
  );
  jest.spyOn(service as any, "countParticipantsByRoom").mockResolvedValue({ "room-1": 5 });
  return { service, events };
}

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 1_000).toISOString();

describe("GachaService phase gates", () => {
  it("rejects acks from non-participants (spectators never gate a room)", async () => {
    const db = makeDb({ gacha_room_participants: [{ data: null }] });
    const { service } = makeService(db);

    const res = await service.ackPhaseGate("room-1", "user-x", "card");

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/participant/);
  });

  it("no-ops an ack for a gate that already released (idempotent, never errors the client)", async () => {
    const db = makeDb({
      gacha_room_participants: [{ data: { seat_number: 2 } }],
      gacha_rooms: [{ data: { pending_gate: null, gate_epoch: 0 } }],
    });
    const { service } = makeService(db);

    await expect(service.ackPhaseGate("room-1", "user-1", "card")).resolves.toEqual({ ok: true });
    // No ack row is written for a closed gate.
    expect(db.builders.some((b) => b.upsert.mock.calls.length > 0)).toBe(false);
  });

  it("releases the card gate the moment the last required ack lands (no deadline wait)", async () => {
    const db = makeDb({
      gacha_room_participants: [
        { data: { seat_number: 2 } }, // ackPhaseGate seat lookup
        { count: 1 }, // requiredCount — this user is the only real participant
      ],
      gacha_rooms: [
        { data: { pending_gate: "card", gate_epoch: 0 } }, // ackPhaseGate room read
        { data: { id: "room-1", pending_gate: "card", gate_epoch: 0, phase_deadline: FUTURE } }, // release check
        { data: [{ id: "room-1", status: "opening", seats: 5 }] }, // atomic release claim
        { data: null }, // status flip to 'excluding'
        { data: { vrf_randomness: null } }, // no held VRF result yet
      ],
      gacha_phase_acks: [
        { data: null }, // upsert
        { count: 1 }, // ackedCount
      ],
    });
    const { service, events } = makeService(db);

    const res = await service.ackPhaseGate("room-1", "user-1", "card");

    expect(res.ok).toBe(true);
    expect(events.emit).toHaveBeenCalledWith(
      "gacha.room.update",
      expect.objectContaining({ roomId: "room-1", status: "excluding" }),
    );
  });

  it("holds the gate while acks are incomplete and the deadline is still in the future", async () => {
    const db = makeDb({
      gacha_rooms: [{ data: { id: "room-1", pending_gate: "roulette", gate_epoch: 0, phase_deadline: FUTURE } }],
      gacha_room_participants: [{ count: 3 }],
      gacha_phase_acks: [{ count: 1 }],
    });
    const { service } = makeService(db);
    const startVoteRound = jest.spyOn(service as any, "startVoteRound").mockResolvedValue(undefined);
    const settle = jest.spyOn(service as any, "finalizeBuybackSettlement").mockResolvedValue(undefined);

    await (service as any).maybeReleasePhaseGate("room-1");

    expect(startVoteRound).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(db.builders.some((b) => b.update.mock.calls.length > 0)).toBe(false);
  });

  it("releases on deadline even with zero acks (AFK safety net), starting the next vote round", async () => {
    const db = makeDb({
      gacha_rooms: [
        { data: { id: "room-1", pending_gate: "roulette", gate_epoch: 2, phase_deadline: PAST } }, // release check
        { data: [{ id: "room-1", status: "voting", vote_round: 2 }] }, // atomic release claim
        { data: null }, // vote_round = 3 flip
      ],
    });
    const { service } = makeService(db);
    jest.spyOn(service as any, "getSurvivors").mockResolvedValue([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const startVoteRound = jest.spyOn(service as any, "startVoteRound").mockResolvedValue(undefined);

    await (service as any).maybeReleasePhaseGate("room-1");

    expect(startVoteRound).toHaveBeenCalledWith("room-1", 3);
  });

  it("starts vote round 1 when the initial exclusion's roulette gate releases", async () => {
    const db = makeDb({
      gacha_rooms: [
        { data: { id: "room-1", pending_gate: "roulette", gate_epoch: 0, phase_deadline: PAST } },
        { data: [{ id: "room-1", status: "excluding", vote_round: null }] },
        { data: null }, // status='voting', vote_round=1 flip
      ],
    });
    const { service } = makeService(db);
    jest.spyOn(service as any, "getSurvivors").mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const startVoteRound = jest.spyOn(service as any, "startVoteRound").mockResolvedValue(undefined);

    await (service as any).maybeReleasePhaseGate("room-1");

    expect(startVoteRound).toHaveBeenCalledWith("room-1", 1);
  });

  it("settles instead of starting a round when the reveal leaves a lone survivor", async () => {
    const db = makeDb({
      gacha_rooms: [
        { data: { id: "room-1", pending_gate: "roulette", gate_epoch: 1, phase_deadline: PAST } },
        { data: [{ id: "room-1", status: "voting", vote_round: 1 }] },
      ],
    });
    const { service } = makeService(db);
    jest.spyOn(service as any, "getSurvivors").mockResolvedValue([{ id: "a" }]);
    const settle = jest.spyOn(service as any, "finalizeBuybackSettlement").mockResolvedValue(undefined);
    const startVoteRound = jest.spyOn(service as any, "startVoteRound").mockResolvedValue(undefined);

    await (service as any).maybeReleasePhaseGate("room-1");

    expect(settle).toHaveBeenCalledWith("room-1");
    expect(startVoteRound).not.toHaveBeenCalled();
  });

  it("commits the held VRF result the moment the card gate opens (no extra oracle wait)", async () => {
    const db = makeDb({
      gacha_rooms: [
        { data: { id: "room-1", pending_gate: "card", gate_epoch: 0, phase_deadline: PAST } },
        { data: [{ id: "room-1", status: "opening", seats: 5 }] },
        { data: null }, // status flip
        { data: { vrf_randomness: "ab".repeat(32) } }, // fulfilled during the card phase
      ],
    });
    const { service } = makeService(db);
    const commit = jest.spyOn(service as any, "commitExclusionDraw").mockResolvedValue(undefined);

    await (service as any).maybeReleasePhaseGate("room-1");

    expect(commit).toHaveBeenCalledWith("room-1", "ab".repeat(32));
  });

  it("releases a pure-bot room's gate immediately (required count 0)", async () => {
    const db = makeDb({
      gacha_rooms: [
        { data: { id: "room-1", pending_gate: "card", gate_epoch: 0, phase_deadline: FUTURE } },
        { data: [{ id: "room-1", status: "opening", seats: 5 }] },
        { data: null },
        { data: { vrf_randomness: null } },
      ],
      gacha_room_participants: [{ count: 0 }], // all seats are bots
    });
    const { service, events } = makeService(db);

    await (service as any).maybeReleasePhaseGate("room-1");

    expect(events.emit).toHaveBeenCalledWith(
      "gacha.room.update",
      expect.objectContaining({ roomId: "room-1", status: "excluding" }),
    );
  });

  it("ignores a second release attempt (the atomic claim already fired)", async () => {
    const db = makeDb({
      gacha_rooms: [
        { data: { id: "room-1", pending_gate: "card", gate_epoch: 0, phase_deadline: PAST } },
        { data: [] }, // claim loses the race — another caller already released
      ],
    });
    const { service, events } = makeService(db);

    await (service as any).maybeReleasePhaseGate("room-1");

    expect(events.emit).not.toHaveBeenCalledWith("gacha.room.update", expect.anything());
  });
});
