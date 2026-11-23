import { isLinkInfo, type LinkInfo } from "./api";

const KEY = "url-shortener:links";
export const MAX_LINKS = 10;

export function loadLinks(): LinkInfo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isLinkInfo).slice(0, MAX_LINKS);
  } catch {
    return [];
  }
}

export function saveLinks(links: LinkInfo[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(links.slice(0, MAX_LINKS)));
  } catch {
    // storage unavailable: the list just won't persist
  }
}
