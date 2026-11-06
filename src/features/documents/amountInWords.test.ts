import { describe, expect, it } from "vitest";
import { amountInWords } from "./amountInWords";

describe("amountInWords", () => {
  it("handles 0, 1, 21 and 1234.56 in en/ro/ru", () => {
    expect(amountInWords(0, "en")).toMatch(/zero lei and 00 bani/i);
    expect(amountInWords(1, "en")).toMatch(/one leu and 00 bani/i);
    expect(amountInWords(21, "en")).toMatch(/twenty-one lei and 00 bani/i);
    expect(amountInWords(1234.56, "en")).toMatch(/one thousand two hundred thirty-four lei and 56 bani/i);

    expect(amountInWords(0, "ro")).toMatch(/zero lei 00 bani/i);
    expect(amountInWords(1, "ro")).toMatch(/unu leu 00 bani/i);
    expect(amountInWords(21, "ro")).toMatch(/douăzeci și unu lei 00 bani/i);
    expect(amountInWords(1234.56, "ro")).toMatch(/o mie două sute treizeci și patru lei 56 bani/i);

    expect(amountInWords(0, "ru")).toMatch(/ноль леев 00 баней/i);
    expect(amountInWords(1, "ru")).toMatch(/один лей 00 баней/i);
    expect(amountInWords(21, "ru")).toMatch(/двадцать один лей 00 баней/i);
    expect(amountInWords(1234.56, "ru")).toMatch(/одна тысяча двести тридцать четыре лея 56 баней/i);
  });
});
