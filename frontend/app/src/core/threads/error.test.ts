import { describe, expect, it } from "vitest";

import { normalizeThreadError, shouldIgnoreThreadError } from "./error";

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

  it("unwraps wrapped provider errors into readable messages", () => {
    expect(
      normalizeThreadError("APIConnectionError('Connection error.')"),
    ).toBe("Connection error.");

    expect(
      normalizeThreadError(
        "RateLimitError('Error code: 429 - {\\'error\\': {\\'message\\': \"We\\'re receiving too many requests right now.\"}, \\'type\\': \\'error\\'}')",
      ),
    ).toBe("429 We're receiving too many requests right now.");
  });

  it("identifies local cancellation errors that should stay silent", () => {
    expect(shouldIgnoreThreadError(new Error("CancelledError"))).toBe(true);
    expect(shouldIgnoreThreadError("CancelledError()")).toBe(true);
    expect(
      shouldIgnoreThreadError({
        name: "AbortError",
        message: "The operation was aborted.",
      }),
    ).toBe(true);
    expect(shouldIgnoreThreadError(new Error("Connection error"))).toBe(false);
  });

  it("falls back to a generic message", () => {
    expect(normalizeThreadError(null)).toBe(
      "Something went wrong while running the conversation.",
    );
  });
});
