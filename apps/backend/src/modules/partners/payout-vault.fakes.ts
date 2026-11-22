/** In-memory stand-ins for the database and the services around the payout vault, for its tests only. */
type Row = Record<string, any>;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  private n = 0;
  rows(t: string): Row[] { return (this.tables[t] ??= []); }
  from(table: string) { return new FakeQuery(this, table); }
  nextId() { return `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`; }
}

class FakeQuery {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private payload: any;
  private opts: any;
  private wantRows = false;
  constructor(private db: FakeDb, private table: string) {}
  private countWanted = false;
  private max = Infinity;
  select(_c?: string, o?: { count?: string }) { this.wantRows = true; this.countWanted = !!o?.count; return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] > v); return this; }
  order() { return this; }
  limit(n: number) { this.max = n; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: unknown) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] < v); return this; }
  insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
  update(p: any) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: any, o?: any) { this.op = 'upsert'; this.payload = p; this.opts = o; return this; }
  private run(): { data: any; error: any } {
    const rows = this.db.rows(this.table);
    if (this.op === 'select') {
      const data = rows.filter((r) => this.filters.every((f) => f(r))).slice(0, this.max);
      return { data, error: null, ...(this.countWanted ? { count: data.length } : {}) } as { data: any; error: any };
    }
    if (this.op === 'update') {
      const hit = rows.filter((r) => this.filters.every((f) => f(r)));
      hit.forEach((r) => Object.assign(r, this.payload));
      return { data: hit, error: null };
    }
    const list: Row[] = Array.isArray(this.payload) ? this.payload : [this.payload];
    const made: Row[] = [];
    for (const p of list) {
      if (this.op === 'upsert' && this.opts?.onConflict) {
        const keys = String(this.opts.onConflict).split(',');
        if (rows.some((r) => keys.every((k) => r[k] === p[k]))) continue;
      }
      const row = { id: this.db.nextId(), created_at: new Date().toISOString(), ...p };
      rows.push(row);
      made.push(row);
    }
    return { data: made, error: null };
  }
  maybeSingle() { const r = this.run(); return Promise.resolve({ data: r.data[0] ?? null, error: r.error }); }
  single() { const r = this.run(); return Promise.resolve({ data: r.data[0] ?? null, error: r.data[0] ? null : { message: 'no row' } }); }
  then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(this.run()).then(resolve, reject); }
}

export function fakeSupabase(db: FakeDb) {
  const t = (name: string) => () => db.from(name);
  return {
    get payoutVaults() { return db.from('payout_vaults'); },
    get payoutVaultExits() { return db.from('payout_vault_exits'); },
    get payoutVaultCredits() { return db.from('payout_vault_credits'); },
    get partnerPaymentFeeLines() { return db.from('partner_payment_fee_lines'); },
    get partners() { return db.from('partners'); },
    get users() { return db.from('users'); },
    get supportThreads() { return db.from('support_threads'); },
    get supportMessages() { return db.from('support_messages'); },
    getClient() { return { from: (t: string) => db.from(t) }; },
    get partnerMembers() { return db.from('partner_members'); },
    get partnerAuditLog() { return db.from('partner_audit_log'); },
    get payoutBatches() { return db.from('payout_batches'); },
    _t: t,
  };
}

export const fakeRedis = { withLock: async <T,>(_k: string, fn: () => Promise<T>) => fn() };
