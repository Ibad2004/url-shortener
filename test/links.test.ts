import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { Link } from "../src/link.model.js";

const BASE = "http://localhost:5000";
let mongod: MongoMemoryServer;
const app = createApp({ baseUrl: BASE });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "test" });
  await Link.init();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Link.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function create(url = "https://example.com/some/long/path") {
  const res = await request(app).post("/api/links").send({ url });
  return res;
}

describe("POST /api/links", () => {
  it("creates a link (201)", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[a-zA-Z0-9]{7}$/);
    expect(res.body.shortUrl).toBe(`${BASE}/${res.body.code}`);
    expect(res.body).toMatchObject({ url: "https://example.com/some/long/path", clicks: 0 });
    expect(res.body.createdAt).toBeTypeOf("string");
  });

  it("gives a new code each time for the same URL", async () => {
    const a = await create();
    const b = await create();
    expect(a.body.code).not.toBe(b.body.code);
  });

  it.each([
    ["not a URL", "hello"],
    ["javascript:", "javascript:alert(1)"],
    ["ftp:", "ftp://example.com/file"],
    ["empty", ""],
    ["too long", "https://example.com/" + "a".repeat(2100)],
    ["credentials", "https://user:pass@example.com/"],
    ["own host", "http://localhost:5000/abc1234"],
  ])("rejects %s with 400", async (_name, url) => {
    const res = await create(url);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTypeOf("string");
  });

  it("rejects a missing url and invalid JSON with 400", async () => {
    expect((await request(app).post("/api/links").send({})).status).toBe(400);
    const bad = await request(app).post("/api/links").set("Content-Type", "application/json").send("{oops");
    expect(bad.status).toBe(400);
  });

  it("rejects a huge body with 413", async () => {
    const res = await request(app).post("/api/links").send({ url: "x".repeat(20000) });
    expect(res.status).toBe(413);
  });

  it("retries when the generated code collides", async () => {
    const codes = ["aaaaaaa", "aaaaaaa", "bbbbbbb"];
    const forced = createApp({ baseUrl: BASE, generateCode: () => codes.shift() ?? "ccccccc" });
    const first = await request(forced).post("/api/links").send({ url: "https://example.com/1" });
    const second = await request(forced).post("/api/links").send({ url: "https://example.com/2" });
    expect(first.body.code).toBe("aaaaaaa");
    expect(second.status).toBe(201);
    expect(second.body.code).toBe("bbbbbbb");
  });

  it("gives up with 500 after 5 collisions", async () => {
    await Link.create({ code: "aaaaaaa", url: "https://example.com/x" });
    const stuck = createApp({ baseUrl: BASE, generateCode: () => "aaaaaaa" });
    const res = await request(stuck).post("/api/links").send({ url: "https://example.com/2" });
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
  });
});

describe("GET /:code", () => {
  it("redirects with 302, Location, no-store and counts a click", async () => {
    const { body } = await create("https://example.com/target");
    const res = await request(app).get(`/${body.code}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com/target");
    expect(res.headers["cache-control"]).toBe("no-store");
    const stats = await request(app).get(`/api/links/${body.code}`);
    expect(stats.body.clicks).toBe(1);
  });

  it("counts exactly 10 clicks for 10 simultaneous redirects", async () => {
    const { body } = await create();
    await Promise.all(Array.from({ length: 10 }, () => request(app).get(`/${body.code}`)));
    const stats = await request(app).get(`/api/links/${body.code}`);
    expect(stats.body.clicks).toBe(10);
  });

  it("HEAD redirects but does not count", async () => {
    const { body } = await create();
    const res = await request(app).head(`/${body.code}`);
    expect(res.status).toBe(302);
    expect((await request(app).get(`/api/links/${body.code}`)).body.clicks).toBe(0);
  });

  it.each(["abcdefg", "short", "toolongcode1", "abc-123"])("unknown/malformed %s → 404 JSON", async (code) => {
    const res = await request(app).get(`/${code}`).set("Accept", "application/json");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Link not found" });
  });

  it("404 is friendly HTML for a browser", async () => {
    const res = await request(app).get("/abcdefg").set("Accept", "text/html,application/xhtml+xml");
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("This short link doesn't exist");
  });
});

describe("GET /api/links/:code", () => {
  it("returns stats without counting a click", async () => {
    const { body } = await create();
    for (let i = 0; i < 3; i++) await request(app).get(`/api/links/${body.code}`);
    const res = await request(app).get(`/api/links/${body.code}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ code: body.code, clicks: 0 });
  });

  it("unknown code → 404", async () => {
    expect((await request(app).get("/api/links/abcdefg")).status).toBe(404);
  });
});

describe("misc", () => {
  it("GET /health → 200", async () => {
    expect((await request(app).get("/health")).status).toBe(200);
  });

  it("unknown route → JSON 404", async () => {
    const res = await request(app).get("/api/nope/deeper");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTypeOf("string");
  });

  it("a 500 has no stack or internals", async () => {
    vi.spyOn(Link, "findOne").mockRejectedValue(new Error("secret internals at C:\\code\\x.ts"));
    const res = await request(app).get("/api/links/abcdefg");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "Internal server error" });
    expect(res.text).not.toContain("secret");
  });
});
