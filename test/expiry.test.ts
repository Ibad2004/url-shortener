import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { Link } from "../src/link.model.js";

const app = createApp({ baseUrl: "http://localhost:5000" });
let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri(), { dbName: "test" });
  await Link.init();
});
afterEach(async () => {
  await Link.deleteMany({});
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

const HOUR = 3600_000;

describe("expiring links", () => {
  it.each([
    ["1h", HOUR],
    ["1d", 24 * HOUR],
    ["7d", 7 * 24 * HOUR],
    ["30d", 30 * 24 * HOUR],
  ])("expiresIn %s sets expiresAt", async (expiresIn, ms) => {
    const before = Date.now();
    const res = await request(app).post("/api/links").send({ url: "https://example.com", expiresIn });
    expect(res.status).toBe(201);
    expect(res.body.expired).toBe(false);
    const at = new Date(res.body.expiresAt).getTime();
    expect(at).toBeGreaterThanOrEqual(before + ms);
    expect(at).toBeLessThanOrEqual(Date.now() + ms);
  });

  it("defaults to never (null) and accepts null", async () => {
    const a = await request(app).post("/api/links").send({ url: "https://example.com" });
    const b = await request(app).post("/api/links").send({ url: "https://example.com", expiresIn: null });
    for (const res of [a, b]) {
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ expiresAt: null, expired: false });
    }
  });

  it.each(["2h", "", 5, "never"])("bad expiresIn %j → 400", async (expiresIn) => {
    const res = await request(app).post("/api/links").send({ url: "https://example.com", expiresIn });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("expiresIn");
  });

  it("redirects and counts before expiry", async () => {
    const { body } = await request(app).post("/api/links").send({ url: "https://example.com/x", expiresIn: "1h" });
    const res = await request(app).get(`/${body.code}`);
    expect(res.status).toBe(302);
    expect((await request(app).get(`/api/links/${body.code}`)).body.clicks).toBe(1);
  });

  it("after expiry: 410, no click, stats show expired", async () => {
    const { body } = await request(app).post("/api/links").send({ url: "https://example.com/x", expiresIn: "1h" });
    await Link.updateOne({ code: body.code }, { expiresAt: new Date(Date.now() - 1000) });
    const json = await request(app).get(`/${body.code}`).set("Accept", "application/json");
    expect(json.status).toBe(410);
    expect(json.body).toEqual({ error: "This link has expired" });
    const html = await request(app).get(`/${body.code}`).set("Accept", "text/html");
    expect(html.status).toBe(410);
    expect(html.text).toContain("This link has expired");
    expect((await request(app).head(`/${body.code}`)).status).toBe(410);
    const stats = await request(app).get(`/api/links/${body.code}`);
    expect(stats.status).toBe(200);
    expect(stats.body).toMatchObject({ clicks: 0, expired: true });
  });

  it("a missing code is still 404, not 410", async () => {
    expect((await request(app).get("/abcdefg")).status).toBe(404);
  });
});

describe("CORS", () => {
  it("allows the configured origin", async () => {
    const res = await request(app).get("/health").set("Origin", "http://localhost:5174");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5174");
  });

  it("answers preflight, and error replies carry CORS headers", async () => {
    const pre = await request(app)
      .options("/api/links")
      .set("Origin", "http://localhost:5174")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type");
    expect(pre.status).toBe(204);
    expect(pre.headers["access-control-allow-headers"]).toContain("Content-Type");
    const bad = await request(app).post("/api/links").set("Origin", "http://localhost:5174").send({ url: "hello" });
    expect(bad.status).toBe(400);
    expect(bad.headers["access-control-allow-origin"]).toBe("http://localhost:5174");
  });

  it("does not allow other origins", async () => {
    const res = await request(app).get("/health").set("Origin", "http://evil.example");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
