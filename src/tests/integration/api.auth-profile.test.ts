import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentUser, login, logOut, signUp } from "../../services/apiAuth";
import { getProfile, updateProfile, updateProfileTheme } from "../../services/apiProfiles";
import { getIndustries, resolveIndustryId } from "../../services/apiIndustries";
import { cancelTotpEnrollment, disableTotp, enrollTotp, getMfaStatus, verifyTotp } from "../../services/apiMfa";
import { changePassword } from "../../services/apiPassword";
import { fake } from "../fakeSupabase";
import { INDUSTRY_ID, PASSWORD, USERS, WS, membership, row, seedCoreApp } from "../coreAppDb";

vi.mock("../../services/supabase", async () => ({ default: (await import("../fakeSupabase")).fakeClient }));

beforeEach(() => {
  seedCoreApp();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllGlobals());

describe("authentication", () => {
  it("logs in with valid credentials and rejects invalid ones with a generic message", async () => {
    await expect(login({ email: USERS.owner.email, password: "wrong" })).rejects.toThrow("Invalid login or password");
    expect(fake.uid).toBeNull();

    const result = await login({ email: USERS.owner.email, password: PASSWORD });
    expect(result).toMatchObject({ mfaRequired: false, factorId: null });
    expect(fake.uid).toBe(USERS.owner.id);
  });

  it("asks for a second factor when the account has one", async () => {
    fake.mfa = { currentLevel: "aal1", nextLevel: "aal2", factors: [{ id: "factor-1", factor_type: "totp", status: "verified" }] };
    expect(await login({ email: USERS.owner.email, password: PASSWORD })).toMatchObject({ mfaRequired: true, factorId: "factor-1" });
  });

  it("signs out again when MFA is required but no factor can be found", async () => {
    fake.mfa = { currentLevel: "aal1", nextLevel: "aal2", factors: [] };
    await expect(login({ email: USERS.owner.email, password: PASSWORD })).rejects.toThrow("Unable to start two-factor verification. Please try again.");
    expect(fake.uid).toBeNull();
  });

  it("reports the current user only while a session exists", async () => {
    expect(await getCurrentUser()).toBeNull();
    fake.signInAs(USERS.member.id);
    expect((await getCurrentUser())?.id).toBe(USERS.member.id);
    await logOut();
    expect(await getCurrentUser()).toBeNull();
  });

  it("signs up: creates profile, workspace, owner membership and sets the active workspace", async () => {
    const { user, workspace } = await signUp({ companyName: "Fresh Garage", ownerName: "Fred", email: "fred@example.com", phone: "+37360000001", password: "secret1", industryId: "auto_repair" });

    expect(row("profiles", user.id)).toMatchObject({ full_name: "Fred", email: "fred@example.com", active_workspace_id: workspace.id });
    expect(row("workspaces", workspace.id)).toMatchObject({ name: "Fresh Garage", owner_id: user.id, industry_id: INDUSTRY_ID });
    expect(membership(workspace.id, user.id)).toMatchObject({ role: "owner" });
  });

  it("rejects signing up with an email that is already registered", async () => {
    await expect(signUp({ companyName: "X", ownerName: "X", email: USERS.owner.email, password: "secret1", industryId: "auto_repair" })).rejects.toThrow("User already registered");
  });
});

describe("profile", () => {
  it("reads and updates only the caller's own profile", async () => {
    fake.signInAs(USERS.member.id);
    expect(await getProfile()).toMatchObject({ id: USERS.member.id, full_name: "Max Member", active_workspace_id: WS.A, theme: "light" });

    expect(await updateProfile({ fullName: " Max M. ", phone: "+37369999999" })).toMatchObject({ full_name: "Max M.", phone: "+37369999999" });
    expect(await updateProfileTheme("dark")).toMatchObject({ theme: "dark" });
    expect(row("profiles", USERS.owner.id)?.full_name).toBe("Olga Owner");
  });

  it("validates name and phone before writing", async () => {
    fake.signInAs(USERS.member.id);
    await expect(updateProfile({ fullName: " ", phone: "" })).rejects.toThrow("Full name is required");
    await expect(updateProfile({ fullName: "Max", phone: "069" })).rejects.toThrow("Phone must be in international format, such as +37300000000");
    expect(fake.requests.filter((item) => item.op === "update")).toHaveLength(0);
  });

  it("requires a session", async () => {
    await expect(getProfile()).rejects.toThrow("Auth session missing!");
  });

  it("returns null when the profile row does not exist yet", async () => {
    fake.signInAs(USERS.member.id);
    fake.tables.profiles = fake.all("profiles").filter((item) => item.id !== USERS.member.id);
    expect(await getProfile()).toBeNull();
  });
});

describe("industries", () => {
  it("lists active industries and resolves ids by uuid or slug", async () => {
    fake.signInAs(USERS.member.id);
    expect((await getIndustries()).map((item) => item.slug)).toEqual(["auto_repair"]);
    expect(await resolveIndustryId(INDUSTRY_ID)).toBe(INDUSTRY_ID);
    expect(await resolveIndustryId("auto_repair")).toBe(INDUSTRY_ID);
    await expect(resolveIndustryId("space_travel")).rejects.toThrow("Selected business type was not found");
  });
});

describe("two-factor authentication", () => {
  beforeEach(() => fake.signInAs(USERS.owner.id));

  it("enrolls, verifies and disables a TOTP factor", async () => {
    const enrollment = await enrollTotp();
    expect(enrollment).toMatchObject({ secret: "FAKESECRET" });
    await expect(verifyTotp(enrollment.factorId, "12 34")).rejects.toThrow("Invalid verification code.");
    await verifyTotp(enrollment.factorId, "123 456");
    expect(await getMfaStatus()).toMatchObject({ enabled: true, factorId: enrollment.factorId, currentLevel: "aal2" });

    await expect(enrollTotp()).rejects.toThrow("Two-factor authentication is already enabled.");
    await disableTotp(enrollment.factorId);
    expect((await getMfaStatus()).enabled).toBe(false);
  });

  it("cancels an unfinished enrollment", async () => {
    const enrollment = await enrollTotp();
    await cancelTotpEnrollment(enrollment.factorId);
    expect(fake.mfa.factors).toEqual([]);
  });
});

describe("change password", () => {
  it("checks the current password before updating", async () => {
    fake.signInAs(USERS.owner.id);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    await expect(changePassword({ currentPassword: "bad", newPassword: "newsecret" })).rejects.toThrow("Current password is incorrect.");
    expect(fake.users.find((user) => user.id === USERS.owner.id)?.password).toBe(PASSWORD);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    await changePassword({ currentPassword: PASSWORD, newPassword: "newsecret" });
    expect(fake.users.find((user) => user.id === USERS.owner.id)?.password).toBe("newsecret");
  });

  it("rejects a short password and an expired session", async () => {
    await expect(changePassword({ currentPassword: PASSWORD, newPassword: "123" })).rejects.toThrow();
    await expect(changePassword({ currentPassword: PASSWORD, newPassword: "newsecret" })).rejects.toThrow("Your session has expired. Please sign in again.");
  });
});
