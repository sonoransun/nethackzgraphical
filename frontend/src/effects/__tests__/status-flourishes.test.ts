import { describe, it, expect } from "vitest";
import { parseHunger } from "../status-flourishes";

describe("parseHunger", () => {
  it("recognises canonical values", () => {
    expect(parseHunger("Satiated")).toBe("satiated");
    expect(parseHunger("Hungry")).toBe("hungry");
    expect(parseHunger("Weak")).toBe("weak");
    expect(parseHunger("Fainting")).toBe("fainting");
    expect(parseHunger("Starved")).toBe("starved");
  });

  it("normalises empty/whitespace to 'normal'", () => {
    expect(parseHunger("")).toBe("normal");
    expect(parseHunger("   ")).toBe("normal");
  });

  it("falls through unknowns to 'normal'", () => {
    expect(parseHunger("Peckish")).toBe("normal");
  });
});
