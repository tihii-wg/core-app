import { beforeEach, describe, expect, it } from "vitest";
import {
  isClientDetailTab,
  peekClientDetailTab,
  readClientDetailTabOnOpen,
  resetClientDetailTabSession,
  writeClientDetailTab,
} from "./clientDetailTabs";

describe("clientDetailTabs session", () => {
  beforeEach(() => {
    resetClientDetailTabSession();
  });

  it("starts on general the first time the sheet opens", () => {
    expect(readClientDetailTabOnOpen()).toBe("general");
  });

  it("remembers the selected tab across subsequent opens and client switches", () => {
    readClientDetailTabOnOpen();
    writeClientDetailTab("payments");
    expect(peekClientDetailTab()).toBe("payments");
    expect(readClientDetailTabOnOpen()).toBe("payments");
  });

  it("validates tab ids", () => {
    expect(isClientDetailTab("assets")).toBe(true);
    expect(isClientDetailTab("documents")).toBe(true);
    expect(isClientDetailTab("history")).toBe(false);
  });
});
