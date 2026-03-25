import { getCurrentLocale } from "@/i18n";

export function formatDate(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString(getCurrentLocale(), {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return "-";
  const d = new Date(ts);
  return d.toLocaleString(getCurrentLocale(), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatAgo(ts: string | null | undefined): string {
  if (!ts) return "-";
  const diff = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diff / 1000);
  const relativeTime = new Intl.RelativeTimeFormat(getCurrentLocale(), {
    numeric: "auto",
  });
  if (sec < 60) return relativeTime.format(-sec, "second");
  const min = Math.floor(sec / 60);
  if (min < 60) return relativeTime.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return relativeTime.format(-hr, "hour");
  const day = Math.floor(hr / 24);
  return relativeTime.format(-day, "day");
}

export function maskString(
  value: string | null | undefined,
  head = 4,
  tail = 4,
): string {
  if (!value) return "-";
  if (value.length <= head + tail) return value;
  return value.slice(0, head) + "****" + value.slice(-tail);
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
