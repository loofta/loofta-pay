/**
 * A tiny in-memory stand-in for the Supabase client, enough for the calls the agent services make
 * (insert / select / update / delete with eq, neq, in, gt, gte, lt, is, not, contains, or, order,
 * limit, single, maybeSingle). Tests only; it keeps the services' real query code under test.
 */
type Row = Record<string, any>;
export class TestDb {
  tables: Record<string, Row[]> = {};
  private seq = 0;
  rows(t: string) { return (this.tables[t] ??= []); }
  getClient() { return { from: (t: string) => new Query(this, t) }; }
  nextId() { return `id-${++this.seq}`; }
}

class Query implements PromiseLike<{ data: any; error: any }> {
  private filters: Array<(r: Row) => boolean> = [];
  private mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
  private patch: Row | Row[] = {};
  private wantRows = false;
  private orderBy: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private expect: 'many' | 'single' | 'maybe' = 'many';
  constructor(private db: TestDb, private table: string) {}

  insert(v: Row | Row[]) { this.mode = 'insert'; this.patch = v; return this; }
  update(v: Row) { this.mode = 'update'; this.patch = v; return this; }
  delete() { this.mode = 'delete'; return this; }
  select(_cols?: string, _opts?: any) { this.wantRows = true; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: any) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  gt(c: string, v: any) { this.filters.push((r) => r[c] > v); return this; }
  gte(c: string, v: any) { this.filters.push((r) => r[c] >= v); return this; }
  lt(c: string, v: any) { this.filters.push((r) => r[c] < v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c: string, op: string, v: any) { if (op === 'is') this.filters.push((r) => (v === null ? r[c] != null : r[c] !== v)); return this; }
  contains(c: string, v: any[]) { this.filters.push((r) => Array.isArray(r[c]) && v.every((x) => r[c].includes(x))); return this; }
  or(_expr: string) { return this; }
  order(col: string, o?: { ascending?: boolean }) { this.orderBy = { col, asc: o?.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.expect = 'single'; return this; }
  maybeSingle() { this.expect = 'maybe'; return this; }

  private run(): { data: any; error: any } {
    const all = this.db.rows(this.table);
    const match = () => all.filter((r) => this.filters.every((f) => f(r)));
    let out: Row[] = [];
    if (this.mode === 'insert') {
      const list = Array.isArray(this.patch) ? this.patch : [this.patch];
      for (const v of list) {
        const row = { id: this.db.nextId(), created_at: new Date().toISOString(), ...v };
        const uniq = this.uniqueClash(row);
        if (uniq) return { data: null, error: { code: '23505', message: `duplicate key (${uniq})` } };
        all.push(row);
        out.push(row);
      }
    } else if (this.mode === 'update') {
      out = match();
      for (const r of out) Object.assign(r, this.patch);
    } else if (this.mode === 'delete') {
      out = match();
      this.db.tables[this.table] = all.filter((r) => !out.includes(r));
    } else {
      out = match();
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy;
      out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    }
    if (this.lim != null) out = out.slice(0, this.lim);
    if (this.mode !== 'select' && !this.wantRows) return { data: null, error: null };
    if (this.expect === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'expected one row' } };
    if (this.expect === 'maybe') return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }

  /** Columns the real tables declare UNIQUE, for the clash checks the services rely on. */
  private uniqueClash(row: Row): string | null {
    const uniques: Record<string, string[][]> = {
      agent_sessions: [['token_hash']],
      agent_device_codes: [['device_code_hash'], ['user_code']],
      agent_actions: [['session_id', 'idempotency_key']],
      agent_oauth_codes: [['code_hash']],
    };
    for (const cols of uniques[this.table] ?? []) {
      if (this.db.rows(this.table).some((r) => cols.every((c) => r[c] === row[c] && row[c] != null))) return cols.join('+');
    }
    return null;
  }

  then<R1 = any, R2 = never>(ok?: ((v: { data: any; error: any }) => R1 | PromiseLike<R1>) | null, err?: ((e: any) => R2 | PromiseLike<R2>) | null) {
    return Promise.resolve(this.run()).then(ok, err);
  }
}
