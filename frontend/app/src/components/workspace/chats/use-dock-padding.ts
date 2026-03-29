import { useCallback, useEffect, useState } from "react";

const DEFAULT_MESSAGE_LIST_PADDING = 240;
const DEFAULT_DOCK_CLEARANCE = 40;

export function useDockPadding({
  minimum = DEFAULT_MESSAGE_LIST_PADDING,
  extra = DEFAULT_DOCK_CLEARANCE,
}: {
  minimum?: number;
  extra?: number;
} = {}) {
  const [dockElement, setDockElement] = useState<HTMLDivElement | null>(null);
  const [paddingBottom, setPaddingBottom] = useState(minimum);

  const dockRef = useCallback((node: HTMLDivElement | null) => {
    setDockElement(node);
  }, []);

  useEffect(() => {
    if (!dockElement) {
      setPaddingBottom(minimum);
      return;
    }

    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const nextPadding = Math.max(
          minimum,
          Math.ceil(dockElement.getBoundingClientRect().height) + extra,
        );
        setPaddingBottom((current) =>
          current === nextPadding ? current : nextPadding,
        );
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dockElement);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [dockElement, extra, minimum]);

  return {
    dockRef,
    paddingBottom,
  };
}
