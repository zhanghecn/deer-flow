import { describe, expect, it } from "vitest";

import {
  humanMessagePlugins,
  streamdownPlugins,
  streamdownUrlTransform,
} from "./plugins";

function extractRemarkMathOptions(
  plugins: unknown,
): Record<string, unknown> | null {
  if (!Array.isArray(plugins)) {
    return null;
  }

  for (const plugin of plugins) {
    if (!Array.isArray(plugin) || plugin.length < 2) {
      continue;
    }
    const options = plugin[1];
    if (options && typeof options === "object") {
      return options as Record<string, unknown>;
    }
  }

  return null;
}

describe("streamdown math options", () => {
  it("disables single-dollar math parsing for assistant messages", () => {
    const options = extractRemarkMathOptions(streamdownPlugins.remarkPlugins);

    expect(options?.singleDollarTextMath).toBe(false);
  });

  it("disables single-dollar math parsing for human messages", () => {
    const options = extractRemarkMathOptions(humanMessagePlugins.remarkPlugins);

    expect(options?.singleDollarTextMath).toBe(false);
  });
});

describe("streamdown url transform", () => {
  it("preserves knowledge citation links", () => {
    expect(
      streamdownUrlTransform("kb://citation?artifact_path=/mnt/user-data/outputs/doc.pdf"),
    ).toBe("kb://citation?artifact_path=/mnt/user-data/outputs/doc.pdf");
  });

  it("keeps safe web links and strips unsafe protocols", () => {
    expect(streamdownUrlTransform("https://example.com")).toBe(
      "https://example.com",
    );
    expect(streamdownUrlTransform("javascript:alert(1)")).toBe("");
  });
});
