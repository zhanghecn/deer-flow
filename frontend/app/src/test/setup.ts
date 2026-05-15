import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, vi } from "vitest";

class ResizeObserverMock {
  observe() {
    return undefined;
  }

  unobserve() {
    return undefined;
  }

  disconnect() {
    return undefined;
  }
}

if (!("ResizeObserver" in globalThis)) {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
}

// Sigma inspects WebGL constructor globals during module import. jsdom has no
// WebGL runtime, but these unit tests only import graph components rather than
// rendering a real canvas.
if (!("WebGLRenderingContext" in globalThis)) {
  Object.defineProperty(globalThis, "WebGLRenderingContext", {
    configurable: true,
    writable: true,
    value: class WebGLRenderingContextMock {},
  });
}

if (!("WebGL2RenderingContext" in globalThis)) {
  Object.defineProperty(globalThis, "WebGL2RenderingContext", {
    configurable: true,
    writable: true,
    value: class WebGL2RenderingContextMock {},
  });
}

if (!("scrollIntoView" in Element.prototype)) {
  (Element.prototype as Element & { scrollIntoView: () => void }).scrollIntoView =
    vi.fn();
}

vi.mock("katex/dist/katex.min.css", () => ({}));
vi.mock("streamdown", () => ({
  defaultRehypePlugins: {
    harden: () => undefined,
    katex: () => undefined,
    raw: () => undefined,
  },
  Streamdown: ({
    children,
    ...props
  }: {
    children?: ReactNode;
  }) => {
    void props;
    return children ?? null;
  },
}));

afterEach(() => {
  cleanup();
});
