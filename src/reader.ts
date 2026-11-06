import * as cheerio from "cheerio";
import { config } from "./config.js";
import type { ScoredStory, Selection } from "./types.js";
import { clip, getText, hostname, mapLimit } from "./util.js";

/** How much article text each section's writer sees. Grounding only; it is never republished. */
const LIMITS = { deepDive: 8000, gem: 4000, short: 1500 };

/** Under this, a page is a blurb or a post, not an article. A deep dive can't rest on it without a warning. */
export const THIN_ARTICLE_CHARS = 1500;

export const isSocialHost = (url: string): boolean => config.socialHosts.some((re) => re.test(hostname(url)));

/** Readable text from an article page: <article>/<main> minus chrome, falling back to the page's own description. */
export function extractText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer, aside, form, iframe, svg, figure, [role=navigation], [aria-hidden=true]").remove();
  const root = $("article").first().length ? $("article").first() : $("main").first().length ? $("main").first() : $("body");
  const paragraphs = root
    .find("p, h2, h3, li, blockquote")
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 30);
  const body = [...new Set(paragraphs)].join("\n");
  if (body.length > 400) return body;
  // JS-rendered pages (e.g. Mastodon posts) usually still carry their text in meta tags.
  const meta = $('meta[property="og:description"]').attr("content") ?? $('meta[name="description"]').attr("content") ?? "";
  return [meta, body].filter(Boolean).join("\n").trim();
}

async function readRepo(story: ScoredStory, limit: number): Promise<string> {
  const repo = story.url.replace("https://github.com/", "");
  const readme = await getText(`https://raw.githubusercontent.com/${repo}/HEAD/README.md`);
  // Drop badges, images and HTML so the writer sees prose.
  return clip(readme.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim(), limit);
}

async function read(story: ScoredStory, limit: number): Promise<void> {
  try {
    const text = story.url.startsWith("https://github.com/") ? await readRepo(story, limit) : clip(extractText(await getText(story.url)), limit);
    if (text.length < 200) throw new Error("too little readable text (paywall or script-only page?)");
    const kind = isSocialHost(story.url) ? "social-post" : text.length < THIN_ARTICLE_CHARS ? "thin" : "article";
    story.article = { status: "ok", kind, text };
  } catch (err) {
    story.article = { status: "unavailable", text: "", reason: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchKind(url: string, limit: number): Promise<{ text: string; kind: "article" | "thin" | "social-post" } | undefined> {
  try {
    const text = url.startsWith("https://github.com/")
      ? await readRepo({ url } as ScoredStory, limit)
      : clip(extractText(await getText(url)), limit);
    if (text.length < 200) return undefined;
    return { text, kind: isSocialHost(url) ? "social-post" : text.length < THIN_ARTICLE_CHARS ? "thin" : "article" };
  } catch {
    return undefined;
  }
}

/**
 * Deep dives also get their other reports read (up to two). If the lead link turns out to be a social post,
 * a blurb, or unreadable while another report is a real article, that article becomes the lead: the reader
 * should meet the reporting, not the toot that pointed at it.
 */
async function readRelated(story: ScoredStory): Promise<void> {
  const links = (story.related ?? []).filter((r) => r.source !== "Hacker News").slice(0, 2);
  await mapLimit(links, 2, async (r) => {
    const got = await fetchKind(r.url, LIMITS.deepDive / 2);
    if (got) Object.assign(r, got);
  });
  const weak = story.article?.status !== "ok" || story.article.kind !== "article";
  const better = links.find((r) => r.kind === "article");
  if (weak && better) {
    const old = { source: story.source, title: story.title, url: story.url, text: story.article?.text, kind: story.article?.kind };
    story.source = better.source;
    story.title = better.title;
    story.url = better.url;
    story.article = { status: "ok", kind: "article", text: better.text ?? "" };
    story.related = [old, ...(story.related ?? []).filter((r) => r !== better)];
    story.reasons.push(`lead swapped to ${better.source} (original was ${old.kind ?? "unreadable"})`);
    console.log(`  lead for "${old.title.slice(0, 50)}…" swapped to ${better.source}`);
  }
}

const isSolid = (s: ScoredStory) => s.article?.status === "ok" && s.article.kind === "article";

/**
 * House rule: no deep dive rests on an unread page or a social post. After the related reports have had
 * their chance to replace the lead, a deep dive that is still weak trades places with the best quick hit
 * that reads as a real article (re-read at deep-dive length). The weak story stays in the issue as a
 * quick hit, where "a post claims" is a fair size for it. (2026-11-02: an unread Reddit post was a deep dive.)
 */
async function guardDeepDives(sel: Selection): Promise<void> {
  for (let i = 0; i < sel.deepDives.length; i++) {
    const weak = sel.deepDives[i];
    if (isSolid(weak)) continue;
    let promoted: ScoredStory | undefined;
    for (const candidate of [...sel.quickHits].sort((a, b) => b.score - a.score).slice(0, 4)) {
      if (candidate.article?.status !== "ok" || isSocialHost(candidate.url)) continue;
      const before = { article: candidate.article, related: candidate.related, title: candidate.title, url: candidate.url, source: candidate.source };
      await read(candidate, LIMITS.deepDive);
      await readRelated(candidate);
      if (isSolid(candidate)) {
        promoted = candidate;
        break;
      }
      Object.assign(candidate, before); // a failed re-read must not cost the quick hit the text it already had

    }
    if (!promoted) {
      console.warn(`  ! deep dive "${weak.title.slice(0, 60)}" has no readable article and no quick hit could replace it`);
      continue;
    }
    sel.quickHits = sel.quickHits.map((q) => (q === promoted ? weak : q));
    sel.deepDives[i] = promoted;
    weak.reasons.push(`moved to quick hits (lead was ${weak.article?.kind ?? "unreadable"})`);
    promoted.reasons.push(`promoted to deep dive in place of "${weak.title.slice(0, 50)}"`);
    console.log(`  deep dive "${weak.title.slice(0, 50)}…" (${weak.article?.kind ?? "unreadable"}) swapped for "${promoted.title.slice(0, 50)}…"`);
  }
}

/** Fetches the source text for every selected story, in place. Failures are recorded, never fatal. */
export async function readSources(sel: Selection): Promise<void> {
  const jobs: [ScoredStory, number][] = [
    ...sel.deepDives.map((s) => [s, LIMITS.deepDive] as [ScoredStory, number]),
    [sel.gem, LIMITS.gem],
    ...[...sel.quickHits, ...sel.offbeat, ...sel.opinions].map((s) => [s, LIMITS.short] as [ScoredStory, number]),
  ];
  await mapLimit(jobs, 4, ([story, limit]) => read(story, limit));
  await mapLimit(sel.deepDives, 3, readRelated);
  await guardDeepDives(sel);
  const missing = jobs.filter(([s]) => s.article?.status !== "ok");
  console.log(`  read ${jobs.length - missing.length}/${jobs.length} sources`);
  for (const [s] of missing) console.warn(`  ! could not read ${s.url}: ${s.article?.reason}`);
}
