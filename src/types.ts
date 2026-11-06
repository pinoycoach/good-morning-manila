import type { Rates } from "./rates.js";

export interface RelatedLink {
  source: string;
  title: string;
  url: string;
  /** Fetched for deep dives only, so the writer can ground on every report of the event. */
  text?: string;
  kind?: "article" | "thin" | "social-post";
}

export interface Story {
  id: string;
  kind: "news" | "repo" | "history";
  /** From an opinion feed: a named columnist's view, quoted short and labelled, never stated as fact. */
  opinion?: boolean;
  title: string;
  url: string;
  /** Publication or feed name (for HN stories, the linked site's domain). */
  source: string;
  publishedAt?: string;
  summary?: string;
  hn?: {
    points: number;
    comments: number;
    ageHours: number;
    discussionUrl: string;
    topComments: string[];
  };
  repo?: {
    starsToday: number;
    language?: string;
  };
  /** Other outlets covering the same story, merged in during dedupe. */
  related?: RelatedLink[];
  /** Source text fetched for grounding the writer (selected stories only). */
  article?: { status: "ok" | "unavailable"; kind?: "article" | "thin" | "social-post"; text: string; reason?: string };
}

export interface ScoredStory extends Story {
  score: number;
  weird: number;
  reasons: string[];
}

export interface Selection {
  deepDives: ScoredStory[];
  gem: ScoredStory;
  quickHits: ScoredStory[];
  /** Noong araw: Philippine events on this day in history. */
  offbeat: ScoredStory[];
  /** Sabi nila: opinion columns, quoted short and labelled. */
  opinions: ScoredStory[];
  /** Piso ngayon: reference rates fetched by code, and the plain lines shown to readers. */
  rates?: { data: Rates; lines: string[] };
  /** Headlines readers got in the last few published issues, so the writer can frame updates. */
  recent?: { date: string; title: string }[];
}

export interface IssueSection {
  number: number;
  /** Fixed label for sections 4-6, e.g. "GitHub Gem of the Day". */
  kicker?: string;
  headline: string;
  /** Main paragraph, light markdown: [text](url), *italic*, **bold**. */
  body: string;
  /** `+` follow-ons, or Extra, Extra quick hits. */
  items: { leadIn: string; text: string }[];
  /** Standalone scroll-stopping line for social posts. */
  socialHook: string;
  /** Sections 1-4: one sentence on what this means if you work online. */
  soWhat?: string;
}

export interface Issue {
  date: string;
  newsletterName: string;
  editor: string;
  title: string;
  teaser: string;
  sections: IssueSection[];
  /** Piso ngayon, shown above the sections; numbers from code, never from the writer. */
  rates?: { data: Rates; lines: string[] };
  dryRun: boolean;
  warnings: string[];
}
