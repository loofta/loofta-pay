import { GachaController } from "./gacha.controller";
import { GachaService } from "./gacha.service";

describe("GachaController room browser", () => {
  const gacha = {
    listPublicWaitingRooms: jest.fn(),
    createWaitingRoom: jest.fn(),
    buildJoinTxForRoom: jest.fn(),
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
      controller.roomJoinTx("room-3", { user: { id: "privy-user-2" } }),
    ).resolves.toEqual({
      roomId: "room-3",
      txBase64: "tx",
    });
    expect(gacha.buildJoinTxForRoom).toHaveBeenCalledWith(
      "room-3",
      "privy-user-2",
    );
  });
});
