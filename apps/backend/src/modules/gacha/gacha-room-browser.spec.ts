import { GachaService, type WaitingRoomSummary } from "./gacha.service";

function makeService(db: any = {}) {
  return new GachaService(
    { getClient: () => db } as any,
    { get: jest.fn(() => undefined) } as any,
    {} as any,
    {} as any,
    { emit: jest.fn() } as any,
    {} as any,
    {} as any,
  );
}

describe("GachaService explicit room browser", () => {
  it("requires the exact invite code for a private room join", async () => {
    const roomQuery: any = {
      select: jest.fn(() => roomQuery),
      eq: jest.fn(() => roomQuery),
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
    const participantQuery: any = {
      select: jest.fn(() => participantQuery),
      eq: jest.fn(() => participantQuery),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
    const service = makeService({
      from: jest.fn((table: string) => table === "gacha_rooms" ? roomQuery : participantQuery),
    });

    await expect((service as any).getJoinableRoom("private-room", "guest", "wrong-code"))
      .rejects.toThrow("Room not found");
    await expect((service as any).getJoinableRoom("private-room", "guest", "invite-secret"))
      .resolves.toMatchObject({ id: "private-room", configKey: "small-5" });
  });

  it("lets an existing private-room participant recover without the invite code", async () => {
    const roomQuery: any = {
      select: jest.fn(() => roomQuery),
      eq: jest.fn(() => roomQuery),
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
    const participantQuery: any = {
      select: jest.fn(() => participantQuery),
      eq: jest.fn(() => participantQuery),
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: "seat-1" }, error: null }),
    };
    const service = makeService({
      from: jest.fn((table: string) => table === "gacha_rooms" ? roomQuery : participantQuery),
    });

    await expect((service as any).getJoinableRoom("private-room", "invitee"))
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

  it("does not charge again when the selected room is the user's existing room", async () => {
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
        id: "selected-room",
        entryUsdc: 10,
      });
    const build = jest.spyOn(service as any, "buildEntryPaymentTx");

    await expect(
      service.buildJoinTxForRoom("selected-room", "user-1"),
    ).resolves.toEqual({
      txBase64: null,
      roomId: "selected-room",
      entryUsdc: 10,
      alreadyJoined: true,
    });
    expect(build).not.toHaveBeenCalled();
  });

  it("does not silently redirect a selected public room to a different private room", async () => {
    const service = makeService();
    const existingRoom = {
      id: "private-room",
      name: "Friends only",
      configKey: "small-5",
      seats: 5,
      entryUsdc: 10,
      seatsFilled: 2,
      isPrivate: true,
      createdAt: "2026-01-01",
      participants: [],
    };
    jest.spyOn(service as any, "getJoinableRoom").mockResolvedValue({
      id: "selected-public-room",
      configKey: "small-5",
      seats: 5,
      entryUsdc: 10,
    });
    jest.spyOn(service as any, "findExistingWaitingRoomForUser").mockResolvedValue({
      id: existingRoom.id,
      entryUsdc: existingRoom.entryUsdc,
    });
    jest.spyOn(service as any, "getWaitingRoomSummary").mockResolvedValue(existingRoom);
    const build = jest.spyOn(service as any, "buildEntryPaymentTx");

    await expect(service.buildJoinTxForRoom("selected-public-room", "user-1"))
      .rejects.toMatchObject({
        response: {
          code: "ALREADY_IN_DIFFERENT_WAITING_ROOM",
          room: existingRoom,
        },
      });
    expect(build).not.toHaveBeenCalled();
  });

  it("lets an invited participant recover their private room without exposing its invite code", async () => {
    const roomQuery: any = {
      select: jest.fn(() => roomQuery),
      eq: jest.fn(() => roomQuery),
      maybeSingle: jest.fn().mockResolvedValue({
        data: {
          id: "private-room",
          name: "Friends only",
          config_key: "small-5",
          seats: 5,
          entry_usdc: 10,
          is_private: true,
          created_by_user_id: "owner",
          invite_code: "bearer-secret",
          created_at: "2026-01-01",
          status: "waiting",
        },
        error: null,
      }),
    };
    const participantQuery: any = {
      select: jest.fn(() => participantQuery),
      eq: jest.fn(() => participantQuery),
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: "seat-1" }, error: null }),
    };
    const service = makeService({
      from: jest.fn((table: string) => table === "gacha_rooms" ? roomQuery : participantQuery),
    });
    const summary = {
      id: "private-room",
      name: "Friends only",
      configKey: "small-5",
      seats: 5,
      entryUsdc: 10,
      seatsFilled: 2,
      isPrivate: true,
      createdAt: "2026-01-01",
      participants: [],
    };
    const hydrate = jest.spyOn(service as any, "hydrateWaitingRoomSummaries").mockResolvedValue([summary]);

    await expect((service as any).getWaitingRoomSummary("private-room", "invitee", true))
      .resolves.toEqual(summary);
    expect(hydrate).toHaveBeenCalledWith(expect.any(Array), false);
  });

  it("releases a waiting seat through the atomic database function", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: { roomId: "room-1", seatsFilled: 1, seats: 5, roomCancelled: false, entryRefunded: false },
      error: null,
    });
    const service = makeService({ rpc });
    const emit = jest.spyOn((service as any).events, "emit");

    await expect(service.leaveWaitingRoom("room-1", "user-1")).resolves.toMatchObject({
      roomId: "room-1",
      seatsFilled: 1,
      entryRefunded: false,
    });
    expect(rpc).toHaveBeenCalledWith("gacha_leave_waiting_room", {
      p_room_id: "room-1",
      p_user_id: "user-1",
    });
    expect(emit).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ roomId: "room-1" }));
  });

  it("returns the existing room so the owner can recover from a duplicate create", async () => {
    const service = makeService();
    const existingRoom = {
      id: "existing-room",
      name: "Friends",
      configKey: "small-5",
      seats: 5,
      entryUsdc: 10,
      seatsFilled: 1,
      isPrivate: true,
      inviteCode: "invite-secret",
      createdAt: "2026-01-01",
      participants: [{ seatNumber: 1, mascotKey: "goat" }],
    };
    jest.spyOn(service as any, "getConfig").mockResolvedValue({ configKey: "small-5" });
    jest.spyOn(service as any, "findExistingWaitingRoomForUser").mockResolvedValue({
      id: existingRoom.id,
      entryUsdc: existingRoom.entryUsdc,
    });
    jest.spyOn(service as any, "getWaitingRoomSummary").mockResolvedValue(existingRoom);

    await expect(service.createWaitingRoom("small-5", "user-1", "Another room", true))
      .rejects.toMatchObject({
        response: {
          code: "ALREADY_IN_WAITING_ROOM",
          message: "You already have a seat in a waiting room for this size",
          room: existingRoom,
        },
      });
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

  it("loads the database-backed next room number instead of counting visible rooms", async () => {
    const query: any = {
      select: jest.fn(() => query),
      eq: jest.fn(() => query),
      order: jest.fn(() => query),
      limit: jest.fn(() => query),
      maybeSingle: jest.fn().mockResolvedValue({ data: { room_number: 12 }, error: null }),
    };
    const service = makeService({ from: jest.fn(() => query) });
    jest.spyOn(service as any, "getConfig").mockResolvedValue({ configKey: "small-5" });

    await expect(service.getNextRoomNumber("small-5")).resolves.toEqual({ roomNumber: 13 });
    expect(query.order).toHaveBeenCalledWith("room_number", { ascending: false });
  });
});
