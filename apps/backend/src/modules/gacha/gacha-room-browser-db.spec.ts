import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

/**
 * Opt-in staging integration tests for the LOO-6 room-browser invariants.
 *
 * They are skipped in the normal unit-test suite because they create and remove disposable
 * waiting rooms in the configured Supabase project. Run explicitly with:
 *
 *   set -a; source apps/backend/.env.development.local; set +a
 *   GACHA_DB_INTEGRATION=true npm test --workspace=@loofta/backend -- --runInBand src/modules/gacha/gacha-room-browser-db.spec.ts
 */
const runIntegration = process.env.GACHA_DB_INTEGRATION === 'true';
const describeDb = runIntegration ? describe : describe.skip;

describeDb('Gacha room browser database invariants', () => {
  let db: SupabaseClient;
  const createdRoomIds: string[] = [];
  // Keep generated room names within gacha_rooms.name's 24-character constraint.
  const testRun = `db-${randomUUID().slice(0, 8)}`;

  beforeAll(() => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET are required for DB integration tests');
    db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  });

  afterAll(async () => {
    if (!db || !createdRoomIds.length) return;
    await db.from('gacha_room_participants').delete().in('room_id', createdRoomIds);
    await db.from('gacha_rooms').delete().in('id', createdRoomIds);
  });

  async function createRoom(ownerId: string): Promise<string> {
    // LOO-7 extends this RPC with an invite-code argument. Prefer that signature when the
    // staging project already has it, but keep the test runnable against a clean LOO-6 schema.
    const fiveArg = await db.rpc('gacha_create_waiting_room', {
      p_config_key: 'small-5',
      p_created_by_user_id: ownerId,
      p_room_name: `${testRun}-${ownerId.slice(-8)}`,
      p_is_private: false,
      p_invite_code: null,
    });
    const missingFunction = fiveArg.error && /Could not find the function|schema cache|does not exist/i.test(fiveArg.error.message);
    const { data, error } = missingFunction
      ? await db.rpc('gacha_create_waiting_room', {
          p_config_key: 'small-5',
          p_created_by_user_id: ownerId,
          p_room_name: `${testRun}-${ownerId.slice(-8)}`,
          p_is_private: false,
        })
      : fiveArg;
    if (error || !data) throw new Error(error?.message ?? 'Database room create returned no id');
    createdRoomIds.push(String(data));
    return String(data);
  }

  it('serializes concurrent creates and rejects the duplicate creator', async () => {
    const ownerId = `${testRun}-same-owner`;
    const results = await Promise.allSettled([createRoom(ownerId), createRoom(ownerId)]);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String((rejected[0] as PromiseRejectedResult).reason?.message)).toContain('already have a waiting room');
  });

  it('allocates distinct room numbers for concurrent creators', async () => {
    const owners = Array.from({ length: 4 }, (_, index) => `${testRun}-owner-${index}`);
    const roomIds = await Promise.all(owners.map((ownerId) => createRoom(ownerId)));
    const { data, error } = await db.from('gacha_rooms').select('id, room_number').in('id', roomIds);
    if (error) throw new Error(error.message);

    const roomNumbers = (data ?? []).map((room) => room.room_number);
    expect(roomNumbers).toHaveLength(roomIds.length);
    expect(new Set(roomNumbers).size).toBe(roomNumbers.length);
  });

  it('serializes concurrent final-seat inserts and never assigns duplicate seats', async () => {
    const roomId = await createRoom(`${testRun}-seat-owner`);
    const { data: room, error: roomError } = await db.from('gacha_rooms').select('seats').eq('id', roomId).single();
    if (roomError || !room) throw new Error(roomError?.message ?? 'Test room not found');

    const attempts = Array.from({ length: room.seats + 2 }, (_, index) =>
      db.from('gacha_room_participants').insert({
        room_id: roomId,
        user_id: `${testRun}-seat-${index}`,
      }).select('seat_number').single(),
    );
    const results = await Promise.all(attempts);
    const successfulSeats = results
      .filter((result) => !result.error && result.data)
      .map((result) => result.data!.seat_number);

    expect(successfulSeats).toHaveLength(room.seats);
    expect(new Set(successfulSeats).size).toBe(room.seats);
    expect(successfulSeats.every((seat) => seat >= 1 && seat <= room.seats)).toBe(true);
  });

  it('exposes created public rooms through the waiting-room browser query', async () => {
    const roomId = await createRoom(`${testRun}-public-owner`);
    const { data, error } = await db
      .from('gacha_rooms')
      .select('id, is_private, status')
      .eq('id', roomId)
      .eq('is_private', false)
      .eq('status', 'waiting')
      .maybeSingle();

    expect(error).toBeNull();
    expect(data).toMatchObject({ id: roomId, is_private: false, status: 'waiting' });
  });
});
