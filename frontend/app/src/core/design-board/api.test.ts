import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readDesignBoardDocument,
} from "./api";
import type { DesignBoardDocumentReadError } from "./api";

describe("readDesignBoardDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the HTTP status on failed bridge reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: "temporary gateway failure" }),
      } satisfies Partial<Response>),
    );

    await expect(
      readDesignBoardDocument({
        access_token: "token-1",
      }),
    ).rejects.toMatchObject({
      name: "DesignBoardDocumentReadError",
      message: "temporary gateway failure",
      statusCode: 500,
    } satisfies Partial<DesignBoardDocumentReadError>);
  });
});
