"use client";

import {
  PromptInputCommand,
  PromptInputCommandItem,
  PromptInputCommandList,
} from "@/components/ai-elements/prompt-input";
import { cn } from "@/lib/utils";

export type QuickInsertSuggestion = {
  id: string;
  title: string;
  description: string;
  value: string;
  badge?: string;
};

const VISIBLE_ITEM_COUNT = 6;

export function getNextPickerIndex(
  currentIndex: number,
  direction: "up" | "down" | "page_up" | "page_down",
  itemCount: number,
) {
  if (itemCount <= 0) {
    return -1;
  }

  const current = currentIndex < 0 ? 0 : currentIndex;

  if (direction === "up") {
    return current === 0 ? itemCount - 1 : current - 1;
  }

  if (direction === "down") {
    return current === itemCount - 1 ? 0 : current + 1;
  }

  if (direction === "page_up") {
    return Math.max(0, current - VISIBLE_ITEM_COUNT);
  }

  return Math.min(itemCount - 1, current + VISIBLE_ITEM_COUNT);
}

export function SkillReferencePicker({
  label,
  suggestions,
  selectedIndex,
  onSelect,
}: {
  label: string;
  suggestions: QuickInsertSuggestion[];
  selectedIndex: number;
  onSelect: (suggestion: QuickInsertSuggestion) => void;
}) {
  return (
    <div className="bg-background/95 w-full max-w-(--container-width-md) rounded-2xl border p-2 shadow-lg backdrop-blur">
      <div className="text-muted-foreground px-2 py-1 text-[11px] uppercase tracking-[0.18em]">
        {label}
      </div>
      <PromptInputCommand className="bg-transparent">
        <PromptInputCommandList
          className="max-h-[320px]"
          role="listbox"
          aria-label={label}
        >
          {suggestions.map((suggestion, index) => {
            const selected = index === selectedIndex;

            return (
              <PromptInputCommandItem
                key={suggestion.id}
                value={suggestion.id}
                role="option"
                aria-selected={selected}
                className={cn(
                  "group rounded-xl px-3 py-2",
                  selected && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSelect(suggestion);
                }}
                onSelect={() => onSelect(suggestion)}
              >
                <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-sm">{suggestion.title}</div>
                    <div className="text-muted-foreground group-aria-selected:text-accent-foreground/80 mt-1 line-clamp-2 text-xs">
                      {suggestion.description}
                    </div>
                  </div>
                  {suggestion.badge ? (
                    <span className="text-muted-foreground group-aria-selected:text-accent-foreground/80 shrink-0 rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em]">
                      {suggestion.badge}
                    </span>
                  ) : null}
                </div>
              </PromptInputCommandItem>
            );
          })}
        </PromptInputCommandList>
      </PromptInputCommand>
    </div>
  );
}
