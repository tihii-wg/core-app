// Core App security model for the fake Supabase client.
// workspace_members follows supabase/migrations/20260928200000_team_members_rls.sql.
// The other tables follow the rules the app was hardened against (their policies are not in
// the repo): members read/write their workspace's data, services are managed by owner/admin,
// order_services is SELECT/INSERT only, workspaces cannot be deleted and only the owner may
// update them, owner_id is immutable, profiles are own-row only.
import { fake, permissionDenied, type PgError, type PolicyCtx, type Row } from "./fakeSupabase";

export const USERS = {
  owner: { id: "11111111-1111-4111-8111-111111111111", email: "owner@example.com", name: "Olga Owner" },
  admin: { id: "22222222-2222-4222-8222-222222222222", email: "admin@example.com", name: "Adam Admin" },
  manager: { id: "33333333-3333-4333-8333-333333333333", email: "manager@example.com", name: "Mia Manager" },
  member: { id: "44444444-4444-4444-8444-444444444444", email: "member@example.com", name: "Max Member" },
  outsider: { id: "55555555-5555-4555-8555-555555555555", email: "outsider@example.com", name: "Otto Outsider" },
  newbie: { id: "66666666-6666-4666-8666-666666666666", email: "newbie@example.com", name: "Nina Newbie" },
} as const;

