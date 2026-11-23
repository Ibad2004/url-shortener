import type { LinkInfo } from "./api";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export function expiryLabel(link: Pick<LinkInfo, "expiresAt">, now: number = Date.now()): string {
  if (link.expiresAt === null) return "Never expires";
  const ms = new Date(link.expiresAt).getTime() - now;
  if (Number.isNaN(ms)) return "Never expires";
  if (ms <= 0) return "Expired";
  if (ms > DAY) return `Expires in ${plural(Math.ceil(ms / DAY), "day")}`;
  if (ms > HOUR) return `Expires in ${plural(Math.ceil(ms / HOUR), "hour")}`;
  return `Expires in ${plural(Math.max(1, Math.ceil(ms / MINUTE)), "minute")}`;
}

export function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
