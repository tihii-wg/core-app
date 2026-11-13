import { describe, expect, it } from "vitest";
import { isProtectedSemantic, type StatusSemanticAction } from "./apiStatusDefinitions";

describe("status semantic accept", () => {
  it("does not treat accept as an order close/cancel protected semantic", () => {
    expect(isProtectedSemantic("close")).toBe(true);
    expect(isProtectedSemantic("cancel")).toBe(true);
    expect(isProtectedSemantic("accept")).toBe(false);
    expect(isProtectedSemantic("normal")).toBe(false);
  });

  it("keeps accept in the StatusSemanticAction union", () => {
    const action: StatusSemanticAction = "accept";
    expect(action).toBe("accept");
  });
});
