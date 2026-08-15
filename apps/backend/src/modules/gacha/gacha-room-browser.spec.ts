import { GachaService, type WaitingRoomSummary } from "./gacha.service";

function makeService(db: any = {}) {
  return new GachaService(
    { getClient: () => db } as any,
    { get: jest.fn(() => undefined) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

describe("GachaService explicit room browser", () => {
  it("requires the exact invite code for a private room join", async () => {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: "private-room",
          config_key: "small-5",
          seats: 5,
          entry_usdc: 10,
          status: "waiting",
          is_private: true,
          created_by_user_id: "owner",
          invite_code: "invite-secret",
        },
        error: null,
      }),
    };
    const service = makeService({ from: jest.fn(() => query) });

    await expect((service as any).getJoinableRoom("private-room", "guest", "wrong-code"))
      .rejects.toThrow("Room not found");
    await expect((service as any).getJoinableRoom("private-room", "guest", "invite-secret"))
      .resolves.toMatchObject({ id: "private-room", configKey: "small-5" });
  });

  it("builds payment for the selected room instead of config-level auto-placement", async () => {
    const service = makeService();
    const requested = {
      id: "selected-room",
      configKey: "small-5",
      seats: 5,
      entryUsdc: 10,
    };
    jest.spyOn(service as any, "getJoinableRoom").mockResolvedValue(requested);
    jest
      .spyOn(service as any, "findExistingWaitingRoomForUser")
      .mockResolvedValue(null);
    jest.spyOn(service as any, "assertRoomHasOpenSeat").mockResolvedValue(undefined);
    const build = jest
      .spyOn(service as any, "buildEntryPaymentTx")
      .mockResolvedValue({
        txBase64: "signed-tx",
        roomId: requested.id,
        entryUsdc: requested.entryUsdc,
      });

    await expect(
      service.buildJoinTxForRoom(requested.id, "user-1"),
    ).resolves.toMatchObject({
      roomId: requested.id,
      txBase64: "signed-tx",
    });
    expect(build).toHaveBeenCalledWith(requested, "user-1");
  });

  it("does not charge again when the user already owns a waiting seat for that size", async () => {
    const service = makeService();
    jest.spyOn(service as any, "getJoinableRoom").mockResolvedValue({
      id: "selected-room",
      configKey: "small-5",
      seats: 5,
      entryUsdc: 10,
    });
    jest
      .spyOn(service as any, "findExistingWaitingRoomForUser")
      .mockResolvedValue({
        id: "existing-room",
        entryUsdc: 10,
      });
    const build = jest.spyOn(service as any, "buildEntryPaymentTx");

    await expect(
      service.buildJoinTxForRoom("selected-room", "user-1"),
    ).resolves.toEqual({
      txBase64: null,
      roomId: "existing-room",
      entryUsdc: 10,
      alreadyJoined: true,
    });
    expect(build).not.toHaveBeenCalled();
  });

  it("returns only joinable rooms and ranks the fullest room first", async () => {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest
        .fn()
        .mockResolvedValue({
          data: [{ id: "a" }, { id: "b" }, { id: "full" }],
          error: null,
        }),
    };
    const service = makeService({ from: jest.fn(() => query) });
    jest
      .spyOn(service as any, "getConfig")
      .mockResolvedValue({ configKey: "small-5" });
    const rooms: WaitingRoomSummary[] = [
      {
        id: "a",
        name: "A",
        configKey: "small-5",
        seats: 5,
        entryUsdc: 10,
        seatsFilled: 1,
        isPrivate: false,
        createdAt: "2026-01-01",
        participants: [],
      },
      {
        id: "b",
        name: "B",
        configKey: "small-5",
        seats: 5,
        entryUsdc: 10,
        seatsFilled: 4,
        isPrivate: false,
        createdAt: "2026-01-02",
        participants: [],
      },
      {
        id: "full",
        name: "Full",
        configKey: "small-5",
        seats: 5,
        entryUsdc: 10,
        seatsFilled: 5,
        isPrivate: false,
        createdAt: "2026-01-03",
        participants: [],
      },
    ];
    jest
      .spyOn(service as any, "hydrateWaitingRoomSummaries")
      .mockResolvedValue(rooms);

    const result = await service.listPublicWaitingRooms("small-5");

    expect(result.map((room) => room.id)).toEqual(["b", "a"]);
  });
});
