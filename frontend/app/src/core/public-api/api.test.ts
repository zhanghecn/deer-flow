import { describe, expect, it } from "vitest";

import { resolvePublicAPIURL } from "./api";

describe("resolvePublicAPIURL", () => {
  it("appends API-base suffixes without dropping reverse-proxy prefixes", () => {
    expect(
      resolvePublicAPIURL(
        "http://192.168.0.20:8089/xxx/xxx/v1",
        "/files/file_1/content",
      ),
    ).toBe("http://192.168.0.20:8089/xxx/xxx/v1/files/file_1/content");
  });
});
