import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { ensureSignupBootstrap, joinTeamRegisterUrl, signUp } from "./apiAuth";

const authSignUp = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn());

vi.mock("./supabase", () => ({
  default: {
    auth: { signUp: authSignUp },
    from,
  },
}));

function profileSelect(result: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: () => Promise.resolve(result),
      }),
    }),
  };
}

function profileInsert(result: { error: unknown }) {
  return {
    insert: () => Promise.resolve(result),
  };
}

function membersSelect(result: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        is: () => ({
          limit: () => ({
            maybeSingle: () => Promise.resolve(result),
          }),
        }),
      }),
    }),
  };
}

describe("signUp / ensureSignupBootstrap", () => {
  beforeEach(() => {
    authSignUp.mockReset();
    from.mockReset();
  });

  it("join mode creates profile only when a session is returned", async () => {
    const user = {
      id: "user-join",
      email: "join@example.com",
      user_metadata: { ownerName: "Jo", signup_mode: "join", phone: "", companyName: "" },
    };
    authSignUp.mockResolvedValue({ data: { user, session: { user } }, error: null });

    const calls: string[] = [];
    from.mockImplementation((table: string) => {
      calls.push(table);
      if (table === "profiles") {
        if (calls.filter((t) => t === "profiles").length === 1) {
          return profileSelect({ data: null, error: null });
        }
        return profileInsert({ error: null });
      }
      if (table === "workspace_members") return membersSelect({ data: null, error: null });
      if (table === "workspaces") throw new Error("join mode must not create a workspace");
      throw new Error(table);
    });

    await expect(
      signUp({
        mode: "join",
        ownerName: "Jo",
        email: "join@example.com",
        password: "secret1",
      }),
    ).resolves.toMatchObject({ mode: "join", workspace: null, needsEmailConfirmation: false });

    expect(authSignUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "join@example.com",
        options: expect.objectContaining({
          data: expect.objectContaining({ signup_mode: "join", companyName: "" }),
        }),
      }),
    );
    expect(calls.includes("workspaces")).toBe(false);
  });

  it("own mode still creates workspace when session exists", async () => {
    const user = {
      id: "user-create",
      email: "owner@example.com",
      user_metadata: {
        ownerName: "Olga",
        signup_mode: "create",
        companyName: "Garage",
        phone: "+37360000000",
      },
    };
    authSignUp.mockResolvedValue({ data: { user, session: { user } }, error: null });

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            }),
          }),
          insert: () => Promise.resolve({ error: null }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === "workspace_members") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
        chain.insert = () => Promise.resolve({ error: null });
        return chain;
      }
      if (table === "workspaces") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: null, error: null }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: { id: "ws-new" }, error: null }),
            }),
          }),
        };
      }
      throw new Error(table);
    });

    await expect(
      signUp({
        mode: "create",
        companyName: "Garage",
        ownerName: "Olga",
        email: "owner@example.com",
        phone: "+37360000000",
        password: "secret1",
      }),
    ).resolves.toMatchObject({
      mode: "create",
      workspace: { id: "ws-new" },
      needsEmailConfirmation: false,
    });
  });

  it("never recreates a workspace for an existing user who has no memberships left", async () => {
    const user = {
      id: "user-old-owner",
      email: "old@example.com",
      user_metadata: { signup_mode: "create", ownerName: "Ion", companyName: "Old Garage" },
    } as unknown as User;
    const workspaceInsert = vi.fn();
    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: user.id, active_workspace_id: null }, error: null }),
            }),
          }),
        };
      }
      if (table === "workspace_members") {
        const chain: Record<string, unknown> = {};
        chain.select = () => chain;
        chain.eq = () => chain;
        chain.is = () => chain;
        chain.limit = () => chain;
        chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
        return chain;
      }
      if (table === "workspaces") return { insert: workspaceInsert };
      throw new Error(table);
    });

    await expect(ensureSignupBootstrap(user)).resolves.toEqual({ workspace: null, mode: "create" });
    expect(workspaceInsert).not.toHaveBeenCalled();
  });

  it("returns needsEmailConfirmation without writing when there is no session", async () => {
    const user = { id: "u1", email: "a@b.com", user_metadata: { signup_mode: "join" } };
    authSignUp.mockResolvedValue({ data: { user, session: null }, error: null });
    from.mockImplementation(() => {
      throw new Error("no writes without session");
    });

    await expect(
      signUp({ mode: "join", ownerName: "A", email: "a@b.com", password: "secret1" }),
    ).resolves.toMatchObject({ needsEmailConfirmation: true, workspace: null, mode: "join" });
    expect(from).not.toHaveBeenCalled();
  });

  it("ensureSignupBootstrap is idempotent and never creates a workspace for join mode", async () => {
    const user = {
      id: "user-join",
      email: "join@example.com",
      user_metadata: { signup_mode: "join", ownerName: "Jo" },
    } as unknown as User;

    from.mockImplementation((table: string) => {
      if (table === "profiles") {
        return profileSelect({ data: { id: "user-join", active_workspace_id: null }, error: null });
      }
      if (table === "workspaces") throw new Error("join must not touch workspaces");
      throw new Error(table);
    });

    await expect(ensureSignupBootstrap(user)).resolves.toEqual({ workspace: null, mode: "join" });
  });

  it("builds a join registration URL with encoded email", () => {
    expect(joinTeamRegisterUrl("ru", "a+b@example.com", "https://app.example")).toBe(
      "https://app.example/ru/register?mode=join&email=a%2Bb%40example.com",
    );
  });
});
