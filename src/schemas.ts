import { z } from "zod";

export const MAX_URL_LENGTH = 2048;

export function createLinkSchema(baseUrl: string) {
  const ownHost = new URL(baseUrl).host.toLowerCase();
  return z.object({
    url: z
      .string({ error: "url is required and must be a string" })
      .trim()
      .min(1, "url must not be empty")
      .max(MAX_URL_LENGTH, `url must be at most ${MAX_URL_LENGTH} characters`)
      .superRefine((value, ctx) => {
        let parsed: URL;
        try {
          parsed = new URL(value);
        } catch {
          ctx.addIssue({ code: "custom", message: "url must be a valid URL" });
          return;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          ctx.addIssue({ code: "custom", message: "url must use http: or https:" });
        } else if (parsed.username !== "" || parsed.password !== "") {
          ctx.addIssue({ code: "custom", message: "url must not contain a username or password" });
        } else if (parsed.host.toLowerCase() === ownHost) {
          ctx.addIssue({ code: "custom", message: "url must not point at this short-link service" });
        }
      }),
  });
}
