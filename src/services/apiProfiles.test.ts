import { describe, expect, it } from "vitest";
import { profileUpdateFields, toProfile } from "./apiProfiles";

describe("profile records", () => {
  it("keeps an existing name, email, and phone", () => {
    expect(
      toProfile({
        id: "user-1",
        full_name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+37361111111",
        active_workspace_id: "ws-1",
      }),
    ).toEqual({
      id: "user-1",
      full_name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+37361111111",
      active_workspace_id: "ws-1",
    });
  });

  it("treats missing personal fields as empty", () => {
    expect(toProfile({ id: "user-2" })).toEqual({
      id: "user-2",
      full_name: null,
      email: null,
      phone: null,
      active_workspace_id: null,
    });
  });
});

describe("profile updates", () => {
  it("saves the name and clears an empty phone", () => {
    expect(profileUpdateFields({ fullName: "  Maria Pop  ", phone: "  " })).toEqual({
      full_name: "Maria Pop",
      phone: null,
    });
  });

  it("rejects a blank name", () => {
    expect(() => profileUpdateFields({ fullName: "   ", phone: "" })).toThrow("Full name is required");
  });

  it("rejects a phone that is not in international format", () => {
    expect(() => profileUpdateFields({ fullName: "Maria Pop", phone: "061111111" })).toThrow(/international format/);
  });
});
