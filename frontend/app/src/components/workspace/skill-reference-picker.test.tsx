import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  getNextPickerIndex,
  SkillReferencePicker,
} from "./skill-reference-picker";

const suggestions = [
  {
    id: "skill:frontend-design",
    title: "$frontend-design",
    description: "Design UI",
    value: "$frontend-design ",
    badge: "design",
  },
  {
    id: "skill:copywriting",
    title: "$copywriting",
    description: "Write copy",
    value: "$copywriting ",
    badge: "writing",
  },
];

describe("SkillReferencePicker", () => {
  it("renders a listbox with a bounded list", () => {
    render(
      <SkillReferencePicker
        label="Skills"
        suggestions={suggestions}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );

    const list = screen.getByRole("listbox");
    expect(list).toBeInTheDocument();
    expect(list.className).toContain("max-h-[320px]");
    expect(screen.getByRole("option", { name: /\$frontend-design/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("supports wrap and page navigation helpers", () => {
    expect(getNextPickerIndex(0, "up", 2)).toBe(1);
    expect(getNextPickerIndex(1, "down", 2)).toBe(0);
    expect(getNextPickerIndex(5, "page_up", 10)).toBe(0);
    expect(getNextPickerIndex(0, "page_down", 10)).toBe(6);
  });
});
