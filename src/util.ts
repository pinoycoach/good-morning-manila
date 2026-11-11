import * as cheerio from "cheerio";
import { config } from "./config.js";

const UA = `${config.newsletterName} newsletter bot (+${config.siteUrl})`;

async function get(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res;
}

export const getJson = async <T>(url: string): Promise<T> => (await get(url)).json() as Promise<T>;
export const getText = async (url: string): Promise<string> => (await get(url)).text();

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export const stripHtml = (html: string): string => cheerio.load(html).text().replace(/\s+/g, " ").trim();

export const clip = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const hostname = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Strips protocol, www, tracking params and trailing slashes so the same link compares equal. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|fbclid|gclid)/.test(key)) u.searchParams.delete(key);
    }
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** Plain text from our light markdown. */
export const mdToText = (md: string): string =>
  md.replace(/\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\([^)]+\)/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");

export const todayLocal = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
