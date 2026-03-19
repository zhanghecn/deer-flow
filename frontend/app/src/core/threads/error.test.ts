import { describe, expect, it } from "vitest";

import { normalizeThreadError } from "./error";

describe("normalizeThreadError", () => {
  it("prefers error messages", () => {
    expect(normalizeThreadError(new Error("Connection error"))).toBe(
      "Connection error",
    );
    expect(normalizeThreadError({ message: "429 Too Many Requests" })).toBe(
      "429 Too Many Requests",
    );
  });

  it("extracts structured HTTP errors from JSON payloads", () => {
    expect(
      normalizeThreadError(
        new Error('HTTP 429: {"error":"429 Too Many Requests"}'),
      ),
    ).toBe("429 Too Many Requests");

    expect(
      normalizeThreadError('{"detail":"Temporary upstream failure"}'),
    ).toBe("Temporary upstream failure");
  });

  it("falls back to a generic message", () => {
    expect(normalizeThreadError(null)).toBe(
      "Something went wrong while running the conversation.",
    );
  });
});