export const WS = {
  A: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  B: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  C: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

export const INDUSTRY_ID = "99999999-9999-4999-8999-999999999999";
export const PASSWORD = "password123";

const roleRank: Record<string, number> = { owner: 0, admin: 1, manager: 2, member: 3 };

/** Mirrors public.workspace_member_role(uuid): the caller's role in an active workspace, or null. */
export function roleIn(workspaceId: unknown, ctx: PolicyCtx) {
  if (!ctx.uid) return null;
  const workspace = ctx.fake.all("workspaces").find((row) => row.id === workspaceId);
  if (!workspace || workspace.deleted_at) return null;
  const roles = ctx.fake
    .all("workspace_members")
    .filter((row) => row.workspace_id === workspaceId && row.user_id === ctx.uid && !row.deleted_at)
    .map((row) => String(row.role))
    .sort((a, b) => (roleRank[a] ?? 9) - (roleRank[b] ?? 9));
  return roles[0] ?? null;
}

const isMember = (workspaceId: unknown, ctx: PolicyCtx) => roleIn(workspaceId, ctx) != null;
const canManageServices = (workspaceId: unknown, ctx: PolicyCtx) => ["owner", "admin"].includes(roleIn(workspaceId, ctx) ?? "");

function canManageRole(workspaceId: unknown, targetRole: unknown, ctx: PolicyCtx) {
  const role = roleIn(workspaceId, ctx);
  if (role === "owner") return ["admin", "manager", "member"].includes(String(targetRole));
  if (role === "admin") return ["manager", "member"].includes(String(targetRole));
  return false;
}

function canBootstrap(workspaceId: unknown, ctx: PolicyCtx) {
  const workspace = ctx.fake.all("workspaces").find((row) => row.id === workspaceId);
  return Boolean(workspace && workspace.owner_id === ctx.uid && !workspace.deleted_at) && !ctx.fake.all("workspace_members").some((row) => row.workspace_id === workspaceId);
}

const memberTable = {
  select: (row: Row, ctx: PolicyCtx) => isMember(row.workspace_id, ctx),
  insert: (row: Row, ctx: PolicyCtx) => isMember(row.workspace_id, ctx),
  update: { using: (row: Row, ctx: PolicyCtx) => isMember(row.workspace_id, ctx) },
  delete: (row: Row, ctx: PolicyCtx) => isMember(row.workspace_id, ctx),
};

function error(message: string): PgError {
  return { code: "42501", message };
}

export function installSecurityModel() {
  fake.relations = {
    orders: { clients: { table: "clients", column: "client_id" } },
    workspace_members: { workspaces: { table: "workspaces", column: "workspace_id" } },
    workspaces: { industries: { table: "industries", column: "industry_id" } },
  };
  fake.views = {
    inventory_items_with_status: {
      base: "inventory_items",
      map: (row) => {
        const quantity = Number(row.quantity ?? 0);
        const min = Number(row.min_quantity ?? 0);
        return { ...row, stock_status: quantity <= 0 ? "out_of_stock" : quantity <= min ? "low_stock" : "in_stock" };
      },
    },
  };
  fake.defaults = {
    workspaces: (row) => ({ deleted_at: null, inventory_markup: 0, avatar_path: null, timezone: "Europe/Chisinau", currency: "MDL", ...row }),
    workspace_members: (row) => ({ deleted_at: null, ...row }),
    clients: (row) => ({ balance: 0, ...row }),
    services: (row) => ({ category: null, ...row }),
    orders: (row) => ({ updated_at: row.created_at, ...row }),
    inventory_items: (row) => ({ updated_at: row.created_at, ...row }),
  };
  fake.uniques = { inventory_items: [["workspace_id", "sku"]] };

  fake.policies = {
    industries: { select: (row) => row.is_active !== false },
    profiles: {
      select: (row, ctx) => row.id === ctx.uid,
      insert: (row, ctx) => row.id === ctx.uid,
      update: { using: (row, ctx) => row.id === ctx.uid },
    },
    workspaces: {
      select: (row, ctx) => isMember(row.id, ctx) || (row.owner_id === ctx.uid && !row.deleted_at),
      insert: (row, ctx) => row.owner_id === ctx.uid,
      update: { using: (row, ctx) => roleIn(row.id, ctx) === "owner" },
    },
    workspace_members: {
      select: (row, ctx) =>
        (!row.deleted_at && (row.user_id === ctx.uid || isMember(row.workspace_id, ctx))) || (Boolean(row.deleted_at) && row.user_id !== ctx.uid && canManageRole(row.workspace_id, row.role, ctx)),
      insert: (row, ctx) =>
        !row.deleted_at && ((row.user_id !== ctx.uid && canManageRole(row.workspace_id, row.role, ctx)) || (row.user_id === ctx.uid && row.role === "owner" && canBootstrap(row.workspace_id, ctx))),
      update: {
        using: (row, ctx) => row.user_id !== ctx.uid && canManageRole(row.workspace_id, row.role, ctx),
        check: (row, ctx) => row.user_id !== ctx.uid && canManageRole(row.workspace_id, row.role, ctx),
      },
    },
    services: {
      select: (row, ctx) => isMember(row.workspace_id, ctx),
      insert: (row, ctx) => canManageServices(row.workspace_id, ctx),
      update: { using: (row, ctx) => canManageServices(row.workspace_id, ctx) },
      delete: (row, ctx) => canManageServices(row.workspace_id, ctx),
    },
    clients: memberTable,
    employees: memberTable,
    orders: memberTable,
    inventory_items: memberTable,
    order_services: {
      select: (row, ctx) => isMember(ctx.fake.all("orders").find((order) => order.id === row.order_id)?.workspace_id, ctx),
      insert: (row, ctx) => isMember(ctx.fake.all("orders").find((order) => order.id === row.order_id)?.workspace_id, ctx),
    },
  };

  fake.grants = {
    workspaces: { delete: false },
    profiles: { delete: false },
    workspace_members: { insert: ["workspace_id", "user_id", "role"], update: ["role", "deleted_at"], delete: false },
    order_services: { update: false, delete: false },
  };

  fake.triggers = {
    workspaces: (op, oldRow, newRow) => {
      if (op === "UPDATE" && oldRow && newRow && newRow.owner_id !== oldRow.owner_id) return error("owner_id cannot be changed");
      return null;
    },
    workspace_members: (op, oldRow, newRow, ctx) => {
      if (op === "INSERT" && newRow) {
        if (newRow.role === "owner" && !(newRow.user_id === ctx.uid && canBootstrap(newRow.workspace_id, ctx))) return error("Owner memberships cannot be created through team management");
        return null;
      }
      if (op === "UPDATE" && oldRow && newRow) {
        if (newRow.workspace_id !== oldRow.workspace_id || newRow.user_id !== oldRow.user_id) return error("workspace_id and user_id cannot be changed");
        if (oldRow.role === "owner" || newRow.role === "owner") return error("The workspace owner cannot be changed through team management");
        return null;
      }
      if (oldRow?.role === "owner") return error("The workspace owner cannot be removed through team management");
      return null;
    },
  };

  fake.rpcs = {
    workspace_member_profiles: ({ target_workspace }, ctx) => {
      if (!isMember(target_workspace, ctx)) return { data: [], error: null };
      const members = ctx.fake.all("workspace_members").filter((row) => row.workspace_id === target_workspace && !row.deleted_at);
      const profiles = members.flatMap((member) => ctx.fake.all("profiles").filter((profile) => profile.id === member.user_id));
      return { data: profiles.map((profile) => ({ user_id: profile.id, full_name: profile.full_name, email: profile.email })), error: null };
    },
    workspace_member_find_user: ({ target_workspace, member_email }, ctx) => {
      if (!["owner", "admin"].includes(roleIn(target_workspace, ctx) ?? "")) return { data: null, error: error("You do not have permission to add team members") };
      const email = String(member_email).trim().toLowerCase();
      return { data: ctx.fake.users.find((user) => user.email.toLowerCase() === email)?.id ?? null, error: null };
    },
    soft_delete_workspace: ({ target_workspace }, ctx) => {
      if (roleIn(target_workspace, ctx) !== "owner") return { data: null, error: error("Only the workspace owner can delete this workspace") };
      const now = new Date().toISOString();
      for (const row of ctx.fake.all("workspaces")) if (row.id === target_workspace && !row.deleted_at) row.deleted_at = now;
      for (const row of ctx.fake.all("workspace_members")) if (row.workspace_id === target_workspace && !row.deleted_at) row.deleted_at = now;
      return { data: null, error: null };
    },
  };

  fake.storagePolicy = (bucket, path, ctx) => bucket === "workspace" && isMember(path.split("/")[0], ctx);
}

export { permissionDenied };

type SeedWorkspace = { id: string; name: string; owner: string; members: [string, string][]; clients: string[]; services: [string, number, string?][]; employees: [string, string | null, string?][]; inventory: [string, string, number, number][] };

const seedWorkspaces: SeedWorkspace[] = [
  {
    id: WS.A,
    name: "Alpha Garage",
    owner: USERS.owner.id,
    members: [
      [USERS.admin.id, "admin"],
      [USERS.manager.id, "manager"],
      [USERS.member.id, "member"],
    ],
    clients: ["Ada Alpha"],
    services: [
      ["Oil change", 40],
      ["Brake check", 25, "inactive"],
    ],
    employees: [
      ["Tom Tech", USERS.member.id],
      ["Tina Tech", USERS.manager.id],
    ],
    inventory: [["Alpha brake pads", "AP-1", 2, 5]],
  },
  {
    id: WS.B,
    name: "Beta Service",
    owner: USERS.owner.id,
    members: [[USERS.admin.id, "member"]],
    clients: ["Bob Beta"],
    services: [["Beta wash", 15]],
    employees: [["Bert Beta", USERS.owner.id]],
    inventory: [["Beta filter", "BF-1", 10, 2]],
  },
  {
    id: WS.C,
    name: "Gamma Motors",
    owner: USERS.outsider.id,
    members: [],
    clients: ["Gus Gamma"],
    services: [["Gamma tune", 99]],
    employees: [["Greg Gamma", USERS.outsider.id]],
    inventory: [["Gamma oil", "GO-1", 0, 1]],
  },
];

const activeWorkspace: Record<string, string | null> = {
  [USERS.owner.id]: WS.A,
  [USERS.admin.id]: WS.A,
  [USERS.manager.id]: WS.A,
  [USERS.member.id]: WS.A,
  [USERS.outsider.id]: WS.C,
  [USERS.newbie.id]: null,
};

/** Resets the fake and loads three isolated workspaces (A, B owned by Olga; C by an outsider). */
export function seedCoreApp() {
  fake.reset();
  installSecurityModel();

  fake.all("industries").push({ id: INDUSTRY_ID, name: "Auto Repair & Service", slug: "auto_repair", description: null, is_active: true, created_at: "2026-01-01T00:00:00.000Z" });

  for (const user of Object.values(USERS)) {
    fake.addUser({ id: user.id, email: user.email, password: PASSWORD });
    fake.all("profiles").push({ id: user.id, full_name: user.name, email: user.email, phone: null, active_workspace_id: activeWorkspace[user.id], theme: "light" });
  }

  const year = new Date().getFullYear();
  for (const workspace of seedWorkspaces) {
    const letter = workspace.id[0];
    fake.all("workspaces").push({
      id: workspace.id,
      name: workspace.name,
      owner_id: workspace.owner,
      industry_id: INDUSTRY_ID,
      deleted_at: null,
      avatar_path: null,
      inventory_markup: 20,
      language: "en",
      timezone: "Europe/Chisinau",
      date_format: "DD.MM.YYYY",
      currency: "MDL",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    fake.all("workspace_members").push({ workspace_id: workspace.id, user_id: workspace.owner, role: "owner", deleted_at: null, created_at: "2026-01-01T00:00:00.000Z" });
    workspace.members.forEach(([userId, role], index) => fake.all("workspace_members").push({ workspace_id: workspace.id, user_id: userId, role, deleted_at: null, created_at: `2026-01-0${index + 2}T00:00:00.000Z` }));

    workspace.clients.forEach((name, index) =>
      fake.all("clients").push({ id: `client-${letter}${index + 1}`, workspace_id: workspace.id, name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: "+37361111111", address: "", notes: "", client_type: "individual", tax_id: null, contact_person: null, balance: 0, created_at: "2026-02-01T10:00:00.000Z" }),
    );
    workspace.services.forEach(([name, price, status], index) =>
      fake.all("services").push({ id: `service-${letter}${index + 1}`, workspace_id: workspace.id, service_name: name, service_price: price, description: `${name} description`, status: status ?? "active", category: null }),
    );
    workspace.employees.forEach(([name, profileId, role], index) =>
      fake.all("employees").push({ id: `employee-${letter}${index + 1}`, workspace_id: workspace.id, name, email: `${name.split(" ")[0].toLowerCase()}@example.com`, phone: "+37362222222", role: role ?? "technician", status: "active", profile_id: profileId }),
    );
    workspace.inventory.forEach(([name, sku, quantity, min], index) =>
      fake.all("inventory_items").push({ id: `item-${letter}${index + 1}`, workspace_id: workspace.id, name, sku, description: null, category: "Parts", quantity, min_quantity: min, unit: "pcs", purchase_price: 10, selling_price: 12, supplier: null, location: null, is_active: true, created_at: "2026-03-01T00:00:00.000Z", updated_at: "2026-03-01T00:00:00.000Z" }),
    );

    const service = fake.all("services").find((row) => row.workspace_id === workspace.id)!;
    const employee = fake.all("employees").find((row) => row.workspace_id === workspace.id)!;
    fake.all("orders").push({
      id: `order-${letter}1`,
      workspace_id: workspace.id,
      client_id: `client-${letter}1`,
      number: `ORD-${year}-001`,
      device: `${workspace.name} car`,
      car_number: `${letter.toUpperCase()}AA111`,
      description: "Noise",
      status: "new",
      assigned_to: employee.profile_id,
      deadline: `${year}-12-01T00:00:00.000Z`,
      total_price: service.service_price,
      is_paid: false,
      service: service.service_name,
      service_id: service.id,
      created_at: `${year}-02-10T10:00:00.000Z`,
      updated_at: `${year}-02-10T10:00:00.000Z`,
    });
    fake.all("order_services").push({ id: `line-${letter}1`, order_id: `order-${letter}1`, service_id: service.id, service_name: service.service_name, price: service.service_price, quantity: 1 });
  }
}

export function row(table: string, id: string) {
  return fake.all(table).find((item) => item.id === id);
}

export function membership(workspaceId: string, userId: string) {
  return fake.all("workspace_members").find((item) => item.workspace_id === workspaceId && item.user_id === userId);
}

/** Names of every row visible in the given table for the current session. */
export function namesIn(table: string, workspaceId: string, column = "name") {
  return fake
    .all(table)
    .filter((item) => item.workspace_id === workspaceId)
    .map((item) => String(item[column]));
}
