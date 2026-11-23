export const DEFAULT_BASE_URL = "http://localhost:5000";

/** Returns BASE_URL without a trailing slash; throws a clear message if it is not a valid http(s) URL. */
export function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? DEFAULT_BASE_URL).trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("BASE_URL is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("BASE_URL must start with http:// or https://");
  }
  return value.replace(/\/+$/, "");
}
