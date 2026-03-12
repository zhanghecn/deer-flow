import type { Element, Root, ElementContent } from "hast";
import { useMemo } from "react";
import { visit } from "unist-util-visit";
import type { BuildVisitor } from "unist-util-visit";

const ENABLE_STREAMING_WORD_ANIMATION = false;

export function rehypeSplitWordsIntoSpans() {
  return (tree: Root) => {
    visit(tree, "element", ((node: Element) => {
      if (
        ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "strong"].includes(
          node.tagName,
        ) &&
        node.children
      ) {
        const newChildren: Array<ElementContent> = [];
        node.children.forEach((child) => {
          if (child.type === "text") {
            const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
            const segments = segmenter.segment(child.value);
            const words = Array.from(segments)
              .map((segment) => segment.segment)
              .filter(Boolean);
            words.forEach((word: string) => {
              newChildren.push({
                type: "element",
                tagName: "span",
                properties: {
                  className: "animate-fade-in",
                },
                children: [{ type: "text", value: word }],
              });
            });
          } else {
            newChildren.push(child);
          }
        });
        node.children = newChildren;
      }
    }) as BuildVisitor<Root, "element">);
  };
}

export function useRehypeSplitWordsIntoSpans(enabled = true) {
  const rehypePlugins = useMemo(
    // Word-by-word span animation causes excessive DOM churn during live
    // streams, which amplifies thinking/tool updates into visible jank.
    () =>
      enabled && ENABLE_STREAMING_WORD_ANIMATION
        ? [rehypeSplitWordsIntoSpans]
        : [],
    [enabled],
  );
  return rehypePlugins;
}
