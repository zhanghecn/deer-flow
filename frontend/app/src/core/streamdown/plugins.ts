import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { StreamdownProps } from "streamdown";

const safeProtocol = /^(https?|ircs?|mailto|xmpp)$/i;

export function streamdownUrlTransform(url: string) {
  if (url.startsWith("kb://")) {
    return url;
  }

  const colon = url.indexOf(":");
  const questionMark = url.indexOf("?");
  const numberSign = url.indexOf("#");
  const slash = url.indexOf("/");

  if (
    colon === -1 ||
    (slash !== -1 && colon > slash) ||
    (questionMark !== -1 && colon > questionMark) ||
    (numberSign !== -1 && colon > numberSign) ||
    safeProtocol.test(url.slice(0, colon))
  ) {
    return url;
  }

  return "";
}

export const streamdownPlugins = {
  remarkPlugins: [
    remarkGfm,
    [remarkMath, { singleDollarTextMath: false }],
  ] as StreamdownProps["remarkPlugins"],
  rehypePlugins: [
    rehypeRaw,
    [rehypeKatex, { output: "html" }],
  ] as StreamdownProps["rehypePlugins"],
  urlTransform: streamdownUrlTransform,
};

export const workspaceMessageRehypePlugins = [
  [rehypeKatex, { output: "html" }],
] as StreamdownProps["rehypePlugins"];

export const workspaceMessagePlugins = {
  remarkPlugins: streamdownPlugins.remarkPlugins,
  rehypePlugins: workspaceMessageRehypePlugins,
  urlTransform: streamdownUrlTransform,
} satisfies Pick<StreamdownProps, "remarkPlugins" | "rehypePlugins" | "urlTransform">;

// Plugins for human messages - no autolink to prevent URL bleeding into adjacent text
export const humanMessagePlugins = {
  remarkPlugins: [
    // Use remark-gfm without autolink literals by not including it
    // Only include math support for human messages
    [remarkMath, { singleDollarTextMath: false }],
  ] as StreamdownProps["remarkPlugins"],
  rehypePlugins: [
    [rehypeKatex, { output: "html" }],
  ] as StreamdownProps["rehypePlugins"],
};
