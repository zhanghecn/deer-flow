import { describe, expect, it } from "vitest";

import { inferWorkbenchSurfaceFromMessages } from "./history";

describe("workspace surface history inference", () => {
  it("infers the design surface from structured tool paths", () => {
    expect(
      inferWorkbenchSurfaceFromMessages([
        {
          id: "ai-1",
          type: "ai",
          content: "",
          tool_calls: [
            {
              id: "tool-1",
              name: "edit_file",
              args: {
                file_path: "/mnt/user-data/outputs/designs/canvas.op",
              },
            },
          ],
        },
      ] as never),
    ).toEqual({
      surface: "design",
      target_path: "/mnt/user-data/outputs/designs/canvas.op",
    });
  });

  it("does not infer surfaces from free-form prose alone", () => {
    expect(
      inferWorkbenchSurfaceFromMessages([
        {
          id: "ai-1",
          type: "ai",
          content: "请继续修改设计稿 /mnt/user-data/outputs/designs/canvas.op",
          tool_calls: [],
        },
      ] as never),
    ).toBeNull();
  });
});
