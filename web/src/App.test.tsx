import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { LinkInfo } from "./api";

function link(over: Partial<LinkInfo> = {}): LinkInfo {
  return {
    code: "abc1234",
    shortUrl: "http://localhost:5000/abc1234",
    url: "https://example.com/long",
    clicks: 0,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    expired: false,
    ...over,
  };
}

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function shorten(user: ReturnType<typeof userEvent.setup>, value = "https://example.com/long") {
  await user.type(screen.getByLabelText("URL to shorten"), value);
  await user.click(screen.getByRole("button", { name: "Shorten" }));
}

describe("App", () => {
  it("shortens a URL and shows the result", async () => {
    fetchMock.mockResolvedValue(reply(link(), 201));
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText("Expires"), "7d");
    await shorten(user);
    const a = await screen.findByRole("link", { name: "http://localhost:5000/abc1234" });
    expect(a).toHaveAttribute("href", "http://localhost:5000/abc1234");
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ url: "https://example.com/long", expiresIn: "7d" });
  });

  it("shows the API 400 message under the input", async () => {
    fetchMock.mockResolvedValue(reply({ error: "Only http and https links are allowed" }, 400));
    const user = userEvent.setup();
    render(<App />);
    await shorten(user, "ftp://x.com");
    expect(await screen.findByRole("alert")).toHaveTextContent("Only http and https links are allowed");
  });

  it("empty input shows a message and sends no request", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Shorten" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("double click sends one request", async () => {
    fetchMock.mockImplementation(() => new Promise((r) => setTimeout(() => r(reply(link(), 201)), 50)));
    const user = userEvent.setup();
    render(<App />);
    await user.type(screen.getByLabelText("URL to shorten"), "https://example.com");
    await user.dblClick(screen.getByRole("button", { name: "Shorten" }));
    await screen.findByRole("link", { name: /abc1234/ });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("copies and announces Copied!", async () => {
    fetchMock.mockResolvedValue(reply(link(), 201));
    const user = userEvent.setup();
    render(<App />);
    await shorten(user);
    await screen.findByRole("link", { name: /abc1234/ });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("http://localhost:5000/abc1234");
    expect(screen.getByRole("status")).toHaveTextContent("Copied!");
  });

  it("falls back to selecting the text when copy fails", async () => {
    fetchMock.mockResolvedValue(reply(link(), 201));
    const user = userEvent.setup();
    render(<App />);
    await shorten(user);
    await screen.findByRole("link", { name: /abc1234/ });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(screen.getByRole("status")).toHaveTextContent("Press Ctrl+C to copy");
    expect(window.getSelection()?.toString()).toContain("abc1234");
  });

  it("saves the list and restores it, ignoring broken data", async () => {
    fetchMock.mockResolvedValue(reply(link(), 201));
    const user = userEvent.setup();
    const first = render(<App />);
    await shorten(user);
    await screen.findByRole("link", { name: /abc1234/ });
    first.unmount();
    render(<App />);
    expect(screen.getByRole("heading", { name: "Your links" })).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
  });

  it("ignores broken stored data", () => {
    localStorage.setItem("url-shortener:links", "{not json");
    render(<App />);
    expect(screen.getByText("No links yet.")).toBeInTheDocument();
    localStorage.setItem("url-shortener:links", JSON.stringify([{ nope: 1 }, link({ code: "okok123" })]));
    render(<App />);
    expect(screen.getByText("okok123")).toBeInTheDocument();
  });

  it("refresh updates stats; a 404 for one link does not break the others", async () => {
    localStorage.setItem(
      "url-shortener:links",
      JSON.stringify([link({ code: "aaaaaaa" }), link({ code: "bbbbbbb" })]),
    );
    fetchMock.mockImplementation((u: string) =>
      Promise.resolve(
        u.endsWith("/aaaaaaa") ? reply({ error: "Link not found" }, 404) : reply(link({ code: "bbbbbbb", clicks: 5 })),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText(/5 clicks/)).toBeInTheDocument();
    expect(screen.getByText(/Not found on the server/)).toBeInTheDocument();
  });

  it("clear list empties only the local list", async () => {
    localStorage.setItem("url-shortener:links", JSON.stringify([link()]));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Clear list" }));
    expect(screen.getByText("No links yet.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("labels expired, expiring and never-expiring links", () => {
    const in6d = new Date(Date.now() + 5.5 * 86_400_000).toISOString();
    localStorage.setItem(
      "url-shortener:links",
      JSON.stringify([
        link({ code: "expired1", expiresAt: new Date(Date.now() - 1000).toISOString(), expired: true }),
        link({ code: "soon123", expiresAt: in6d }),
        link({ code: "never12" }),
      ]),
    );
    render(<App />);
    expect(screen.getByText(/Expired/)).toBeInTheDocument();
    expect(screen.getByText(/Expires in 6 days/)).toBeInTheDocument();
    expect(screen.getByText(/Never expires/)).toBeInTheDocument();
  });

  it("shows the API-off message with Try again", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(reply(link(), 201));
    const user = userEvent.setup();
    render(<App />);
    await shorten(user);
    expect(await screen.findByText(/Can't reach the shortener\. Is the API running\? \(npm\.cmd run dev\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("link", { name: /abc1234/ })).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("has no axe violations", async () => {
    localStorage.setItem("url-shortener:links", JSON.stringify([link()]));
    fetchMock.mockResolvedValue(reply(link(), 201));
    const user = userEvent.setup();
    const { container } = render(<App />);
    await shorten(user);
    await screen.findByRole("link", { name: /abc1234/ });
    const results = await axe.run(container);
    expect(results.violations).toEqual([]);
  });
});

