import { describe, expect, it } from "vitest";

import {
  humanMessagePlugins,
  rehypeNormalizeRelativeResourceLinks,
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

  it("normalizes bare relative resource paths so hardening keeps links clickable", () => {
    expect(streamdownUrlTransform("管理规范/人力资源/各种补贴标准")).toBe(
      "/管理规范/人力资源/各种补贴标准",
    );
    expect(
      streamdownUrlTransform(
        "%E7%AE%A1%E7%90%86%E8%A7%84%E8%8C%83/%E4%BA%BA%E5%8A%9B",
      ),
    ).toBe("/%E7%AE%A1%E7%90%86%E8%A7%84%E8%8C%83/%E4%BA%BA%E5%8A%9B");
    expect(streamdownUrlTransform("./管理规范/人力资源/各种补贴标准")).toBe(
      "./管理规范/人力资源/各种补贴标准",
    );
  });
});

describe("relative resource rehype plugin", () => {
  it("normalizes hrefs before hardening can block them", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "a",
          properties: {
            href: "%E7%AE%A1%E7%90%86%E8%A7%84%E8%8C%83/%E4%BA%BA%E5%8A%9B",
          },
          children: [{ type: "text", value: "resource" }],
        },
      ],
    };

    rehypeNormalizeRelativeResourceLinks()(tree);
    const link = tree.children[0];

    expect(link?.properties.href).toBe(
      "/%E7%AE%A1%E7%90%86%E8%A7%84%E8%8C%83/%E4%BA%BA%E5%8A%9B",
    );
  });
});
