export interface LinkInfo {
  code: string;
  shortUrl: string;
  url: string;
  clicks: number;
  createdAt: string;
  expiresAt: string | null;
  expired: boolean;
}

export type ExpiresIn = "1h" | "1d" | "7d" | "30d" | null;

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:5000").replace(/\/+$/, "");

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class NetworkError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isLinkInfo(value: unknown): value is LinkInfo {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.shortUrl === "string" &&
    typeof value.url === "string" &&
    typeof value.clicks === "number" &&
    typeof value.createdAt === "string" &&
    (value.expiresAt === null || typeof value.expiresAt === "string") &&
    typeof value.expired === "boolean"
  );
}

async function call(path: string, init?: RequestInit): Promise<LinkInfo> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new NetworkError("Can't reach the shortener");
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message = isRecord(body) && typeof body.error === "string" ? body.error : "Something went wrong";
    throw new ApiError(res.status, message);
  }
  if (!isLinkInfo(body)) throw new ApiError(res.status, "Unexpected reply from the server");
  return body;
}

export function createLink(url: string, expiresIn: ExpiresIn): Promise<LinkInfo> {
  return call("/api/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, expiresIn }),
  });
}

export function fetchLink(code: string): Promise<LinkInfo> {
  return call(`/api/links/${encodeURIComponent(code)}`);
}
