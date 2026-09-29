// In-memory stand-in for the Supabase client used by the app, for integration tests only.
// It models the PostgREST behaviour the app depends on: filters, embeds, RETURNING,
// single/maybeSingle, table and column grants, RLS (SELECT filters rows, UPDATE/DELETE only
// touch visible rows, INSERT/WITH CHECK violations raise 42501), BEFORE triggers, RPCs,
// auth sessions and storage. It is a model of the security rules, not the real database.

export type Row = Record<string, unknown>;
export type PgError = { code: string; message: string; details?: string | null; hint?: string | null; status?: number };
export type Result = { data: unknown; error: PgError | null };
export type PolicyCtx = { uid: string | null; fake: FakeSupabase };
type Check = (row: Row, ctx: PolicyCtx) => boolean;

export type TablePolicy = {
  select?: Check;
  insert?: Check;
  update?: { using: Check; check?: Check };
  delete?: Check;
};

export type TableGrants = { select: boolean; insert: boolean | string[]; update: boolean | string[]; delete: boolean };
export type Trigger = (op: "INSERT" | "UPDATE" | "DELETE", oldRow: Row | null, newRow: Row | null, ctx: PolicyCtx) => PgError | null;
export type RpcHandler = (args: Record<string, unknown>, ctx: PolicyCtx) => Result;
export type RequestLog = { table: string; op: "select" | "insert" | "update" | "delete" | "rpc"; values?: unknown; filters: string[]; uid: string | null };

type FakeUser = { id: string; email: string; password: string; user_metadata: Row; created_at: string };
type Filter = { column: string; describe: string; test: (value: unknown) => boolean };
type SelectItem = { kind: "all" } | { kind: "column"; name: string } | { kind: "embed"; alias: string; table: string; inner: boolean; items: SelectItem[] };
type Relation = { table: string; column: string };

let idCounter = 0;
export function fakeId(prefix = "row") {
  idCounter += 1;
  return `${prefix}-${String(idCounter).padStart(6, "0")}`;
}

export function permissionDenied(table: string): PgError {
  return { code: "42501", message: `permission denied for table ${table}` };
}

export function rlsViolation(table: string): PgError {
  return { code: "42501", message: `new row violates row-level security policy for table "${table}"` };
}

function looseEq(a: unknown, b: unknown) {
  return a === b || (a != null && b != null && String(a) === String(b));
}

