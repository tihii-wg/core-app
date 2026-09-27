import { describe, expect, it } from "vitest";
import { toClient } from "./apiClients";

describe("client records", () => {
  it("treats a missing client type as an individual", () => {
    expect(
      toClient({
        id: "client-1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+37361111111",
        address: "",
        balance: 0,
        created_at: "2024-07-01T10:00:00.000Z",
      }),
    ).toMatchObject({
      client_type: "individual",
      tax_id: null,
      contact_person: null,
      name: "Ada Lovelace",
    });
  });

  it("keeps organization tax id and contact person", () => {
    expect(
      toClient({
        id: "client-2",
        name: "Acme SRL",
        client_type: "organization",
        tax_id: "1234567",
        contact_person: "Maria Pop",
        email: "office@acme.test",
        phone: "+37362222222",
        address: "",
        balance: "0",
        created_at: "2024-07-02T10:00:00.000Z",
      }),
    ).toMatchObject({
      client_type: "organization",
      name: "Acme SRL",
      tax_id: "1234567",
      contact_person: "Maria Pop",
    });
  });
});
