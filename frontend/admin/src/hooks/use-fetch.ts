import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";

interface FetchState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

interface UseFetchReturn<T> extends FetchState<T> {
  refetch: () => void;
  mutate: (data: T) => void;
}

export function useFetch<T>(
  path: string | null,
  options?: { interval?: number },
): UseFetchReturn<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    isLoading: !!path,
    error: null,
  });
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    if (!path) return;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const data = await api<T>(path);
      if (mountedRef.current) {
        setState({ data, isLoading: false, error: null });
      }
    } catch (err) {
      if (mountedRef.current) {
        const msg =
          err instanceof ApiError ? err.message : "An error occurred";
        setState((s) => ({ ...s, isLoading: false, error: msg }));
      }
    }
  }, [path]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    let timer: ReturnType<typeof setInterval> | undefined;
    if (options?.interval && path) {
      timer = setInterval(fetchData, options.interval);
    }
    return () => {
      mountedRef.current = false;
      if (timer) clearInterval(timer);
    };
  }, [fetchData, options?.interval, path]);

  const mutate = useCallback((data: T) => {
    setState({ data, isLoading: false, error: null });
  }, []);

  return { ...state, refetch: fetchData, mutate };
}
