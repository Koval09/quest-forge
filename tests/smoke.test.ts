import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("Smoke test", () => {
  it("exports version", () => {
    expect(VERSION).toBe("0.1.0");
  });
});
