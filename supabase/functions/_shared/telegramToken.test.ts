import { describe, expect, it } from "vitest";
import { extractBotToken } from "./telegram.ts";

const TOKEN = "7123456789:AAHk3xYz-AbCdEfGhIjKlMnOpQrStUvWxYz0";

describe("extractBotToken", () => {
  it("returns a clean token as is", () => {
    expect(extractBotToken(TOKEN)).toBe(TOKEN);
  });
  it("finds the token inside a pasted BotFather message, quotes or spaces", () => {
    expect(extractBotToken(`Use this token to access the HTTP API:\n${TOKEN}\nKeep your token secure`)).toBe(TOKEN);
    expect(extractBotToken(` "${TOKEN}" `)).toBe(TOKEN);
  });
  it("leaves non-token input unchanged (getMe then reports it)", () => {
    expect(extractBotToken("MyCoolBot")).toBe("MyCoolBot");
    expect(extractBotToken(undefined)).toBe("");
  });
});
