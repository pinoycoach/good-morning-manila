import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Issue } from "./types.js";
import { canonicalUrl } from "./util.js";

/** What readers have already been told: the stories linked from recently published issues. */
export interface RecentCoverage {
  /** canonical URL → date of the issue that linked it */
  urls: Map<string, string>;
  /** source headlines (link labels) with their issue date, for fuzzy and model matching */
  headlines: { date: string; title: string }[];
}

/**
 * Reads the briefs drafted in the `days` before `today` (dist/issue-<date>/). Posting is by hand on Facebook,
 * so every draft counts as seen; a skipped day only means a story may be held back a little longer.
 */
export async function recentCoverage(today: string, days = 4, distDir = path.resolve("dist")): Promise<RecentCoverage> {
  const urls = new Map<string, string>();
  const headlines: { date: string; title: string }[] = [];
  if (!existsSync(distDir)) return { urls, headlines };
  const cutoff = new Date(`${today}T00:00:00`).getTime() - days * 86_400_000;
  for (const name of await readdir(distDir)) {
    const date = /^issue-(\d{4}-\d{2}-\d{2})$/.exec(name)?.[1];
    if (!date || date >= today || new Date(`${date}T00:00:00`).getTime() < cutoff) continue;
    const file = path.join(distDir, name, "issue.json");
    if (!existsSync(file)) continue;
    const issue = JSON.parse(await readFile(file, "utf8")) as Issue;
    if (issue.dryRun) continue; // test drafts were never posted
    for (const s of issue.sections) {
      for (const md of [s.body, s.soWhat ?? "", ...s.items.map((i) => i.text)]) {
        for (const [, label, url] of md.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
          if (url.includes("news.ycombinator.com")) continue;
          urls.set(canonicalUrl(url), date);
          // Labels like "the discussion" or "Hacker News" aren't headlines.
          if (label.split(/\s+/).length >= 4) headlines.push({ date, title: label });
        }
      }
    }
  }
  return { urls, headlines };
}