function likeToRegExp(pattern: string, caseInsensitive: boolean) {
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${source}$`, caseInsensitive ? "is" : "s");
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function parseSelect(columns: string): SelectItem[] {
  const compact = columns.replace(/\s+/g, "");
  if (!compact) return [{ kind: "all" }];
  return splitTopLevel(compact).map((item): SelectItem => {
    if (item === "*") return { kind: "all" };
    const embed = item.match(/^(?:(\w+):)?(\w+)(?:!(\w+))?\((.*)\)$/);
    if (embed) {
      const [, alias, table, hint, inner] = embed;
      return { kind: "embed", alias: alias ?? table, table, inner: hint === "inner", items: parseSelect(inner) };
    }
    return { kind: "column", name: item.includes(":") ? item.split(":")[1] : item };
  });
}

function compareValues(a: unknown, b: unknown) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function makeFilter(column: string, op: string, value: unknown): Filter {
  const describe = `${column}=${op}.${Array.isArray(value) ? `(${value.join(",")})` : String(value)}`;
  switch (op) {
    case "eq":
      return { column, describe, test: (v) => looseEq(v, value) };
    case "neq":
      return { column, describe, test: (v) => !looseEq(v, value) };
    case "is":
      return { column, describe, test: (v) => (value === null ? v == null : v === value) };
    case "in":
      return { column, describe, test: (v) => (value as unknown[]).some((item) => looseEq(v, item)) };
    case "ilike":
      return { column, describe, test: (v) => v != null && likeToRegExp(String(value), true).test(String(v)) };
    case "like":
      return { column, describe, test: (v) => v != null && likeToRegExp(String(value), false).test(String(v)) };
    case "gt":
      return { column, describe, test: (v) => compareValues(v, value) > 0 };
    case "gte":
      return { column, describe, test: (v) => compareValues(v, value) >= 0 };
    case "lt":
      return { column, describe, test: (v) => compareValues(v, value) < 0 };
    case "lte":
      return { column, describe, test: (v) => compareValues(v, value) <= 0 };
    default:
      throw new Error(`Fake Supabase does not support the "${op}" filter`);
  }
}

class FakeQuery implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" = "select";
  private columns = "*";
  private returning = false;
  private values: Row | Row[] | null = null;
  private filters: Filter[] = [];
  private orFilters: Filter[][] = [];
  private embedFilters: { embed: string; filter: Filter }[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private mode: "many" | "single" | "maybeSingle" = "many";

  constructor(
    private fake: FakeSupabase,
    private table: string,
  ) {}

  select(columns = "*") {
    this.columns = columns;
    if (this.op !== "select") this.returning = true;
    return this;
  }

  insert(values: Row | Row[]) {
    this.op = "insert";
    this.values = values;
    return this;
  }

  update(values: Row) {
    this.op = "update";
    this.values = values;
    return this;
  }

  delete() {
    this.op = "delete";
    return this;
  }

  private addFilter(column: string, op: string, value: unknown) {
    const filter = makeFilter(column, op, value);
    if (column.includes(".")) {
      const [embed, ...rest] = column.split(".");
      this.embedFilters.push({ embed, filter: makeFilter(rest.join("."), op, value) });
    } else {
      this.filters.push(filter);
    }
    return this;
  }

  eq(column: string, value: unknown) {
    return this.addFilter(column, "eq", value);
  }
  neq(column: string, value: unknown) {
    return this.addFilter(column, "neq", value);
  }
  is(column: string, value: unknown) {
    return this.addFilter(column, "is", value);
  }
  in(column: string, value: unknown[]) {
    return this.addFilter(column, "in", value);
  }
  ilike(column: string, value: string) {
    return this.addFilter(column, "ilike", value);
  }
  like(column: string, value: string) {
    return this.addFilter(column, "like", value);
  }
  gt(column: string, value: unknown) {
    return this.addFilter(column, "gt", value);
  }
  gte(column: string, value: unknown) {
    return this.addFilter(column, "gte", value);
  }
  lt(column: string, value: unknown) {
    return this.addFilter(column, "lt", value);
  }
  lte(column: string, value: unknown) {
    return this.addFilter(column, "lte", value);
  }

  or(expression: string) {
    const group = splitTopLevel(expression).map((part) => {
      const [column, op, ...rest] = part.split(".");
      return makeFilter(column, op, rest.join("."));
    });
    this.orFilters.push(group);
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending ?? true });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.mode = "single";
    return this;
  }

  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onfulfilled, onrejected);
  }

  private matches(row: Row) {
    return this.filters.every((filter) => filter.test(row[filter.column])) && this.orFilters.every((group) => group.some((filter) => filter.test(row[filter.column])));
  }

  private execute(): Result {
    const fake = this.fake;
    fake.requests.push({
      table: this.table,
      op: this.op,
      values: this.values ?? undefined,
      filters: [...this.filters, ...this.orFilters.flat(), ...this.embedFilters.map((item) => ({ ...item.filter, describe: `${item.embed}.${item.filter.describe}` }))].map((filter) => filter.describe),
      uid: fake.uid,
    });

    const forced = fake.takeFailure(this.table, this.op);
    if (forced) return { data: null, error: forced };

    switch (this.op) {
      case "select":
        if (!fake.grantAllows(this.table, "select")) return { data: null, error: permissionDenied(this.table) };
        return this.finish(this.readRows());
      case "insert":
        return this.runInsert();
      case "update":
        return this.runUpdate();
      case "delete":
        return this.runDelete();
    }
  }

  private readRows() {
    const fake = this.fake;
    const items = parseSelect(this.columns);
    let rows = fake.visibleRows(this.table).filter((row) => this.matches(row));
    const projected: Row[] = [];
    for (const row of rows) {
      const result = fake.project(this.table, row, items, this.embedFilters);
      if (result) projected.push(result);
    }
    rows = projected;
    for (const { column, ascending } of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => (ascending ? 1 : -1) * compareValues(a[column], b[column]));
    }
    if (this.limitCount != null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  private finish(rows: Row[]): Result {
    if (this.mode === "many") return { data: rows, error: null };
    if (rows.length > 1 || (this.mode === "single" && rows.length === 0)) {
      return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
    }
    return { data: rows[0] ?? null, error: null };
  }

  private returned(rows: Row[]): Result {
    if (!this.returning) return { data: null, error: null };
    const items = parseSelect(this.columns);
    const projected = rows.map((row) => this.fake.project(this.table, row, items, []) ?? {});
    return this.finish(projected);
  }

  private runInsert(): Result {
    const fake = this.fake;
    const ctx = fake.ctx();
    const input = Array.isArray(this.values) ? this.values : [this.values ?? {}];
    const keys = [...new Set(input.flatMap((row) => Object.keys(row)))];
    if (!fake.grantAllows(this.table, "insert", keys)) return { data: null, error: permissionDenied(this.table) };

    const rows = input.map((row) => fake.withDefaults(this.table, { ...row }));
    const policy = fake.policies[this.table];
    for (const row of rows) {
      const triggerError = fake.triggers[this.table]?.("INSERT", null, row, ctx);
      if (triggerError) return { data: null, error: triggerError };
      if (policy && !policy.insert?.(row, ctx)) return { data: null, error: rlsViolation(this.table) };
    }
    const uniqueError = fake.uniqueViolation(this.table, rows);
    if (uniqueError) return { data: null, error: uniqueError };

    const table = fake.rows(this.table);
    table.push(...rows);
    if (this.returning && policy?.select && rows.some((row) => !policy.select?.(row, fake.ctx()))) {
      fake.tables[this.table] = table.filter((row) => !rows.includes(row));
      return { data: null, error: rlsViolation(this.table) };
    }
    return this.returned(rows);
  }

  private runUpdate(): Result {
    const fake = this.fake;
    const ctx = fake.ctx();
    const values = (this.values ?? {}) as Row;
    if (!fake.grantAllows(this.table, "update", Object.keys(values))) return { data: null, error: permissionDenied(this.table) };

    const policy = fake.policies[this.table];
    const targets = fake.rows(this.table).filter((row) => this.matches(row) && (!policy || ((policy.select?.(row, ctx) ?? false) && (policy.update?.using(row, ctx) ?? false))));
    const next = targets.map((row) => ({ ...row, ...values }));
    for (let index = 0; index < targets.length; index += 1) {
      const triggerError = fake.triggers[this.table]?.("UPDATE", targets[index], next[index], ctx);
      if (triggerError) return { data: null, error: triggerError };
      const check = policy?.update?.check ?? policy?.update?.using;
      if (policy && check && !check(next[index], ctx)) return { data: null, error: rlsViolation(this.table) };
    }
    const others = fake.rows(this.table).filter((row) => !targets.includes(row));
    const uniqueError = fake.uniqueViolation(this.table, next, others);
    if (uniqueError) return { data: null, error: uniqueError };

    targets.forEach((row, index) => Object.assign(row, next[index]));
    if (this.returning && policy?.select && targets.some((row) => !policy.select?.(row, fake.ctx()))) {
      return { data: null, error: rlsViolation(this.table) };
    }
    return this.returned(targets);
  }

  private runDelete(): Result {
    const fake = this.fake;
    const ctx = fake.ctx();
    if (!fake.grantAllows(this.table, "delete")) return { data: null, error: permissionDenied(this.table) };

    const policy = fake.policies[this.table];
    const targets = fake.rows(this.table).filter((row) => this.matches(row) && (!policy || ((policy.select?.(row, ctx) ?? false) && (policy.delete?.(row, ctx) ?? false))));
    for (const row of targets) {
      const triggerError = fake.triggers[this.table]?.("DELETE", row, null, ctx);
      if (triggerError) return { data: null, error: triggerError };
    }
    fake.tables[this.table] = fake.rows(this.table).filter((row) => !targets.includes(row));
    return this.returned(targets);
  }
}

type AuthListener = (event: string, session: { user: FakeUser } | null) => void;

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  policies: Record<string, TablePolicy> = {};
  grants: Record<string, Partial<TableGrants>> = {};
  triggers: Record<string, Trigger> = {};
  uniques: Record<string, string[][]> = {};
  relations: Record<string, Record<string, Relation>> = {};
  views: Record<string, { base: string; map: (row: Row) => Row }> = {};
  defaults: Record<string, (row: Row) => Row> = {};
  rpcs: Record<string, RpcHandler> = {};
  storageObjects = new Map<string, Blob>();
  storagePolicy: ((bucket: string, path: string, ctx: PolicyCtx) => boolean) | null = null;
  requests: RequestLog[] = [];
  users: FakeUser[] = [];
  sessionUser: FakeUser | null = null;
  mfa = { currentLevel: "aal1", nextLevel: "aal1", factors: [] as { id: string; factor_type: string; status: string }[] };
  private failures: { table: string; op: string; error: PgError; remaining: number }[] = [];
  private listeners = new Set<AuthListener>();

  get uid() {
    return this.sessionUser?.id ?? null;
  }

  reset() {
    this.tables = {};
    this.policies = {};
    this.grants = {};
    this.triggers = {};
    this.uniques = {};
    this.relations = {};
    this.views = {};
    this.defaults = {};
    this.rpcs = {};
    this.storageObjects = new Map();
    this.storagePolicy = null;
    this.requests = [];
    this.users = [];
    this.sessionUser = null;
    this.mfa = { currentLevel: "aal1", nextLevel: "aal1", factors: [] };
    this.failures = [];
    this.listeners = new Set();
  }

  ctx(): PolicyCtx {
    return { uid: this.uid, fake: this };
  }

  rows(table: string) {
    this.tables[table] ??= [];
    return this.tables[table];
  }

  /** Raw rows, bypassing RLS (what a SECURITY DEFINER function or the test itself sees). */
  all(table: string) {
    return this.rows(table);
  }

  /** Makes the next matching request fail with the given PostgREST error. */
  failNext(table: string, op: RequestLog["op"], error: PgError, times = 1) {
    this.failures.push({ table, op, error, remaining: times });
  }

  takeFailure(table: string, op: string) {
    const failure = this.failures.find((item) => item.table === table && item.op === op);
    if (!failure) return null;
    failure.remaining -= 1;
    if (failure.remaining <= 0) this.failures = this.failures.filter((item) => item !== failure);
    return failure.error;
  }

  grantAllows(table: string, op: keyof TableGrants, columns: string[] = []) {
    const base = this.views[table]?.base ?? table;
    const grant = this.grants[base]?.[op];
    if (grant === undefined || grant === true) return true;
    if (grant === false) return false;
    return columns.every((column) => grant.includes(column));
  }

  visibleRows(table: string) {
    const view = this.views[table];
    const base = view?.base ?? table;
    const policy = this.policies[base];
    const ctx = this.ctx();
    const rows = this.rows(base).filter((row) => !policy || (policy.select?.(row, ctx) ?? false));
    return view ? rows.map((row) => view.map(row)) : rows;
  }

  withDefaults(table: string, row: Row) {
    const withId = { id: row.id ?? fakeId(table), created_at: row.created_at ?? new Date().toISOString(), ...row };
    return this.defaults[table] ? this.defaults[table](withId) : withId;
  }

  uniqueViolation(table: string, rows: Row[], existing: Row[] = this.rows(table)): PgError | null {
    for (const columns of this.uniques[table] ?? []) {
      const key = (row: Row) => (columns.some((column) => row[column] == null) ? null : columns.map((column) => String(row[column])).join("|"));
      const seen = new Set(existing.map(key).filter(Boolean));
      for (const row of rows) {
        const value = key(row);
        if (value == null) continue;
        if (seen.has(value)) return { code: "23505", message: `duplicate key value violates unique constraint "${table}_${columns.join("_")}_key"` };
        seen.add(value);
      }
    }
    return null;
  }

  project(table: string, row: Row, items: SelectItem[], embedFilters: { embed: string; filter: Filter }[]): Row | null {
    const result: Row = {};
    for (const item of items) {
      if (item.kind === "all") Object.assign(result, row);
      else if (item.kind === "column") result[item.name] = row[item.name];
      else {
        const relation = this.relations[table]?.[item.table];
        if (!relation) throw new Error(`Fake Supabase has no relation ${table} -> ${item.table}`);
        const target = this.visibleRows(relation.table).find((candidate) => looseEq(candidate.id, row[relation.column]));
        const filters = embedFilters.filter((entry) => entry.embed === item.alias || entry.embed === item.table).map((entry) => entry.filter);
        const passes = target && filters.every((filter) => filter.test(target[filter.column]));
        const embedded = passes ? this.project(relation.table, target, item.items, []) : null;
        if (!embedded && item.inner) return null;
        result[item.alias] = embedded;
      }
    }
    return result;
  }

  private emit(event: string) {
    const session = this.sessionUser ? { user: this.sessionUser, access_token: "fake-token" } : null;
    for (const listener of this.listeners) queueMicrotask(() => listener(event, session));
  }

  addUser(user: { id: string; email: string; password?: string; user_metadata?: Row }) {
    const created: FakeUser = { id: user.id, email: user.email, password: user.password ?? "password123", user_metadata: user.user_metadata ?? {}, created_at: new Date().toISOString() };
    this.users.push(created);
    return created;
  }

  /** Starts a session without going through the login form. */
  signInAs(userId: string | null) {
    this.sessionUser = userId ? (this.users.find((user) => user.id === userId) ?? null) : null;
  }

  readonly client = {
    from: (table: string) => new FakeQuery(this, table),
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      this.requests.push({ table: name, op: "rpc", values: args, filters: [], uid: this.uid });
      const forced = this.takeFailure(name, "rpc");
      if (forced) return Promise.resolve({ data: null, error: forced });
      const handler = this.rpcs[name];
      if (!handler) return Promise.resolve({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${name}` } });
      return Promise.resolve(handler(args, this.ctx()));
    },
    auth: {
      signUp: async ({ email, password, options }: { email: string; password: string; options?: { data?: Row } }) => {
        if (this.users.some((user) => user.email === email)) return { data: { user: null, session: null }, error: { message: "User already registered", status: 422 } };
        const user = this.addUser({ id: fakeId("user"), email, password, user_metadata: options?.data ?? {} });
        this.sessionUser = user;
        this.emit("SIGNED_IN");
        return { data: { user, session: { user } }, error: null };
      },
      signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
        const user = this.users.find((candidate) => candidate.email === email && candidate.password === password);
        if (!user) return { data: { user: null, session: null }, error: { message: "Invalid login credentials", status: 400 } };
        this.sessionUser = user;
        this.emit("SIGNED_IN");
        return { data: { user, session: { user } }, error: null };
      },
      signOut: async () => {
        this.sessionUser = null;
        this.emit("SIGNED_OUT");
        return { error: null };
      },
      getSession: async () => ({ data: { session: this.sessionUser ? { user: this.sessionUser, access_token: "fake-token" } : null }, error: null }),
      getUser: async () => (this.sessionUser ? { data: { user: this.sessionUser }, error: null } : { data: { user: null }, error: { message: "Auth session missing!", status: 400 } }),
      updateUser: async ({ password }: { password?: string }) => {
        if (!this.sessionUser) return { data: { user: null }, error: { message: "Auth session missing!", status: 400 } };
        if (password) this.sessionUser.password = password;
        return { data: { user: this.sessionUser }, error: null };
      },
      onAuthStateChange: (listener: AuthListener) => {
        this.listeners.add(listener);
        return { data: { subscription: { unsubscribe: () => this.listeners.delete(listener) } } };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: this.mfa.currentLevel, nextLevel: this.mfa.nextLevel }, error: null }),
        listFactors: async () => ({ data: { all: this.mfa.factors, totp: this.mfa.factors.filter((factor) => factor.factor_type === "totp" && factor.status === "verified") }, error: null }),
        enroll: async () => {
          const factor = { id: fakeId("factor"), factor_type: "totp", status: "unverified" };
          this.mfa.factors.push(factor);
          return { data: { id: factor.id, totp: { qr_code: "data:image/svg+xml;fake", secret: "FAKESECRET" } }, error: null };
        },
        challenge: async ({ factorId }: { factorId: string }) => ({ data: { id: `challenge-${factorId}` }, error: null }),
        verify: async ({ factorId, code }: { factorId: string; code: string }) => {
          if (code !== "123456") return { data: null, error: { message: "Invalid TOTP code entered" } };
          const factor = this.mfa.factors.find((item) => item.id === factorId);
          if (factor) factor.status = "verified";
          this.mfa.currentLevel = "aal2";
          return { data: { user: this.sessionUser }, error: null };
        },
        unenroll: async ({ factorId }: { factorId: string }) => {
          this.mfa.factors = this.mfa.factors.filter((factor) => factor.id !== factorId);
          return { data: { id: factorId }, error: null };
        },
      },
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, file: Blob) => {
          if (this.storagePolicy && !this.storagePolicy(bucket, path, this.ctx())) return { data: null, error: { message: "new row violates row-level security policy", statusCode: "403" } };
          this.storageObjects.set(`${bucket}/${path}`, file);
          return { data: { path }, error: null };
        },
        remove: async (paths: string[]) => {
          if (this.storagePolicy && paths.some((path) => !this.storagePolicy?.(bucket, path, this.ctx()))) return { data: null, error: { message: "new row violates row-level security policy", statusCode: "403" } };
          for (const path of paths) this.storageObjects.delete(`${bucket}/${path}`);
          return { data: paths.map((name) => ({ name })), error: null };
        },
        createSignedUrl: async (path: string) => {
          if (this.storagePolicy && !this.storagePolicy(bucket, path, this.ctx())) return { data: null, error: { message: "Object not found", statusCode: "404" } };
          return { data: { signedUrl: `https://storage.test/${bucket}/${path}?token=fake` }, error: null };
        },
      }),
    },
  };
}

export const fake = new FakeSupabase();
export const fakeClient = fake.client;
