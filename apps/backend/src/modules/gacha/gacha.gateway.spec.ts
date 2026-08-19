import { GachaGateway } from './gacha.gateway';

describe('GachaGateway spectator access', () => {
  function makeGateway(getRoomDetail: jest.Mock) {
    const gateway = new GachaGateway(
      {} as any,
      {
        getRoomDetail,
        getBotSeatNumbers: jest.fn().mockResolvedValue([]),
      } as any,
      {} as any,
      { get: jest.fn().mockReturnValue('false') } as any,
    );
    const broadcastEmit = jest.fn();
    (gateway as any).server = {
      sockets: { adapter: { rooms: new Map([['public-room', new Set(['socket-1'])]]) } },
      to: jest.fn(() => ({ emit: broadcastEmit })),
    };
    return { gateway, broadcastEmit };
  }

  function makeClient() {
    return {
      id: 'socket-1',
      data: { userId: 'viewer-1' },
      handshake: { auth: {} },
      join: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn(),
    } as any;
  }

  it('lets an authenticated non-participant watch an authorized public room', async () => {
    const detail = { room: { id: 'public-room', isPrivate: false }, myParticipant: null };
    const getRoomDetail = jest.fn().mockResolvedValue(detail);
    const { gateway, broadcastEmit } = makeGateway(getRoomDetail);
    const client = makeClient();

    await gateway.onJoinRoom(client, { roomId: 'public-room' });

    expect(getRoomDetail).toHaveBeenCalledWith('public-room', 'viewer-1', undefined);
    expect(client.join).toHaveBeenCalledWith('public-room');
    expect(client.emit).toHaveBeenCalledWith('room:state', detail);
    expect(broadcastEmit).toHaveBeenCalledWith('room:viewer_count', { viewerCount: 1 });
  });

  it('does not join or leak snapshots when private-room authorization fails', async () => {
    const getRoomDetail = jest.fn().mockRejectedValue(new Error('Private room invite required'));
    const { gateway, broadcastEmit } = makeGateway(getRoomDetail);
    const client = makeClient();

    await gateway.onJoinRoom(client, { roomId: 'private-room', inviteCode: 'wrong-code' });

    expect(getRoomDetail).toHaveBeenCalledWith('private-room', 'viewer-1', 'wrong-code');
    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
    expect(broadcastEmit).not.toHaveBeenCalled();
  });
});
