import { useRef, useState, type FormEvent } from "react";
import { ApiError, NetworkError, createLink, fetchLink, type ExpiresIn, type LinkInfo } from "./api";
import { expiryLabel, truncate } from "./format";
import { MAX_LINKS, loadLinks, saveLinks } from "./storage";

const OPTIONS: { value: string; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "never", label: "Never" },
];

function toExpiresIn(value: string): ExpiresIn {
  return value === "1h" || value === "1d" || value === "7d" || value === "30d" ? value : null;
}

const OFFLINE = "Can't reach the shortener. Is the API running? (npm.cmd run dev)";

export function App() {
  const [url, setUrl] = useState("");
  const [expires, setExpires] = useState("never");
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LinkInfo | null>(null);
  const [links, setLinks] = useState<LinkInfo[]>(loadLinks);
  const [notice, setNotice] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const sending = useRef(false);
  const lastAction = useRef<"submit" | "refresh">("submit");
  const shortRef = useRef<HTMLAnchorElement>(null);

  function updateLinks(next: LinkInfo[]) {
    setLinks(next);
    saveLinks(next);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (sending.current) return;
    lastAction.current = "submit";
    const value = url.trim();
    setNotice("");
    setOffline(false);
    if (!value) {
      setError("Enter a URL to shorten.");
      return;
    }
    setError("");
    sending.current = true;
    setBusy(true);
    try {
      const link = await createLink(value, toExpiresIn(expires));
      setResult(link);
      updateLinks([link, ...links.filter((l) => l.code !== link.code)].slice(0, MAX_LINKS));
    } catch (err) {
      if (err instanceof NetworkError) setOffline(true);
      else if (err instanceof ApiError) setError(err.message);
      else setError("Something went wrong. Try again.");
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.shortUrl);
      setNotice("Copied!");
    } catch {
      const node = shortRef.current;
      const selection = window.getSelection();
      if (node && selection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setNotice("Press Ctrl+C to copy");
    }
  }

  async function refresh() {
    lastAction.current = "refresh";
    setNotice("");
    setOffline(false);
    const gone: string[] = [];
    let down = false;
    const updated = await Promise.all(
      links.map(async (link) => {
        try {
          return await fetchLink(link.code);
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) gone.push(link.code);
          else if (err instanceof NetworkError) down = true;
          return link;
        }
      }),
    );
    setMissing(gone);
    if (down) setOffline(true);
    else updateLinks(updated);
  }

  return (
    <main>
      <h1>URL Shortener</h1>
      <form onSubmit={submit} noValidate>
        <label htmlFor="url">URL to shorten</label>
        <input
          id="url"
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://example.com/a/very/long/link"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "url-error" : undefined}
        />
        {error && (
          <p id="url-error" className="error" role="alert">
            {error}
          </p>
        )}
        <label htmlFor="expires">Expires</label>
        <select id="expires" value={expires} onChange={(e) => setExpires(e.target.value)}>
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={busy}>
          {busy ? "Shortening…" : "Shorten"}
        </button>
      </form>

      {offline && (
        <div className="error box" role="alert">
          <p>{OFFLINE}</p>
          <button type="button" onClick={() => void (lastAction.current === "refresh" ? refresh() : submit())}>
            Try again
          </button>
        </div>
      )}

      <p className="status" role="status" aria-live="polite">
        {notice}
      </p>

      {result && (
        <section aria-labelledby="result-h" className="box">
          <h2 id="result-h">Your short link</h2>
          <p>
            <a ref={shortRef} href={result.shortUrl} target="_blank" rel="noreferrer">
              {result.shortUrl}
            </a>
          </p>
          <button type="button" onClick={() => void copy()}>
            Copy
          </button>
        </section>
      )}

      <section aria-labelledby="list-h">
        <h2 id="list-h">Your links</h2>
        {links.length === 0 ? (
          <p>No links yet.</p>
        ) : (
          <>
            <div className="row">
              <button type="button" onClick={() => void refresh()}>
                Refresh
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  updateLinks([]);
                  setMissing([]);
                }}
              >
                Clear list
              </button>
            </div>
            <ul>
              {links.map((link) => (
                <li key={link.code} className="box">
                  <strong>{link.code}</strong>
                  <p title={link.url}>{truncate(link.url)}</p>
                  <p>
                    {link.clicks} {link.clicks === 1 ? "click" : "clicks"} · {expiryLabel(link)}
                    {missing.includes(link.code) && " · Not found on the server"}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

