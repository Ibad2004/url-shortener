# URL Shortener API

Create short links, redirect to the original URL, and count clicks. Express 5 + TypeScript + Mongoose + Zod.

## How it works (the coat check)
You hand over a long URL and get a small ticket back: a random 7-character code (`a-z A-Z 0-9`).
The code is saved next to the long URL. Show the ticket (`GET /<code>`) and you are sent to the saved URL.
The same long URL shortened twice gets a **new code each time**, so each share is tracked on its own.

## Run
1. `npm.cmd install`
2. Copy `.env.example` to `.env` and fill in `MONGODB_URI` (Atlas, same cluster as the other projects; the app uses the database `url-shortener`). Optional: `PORT` (5000), `BASE_URL` (`http://localhost:5000`, used to build `shortUrl`).
3. `npm.cmd run dev` (or `npm.cmd run build` then `npm.cmd start`).
4. `npm.cmd run check` runs typecheck + tests (in-memory MongoDB, never Atlas).

## Routes
| Route | Success | Errors |
|---|---|---|
| `POST /api/links` `{ "url": "..." }` | 201 `{ code, shortUrl, url, clicks, createdAt }` | 400 bad URL / invalid JSON, 413 body > 10kb |
| `GET /:code` | 302 + `Location`, `Cache-Control: no-store`, click +1 | 404 unknown or malformed code |
| `GET /api/links/:code` | 200 stats (no click counted) | 404 |
| `GET /health` | 200 | |

URL rules: trimmed, `http:`/`https:` only, max 2048 chars, no `user:pass@`, and not your own `BASE_URL` host (redirect loop).
Errors are JSON `{ "error": "..." }`; DB down gives 503, anything unexpected 500 with no stack. A browser (Accept includes `text/html`) gets a small HTML page for a missing short link.

## Why 302, not 301
A 301 is "moved permanently": browsers cache it and next time go straight to the target without calling us, so those clicks are never counted. 302 plus `Cache-Control: no-store` makes every visit come through the server.

## Why `$inc`
Reading the count, adding 1 and saving loses clicks when two visitors arrive at once (both read 5, both write 6). One `findOneAndUpdate` with `$inc` lets MongoDB do the add atomically, so 10 simultaneous visits give exactly 10.

## PowerShell examples
```powershell
$link = Invoke-RestMethod -Method Post -Uri http://localhost:5000/api/links -ContentType "application/json" -Body '{"url":"https://example.com/a/long/path"}'
$link.shortUrl
Invoke-WebRequest $link.shortUrl -MaximumRedirection 0 -SkipHttpErrorCheck   # 302, counts a click
Invoke-RestMethod "http://localhost:5000/api/links/$($link.code)"            # stats
```

## Known limits
- Link-preview bots (chat apps, social sites) fetch the link with GET and are counted as clicks.
- `HEAD` requests redirect but are not counted.
- Clicks are a raw count: no unique-visitor tracking. `expiresAt` exists on the model but is unused until part 2.

## What broke
- Typing the Mongoose model with inferred types made `Link.create()` results unusable (fields typed `unknown`); an explicit `LinkFields` interface fixed it.
