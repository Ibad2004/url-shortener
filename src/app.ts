import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { CODE_PATTERN, generateCode as defaultGenerator, type CodeGenerator } from "./codes.js";
import { normalizeBaseUrl } from "./config.js";
import { HttpError } from "./errors.js";
import { Link } from "./link.model.js";
import { errorHandler, logger, notFound } from "./middleware.js";
import { createLinkSchema } from "./schemas.js";

export interface AppOptions {
  baseUrl?: string;
  generateCode?: CodeGenerator;
  logRequests?: boolean;
}

const MAX_CODE_TRIES = 5;

function isDuplicateKey(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === 11000;
}

function paramCode(req: Request): string {
  const value = req.params.code;
  return typeof value === "string" ? value : "";
}

function wantsHtml(req: Request): boolean {
  return (req.get("accept") ?? "").includes("text/html");
}

const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Link not found</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;text-align:center;margin-top:20vh"><h1>This short link doesn't exist</h1>
<p>Check the address and try again.</p></body></html>`;

export function createApp(options: AppOptions = {}): Express {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? process.env.BASE_URL);
  const generate = options.generateCode ?? defaultGenerator;
  const createSchema = createLinkSchema(baseUrl);

  const present = (link: { code: string; url: string; clicks: number; createdAt: Date }) => ({
    code: link.code,
    shortUrl: `${baseUrl}/${link.code}`,
    url: link.url,
    clicks: link.clicks,
    createdAt: link.createdAt,
  });

  const app = express();
  if (options.logRequests ?? process.env.NODE_ENV !== "test") app.use(logger);
  app.use(express.json({ limit: "10kb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.post("/api/links", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message ?? "Invalid request");
      }
      for (let attempt = 0; attempt < MAX_CODE_TRIES; attempt++) {
        try {
          const link = await Link.create({ code: generate(), url: parsed.data.url });
          res.status(201).json(present(link));
          return;
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
        }
      }
      throw new Error("Could not generate a unique code");
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/links/:code", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = paramCode(req);
      const link = CODE_PATTERN.test(code) ? await Link.findOne({ code }) : null;
      if (!link) throw new HttpError(404, "Link not found");
      res.status(200).json(present(link));
    } catch (err) {
      next(err);
    }
  });

  app.get("/:code", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = paramCode(req);
      let link = null;
      if (CODE_PATTERN.test(code)) {
        // HEAD must not count a click; GET increments atomically in one operation.
        link =
          req.method === "HEAD"
            ? await Link.findOne({ code })
            : await Link.findOneAndUpdate({ code }, { $inc: { clicks: 1 } });
      }
      if (!link) {
        if (wantsHtml(req)) {
          res.status(404).type("html").send(NOT_FOUND_PAGE);
          return;
        }
        throw new HttpError(404, "Link not found");
      }
      res.set("Cache-Control", "no-store");
      res.redirect(302, link.url);
    } catch (err) {
      next(err);
    }
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

