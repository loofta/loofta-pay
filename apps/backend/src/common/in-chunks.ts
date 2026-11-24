/**
 * Supabase sends `.in('id', [...])` as part of the web address. 100 ids fit; 1,000 ids (a full partner batch) do not,
 * and the request is refused. These helpers split a long list into short groups and join the results.
 */
export const IN_CHUNK = 100;

export function chunkList<T>(items: T[], size = IN_CHUNK): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('chunk size must be a positive integer');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type DbError = { message: string; code?: string } | null;

/** Reads rows for a long list of ids, one short query per group. Stops at the first error and returns it. */
export async function selectInChunks<T>(
  ids: string[],
  run: (group: string[]) => PromiseLike<{ data: T[] | null; error: DbError }>,
  size = IN_CHUNK,
): Promise<{ data: T[]; error: DbError }> {
  const rows: T[] = [];
  for (const group of chunkList(ids, size)) {
    const { data, error } = await run(group);
    if (error) return { data: rows, error };
    rows.push(...(data ?? []));
  }
  return { data: rows, error: null };
}

/** Writes to a long list of ids, one short query per group. Stops at the first error and returns it. */
export async function updateInChunks(ids: string[], run: (group: string[]) => PromiseLike<{ error: DbError }>, size = IN_CHUNK): Promise<{ error: DbError }> {
  for (const group of chunkList(ids, size)) {
    const { error } = await run(group);
    if (error) return { error };
  }
  return { error: null };
}
