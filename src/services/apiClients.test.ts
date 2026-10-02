import { describe, expect, it } from "vitest";
import { toClient } from "./apiClients";

describe("client records", () => {
  it("keeps the stored individual client type", () => {
    expect(
      toClient({
        id: "client-1",
        name: "Ada Lovelace",
        client_type: "individual",
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

  it("does not invent a client type when the row has none or an unknown one", () => {
    expect(toClient({ id: "client-3", name: "No Type" }).client_type).toBeNull();
    expect(toClient({ id: "client-4", name: "Odd Type", client_type: "company" }).client_type).toBeNull();
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
