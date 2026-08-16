import { GachaController } from "./gacha.controller";
import { GachaService } from "./gacha.service";

describe("GachaController room browser", () => {
  const gacha = {
    listPublicWaitingRooms: jest.fn(),
    getWaitingRoomByInviteCode: jest.fn(),
    getNextRoomNumber: jest.fn(),
    createWaitingRoom: jest.fn(),
    buildJoinTxForRoom: jest.fn(),
    leaveWaitingRoom: jest.fn(),
  };
  const controller = new GachaController(gacha as unknown as GachaService);

  beforeEach(() => jest.clearAllMocks());

  it("lists waiting rooms for the requested config", async () => {
    gacha.listPublicWaitingRooms.mockResolvedValue([{ id: "room-1" }]);

    await expect(controller.waitingRooms("small-5")).resolves.toEqual([
      { id: "room-1" },
    ]);
    expect(gacha.listPublicWaitingRooms).toHaveBeenCalledWith("small-5");
  });

  it("forwards a private invite code to the safe preview endpoint", async () => {
    gacha.getWaitingRoomByInviteCode.mockResolvedValue({ id: "private-room" });

    await expect(controller.inviteRoom("invite-secret")).resolves.toEqual({ id: "private-room" });
    expect(gacha.getWaitingRoomByInviteCode).toHaveBeenCalledWith("invite-secret");
  });

  it("returns the database-backed next room number hint", async () => {
    gacha.getNextRoomNumber.mockResolvedValue({ roomNumber: 7 });

    await expect(controller.nextRoomNumber("small-5")).resolves.toEqual({ roomNumber: 7 });
    expect(gacha.getNextRoomNumber).toHaveBeenCalledWith("small-5");
  });

  it("creates a named room for the authenticated user", async () => {
    gacha.createWaitingRoom.mockResolvedValue({
      id: "room-2",
      name: "Friday night",
    });

    await expect(
      controller.createRoom(
        { configKey: "small-5", name: "Friday night", isPrivate: false },
        { user: { id: "privy-user-1" } },
      ),
    ).resolves.toEqual({ id: "room-2", name: "Friday night" });
    expect(gacha.createWaitingRoom).toHaveBeenCalledWith(
      "small-5",
      "privy-user-1",
      "Friday night",
      false,
    );
  });

  it("builds a join transaction for the exact selected room", async () => {
    gacha.buildJoinTxForRoom.mockResolvedValue({
      roomId: "room-3",
      txBase64: "tx",
    });

    await expect(
      controller.roomJoinTx("room-3", undefined, { user: { id: "privy-user-2" } }),
    ).resolves.toEqual({
      roomId: "room-3",
      txBase64: "tx",
    });
    expect(gacha.buildJoinTxForRoom).toHaveBeenCalledWith(
      "room-3",
      "privy-user-2",
      undefined,
    );
  });

  it("lets the authenticated participant leave a waiting room", async () => {
    gacha.leaveWaitingRoom.mockResolvedValue({ roomId: "room-3", seatsFilled: 1 });

    await expect(
      controller.leaveRoom("room-3", { user: { id: "privy-user-2" } }),
    ).resolves.toEqual({ roomId: "room-3", seatsFilled: 1 });
    expect(gacha.leaveWaitingRoom).toHaveBeenCalledWith("room-3", "privy-user-2");
  });
});
