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

if (!("scrollIntoView" in Element.prototype)) {
  (Element.prototype as Element & { scrollIntoView: () => void }).scrollIntoView =
    vi.fn();
}

vi.mock("katex/dist/katex.min.css", () => ({}));
vi.mock("streamdown", () => ({
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
