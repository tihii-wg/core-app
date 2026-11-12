import { afterEach, describe, expect, it } from "vitest";
import { resetOrderLineCommentsSupport } from "../../services/apiOrders";
import { canAccessOrderLineComments } from "./lineCommentsVisibility";

describe("canAccessOrderLineComments", () => {
  afterEach(() => {
    resetOrderLineCommentsSupport();
  });

  it("allows owner in private mode and everyone in public mode", () => {
    expect(canAccessOrderLineComments({ visibility: "private", isOwner: true, supported: true })).toBe(true);
    expect(canAccessOrderLineComments({ visibility: "private", isOwner: false, supported: true })).toBe(false);
    expect(canAccessOrderLineComments({ visibility: "public", isOwner: false, supported: true })).toBe(true);
  });

  it("hides UI when the table/RPC is not supported yet", () => {
    expect(canAccessOrderLineComments({ visibility: "public", isOwner: true, supported: false })).toBe(false);
  });
});
