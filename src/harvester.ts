import { XMLParser } from "fast-xml-parser";
import { config } from "./config.js";
import type { Story } from "./types.js";
import { clip, getJson, getText, stripHtml, todayLocal } from "./util.js";

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

const text = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return text((v as Record<string, unknown>)["#text"]);
  return "";
};

const atomLink = (link: unknown): string => {
  const links = asArray(link as Record<string, string> | Record<string, string>[]);
  const alt = links.find((l) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
  return alt?.["@_href"] ?? "";
};

async function harvestFeed(feed: (typeof config.feeds)[number], now: number): Promise<Story[]> {
  const doc = xml.parse(await getText(feed.url));
  const raw = [
    ...asArray(doc?.rss?.channel?.item).map((it: Record<string, unknown>) => ({
      title: text(it.title),
      url: text(it.link),
      date: text(it.pubDate ?? it["dc:date"]),
      summary: text(it.description),
    })),
    ...asArray(doc?.feed?.entry).map((e: Record<string, unknown>) => ({
      title: text(e.title),
      url: atomLink(e.link),
      date: text(e.published ?? e.updated),
      summary: text(e.summary ?? e.content),
    })),
  ];
  return raw
    .filter((r) => r.title && r.url && now - Date.parse(r.date) < config.maxAgeHours * 3.6e6)
    .map((r, i) => ({
      id: `rss-${feed.name.toLowerCase().replace(/\W+/g, "-")}-${i}`,
      kind: "news" as const,
      title: stripHtml(r.title),
      url: r.url,
      source: feed.name,
      publishedAt: new Date(Date.parse(r.date)).toISOString(),
      summary: clip(stripHtml(r.summary), 400),
      ...(feed.opinion ? { opinion: true } : {}),
    }));
}

export async function harvestFeeds(now = Date.now()): Promise<Story[]> {
  const results = await Promise.allSettled(config.feeds.map((f) => harvestFeed(f, now)));
  return results.flatMap((r, i) => {
    if (r.status === "rejected") {
      console.warn(`  ! feed "${config.feeds[i].name}" skipped: ${r.reason instanceof Error ? r.reason.message : r.reason}`);
      return [];
    }
    if (r.value.length === 0) console.warn(`  ! feed "${config.feeds[i].name}" returned nothing in the last 24h (quiet day, or the feed changed)`);
    return r.value;
  });
}

/** Philippine words that make a "today in history" event about us. */
const PH_HISTORY = /\b(philippin\w*|filipin\w*|manila|luzon|visayas|mindanao|cebu|davao|rizal|bonifacio|aguinaldo|mabini|quezon|aquino|magsaysay|edsa|bataan|corregidor|leyte|tagalog)\b/i;

interface OnThisDay {
  events?: { text: string; year: number; pages?: { titles?: { normalized?: string }; content_urls?: { desktop?: { page?: string } } }[] }[];
}

/**
 * "Noong araw": Philippine events on this calendar day, from Wikipedia's "On this day" feed. The Wikipedia article
 * is the named source the writer links; the section is skipped on days with nothing Philippine.
 */
export async function harvestHistory(today = todayLocal()): Promise<Story[]> {
  const [, mm, dd] = today.split("-");
  const data = await getJson<OnThisDay>(`https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mm}/${dd}`);
  return (data.events ?? [])
    .filter((e) => PH_HISTORY.test(e.text) || (e.pages ?? []).some((p) => PH_HISTORY.test(p.titles?.normalized ?? "")))
    .slice(0, 4)
    .map((e, i): Story => {
      const page = (e.pages ?? []).find((p) => PH_HISTORY.test(p.titles?.normalized ?? "")) ?? e.pages?.[0];
      return {
        id: `history-${i}`,
        kind: "history",
        title: `${e.year}: ${e.text}`,
        url: page?.content_urls?.desktop?.page ?? "https://en.wikipedia.org/wiki/Main_Page",
        source: "Wikipedia",
        summary: e.text,
      };
    });
}

export async function harvest(): Promise<Story[]> {
  const now = Date.now();
  const sources = [
    ["RSS feeds", harvestFeeds(now)],
    ["Today in history", harvestHistory()],
  ] as const;
  const stories: Story[] = [];
  for (const [name, pending] of sources) {
    try {
      const got = await pending;
      console.log(`  ${name}: ${got.length} items`);
      stories.push(...got);
    } catch (err) {
      console.warn(`  ! ${name} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (!stories.some((s) => s.kind === "news")) throw new Error("No news harvested from any source; aborting draft.");
  return stories;
}
