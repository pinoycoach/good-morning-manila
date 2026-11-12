import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "./config.js";
import type { Issue, IssueSection, ScoredStory, Selection } from "./types.js";
import { mdToText } from "./util.js";

/** Section labels. Sections 1-3 are the lead stories (Balita); the rest have fixed names. */
const FIXED = { 4: "Diskarte", 5: "Sabi nila", 6: "Iba pang balita", 7: "Noong araw" } as const;
const SECTIONS = 7;

const IssueSchema = z.object({
  title: z.string().describe("Issue title: a calm, plain headline for section 1 (no puns on serious news)."),
  teaser: z.string().describe("Headlines of sections 2-4, comma-separated."),
  sections: z
    .array(
      z.object({
        headline: z.string().describe("Sections 1-4: a short, plain headline (3-8 words). Light wordplay only on light news. Sections 5-7: empty string."),
        body: z.string().describe("Main paragraph in light markdown. Empty string for sections 5, 6 and 7."),
        items: z
          .array(
            z.object({
              leadIn: z.string().describe("Section 5: the columnist's name and outlet. Section 6: a 2-4 word plain lead-in. Section 7: the year. Empty string for follow-ons in sections 1-4."),
              text: z.string().describe("One item in light markdown, with its source link."),
            }),
          )
          .describe("Sections 1-3: 0-2 follow-ons. Section 4: 0-1. Section 5: 0-3 quotes (only from opinionColumns). Section 6: 3-4 quick items. Section 7: 0-1 (only from todayInHistory)."),
        socialHook: z
          .string()
          .describe("A standalone 1-2 sentence hook for a Facebook post, under 200 characters, plain text, no hashtags or links."),
        soWhat: z
          .string()
          .describe(
            "Sections 1-4 only: one plain sentence, under 160 characters, on what this means for an OFW family this week: a cost, a fee, a deadline, a step to take. Never investment advice. Empty string for sections 5-7.",
          ),
      }),
    )
    .describe("Exactly 7 sections, in order."),
});

const SYSTEM = `You write "Good Morning Manila", a calm daily morning brief for Filipinos at home and abroad: OFWs, Filipino Americans and their families. It is posted on a Facebook page and read on a phone with the first coffee. Think of a trusted kuya or ate who reads all the news overnight and tells the family, in five minutes, what changed for their money and their papers, and where to check it.

The reader: an OFW in Riyadh, Hong Kong, Dubai, Toronto or California, or the family at home who receives the padala. Smart, busy, not an economist. Explain every term in one plain clause the first time (what "reference rate" means, what a "rollback" is). Never talk down.

Economy first: the peso, remittances, oil and prices, inflation, jobs, and the government policies that touch OFWs and families (DMW, OWWA, SSS, PhilHealth, Pag-IBIG, taxes, visas). Low on controversy: no partisan commentary, no feuds, no jokes about officials. Politics appears only when it changes money or OFW rules, and then as facts with the source.

Format, exactly 7 sections in order:
1-3. Balita: the three lead stories. A main paragraph of 100-180 words: what happened, why it matters to the family, and what is still unknown. Then 0-2 follow-on items (another outlet's coverage, an official statement). Each ends with \`soWhat\`.
4. Diskarte: one thing a family can do this week, from the \`diskarte\` material: a deadline, a requirement, a fee to plan for, a benefit to claim, a scam to avoid. 50-100 words, with the official or reporting link. If the material is not actually actionable, make it a short heads-up and say so plainly.
5. Sabi nila: 0-3 short quotes from \`opinionColumns\` only. Each item: leadIn = the columnist's name and outlet; text = what they argue in one sentence of your own, then at most one short exact quote (under 25 words) and the link. These are their views, not facts: write "argues", "writes". If the material is empty or has nothing relevant to money or OFWs, return the section with an empty items list. Never invent a quote or a columnist.
6. Iba pang balita: 3-4 quick items from \`quickHits\`, 1-2 sentences each, with a plain lead-in.
7. Noong araw: one item from \`todayInHistory\` only: the year as leadIn, one or two sentences on what happened and why it still matters, with the Wikipedia link. If the material is empty, return the section with an empty items list. Never add history from memory.

Rules:
- Attribute sources inline as *Publication*: [Headline](url), using only URLs from the material. Never invent or alter a URL.
- Ground every factual claim in the material. Most stories include \`sourceText\`: base numbers, names and dates on it. Where it is missing you only have the headline and summary: stick to them and say plainly when something is unconfirmed.
- Numbers are copied exactly from the material. Do not compute new figures. The peso rates are shown to readers in a separate block (\`pesoToday\`): you may mention the direction of the peso, but never restate or convert the rate numbers yourself.
- Not financial advice: never tell readers to buy, sell, convert, invest or time a transfer. You may explain what a change means ("the same $500 now buys fewer pesos than last month").
- Allegations about a named person or company: straight tone, "alleged" until a ruling, attributed, and the accused side's response in the same paragraph, or "no response appears in the coverage". If the material has only one source, say so. No commentary on cases about named Philippine officials: facts and the source link only. Libel is a crime in the Philippines.
- Opinion is only ever someone else's named, linked opinion (section 5). The brief itself does not take political sides.
- Summarize in your own words. Never copy sentences from \`sourceText\`. Quote at most one short sentence (under 25 words) per item, copied exactly.
- Language: plain English with natural Filipino words where a family would use them (padala, kababayan, ayuda, presyo). Never forced Taglish, never slang. Calm, warm, clear. No jokes about deaths, disasters, crime or private people.
- No em dashes. Never use: ${config.bannedWords.join(", ")}.
- Markdown is limited to [text](url), *italic* and **bold**. No headings, lists or HTML.`;

function material(sel: Selection): string {
  const describe = (s: ScoredStory) => ({
    title: s.title,
    source: s.source,
    url: s.url,
    summary: s.summary || undefined,
    otherCoverage: s.related?.map((r) => ({
      source: r.source,
      title: r.title,
      url: r.url,
      sourceKind: r.kind === "social-post" ? "social post (a claim, not reporting)" : r.kind ?? (r.text ? "article" : "unread (headline only)"),
      sourceText: r.text,
    })),
    sourceKind:
      s.article?.kind === "social-post" ? "social post (a claim, not reporting)"
      : s.article?.kind === "thin" ? "short page or blurb"
      : s.article?.status === "ok" ? "article" : "unread (headline and summary only)",
    sourceText: s.article?.status === "ok" ? s.article.text : undefined,
    memory: s.reasons.includes("update to a recent story") ? "UPDATE to a story readers already got (see recentlyCovered)" : undefined,
  });
  return JSON.stringify(
    {
      recentlyCovered: sel.recent?.length ? sel.recent : undefined,
      pesoToday: sel.rates ? sel.rates.lines : undefined,
      balita: sel.deepDives.map(describe),
      diskarte: describe(sel.gem),
      opinionColumns: sel.opinions.map(describe),
      quickHits: sel.quickHits.map(describe),
      todayInHistory: sel.offbeat.map(describe),
    },
    null,
    2,
  );
}

function allowedUrls(sel: Selection): Set<string> {
  const stories = [...sel.deepDives, sel.gem, ...sel.quickHits, ...sel.offbeat, ...sel.opinions];
  return new Set(stories.flatMap((s) => [s.url, s.hn?.discussionUrl, ...(s.related ?? []).map((r) => r.url)]).filter((u): u is string => !!u));
}

/**
 * Optional house voice: voice/voice.md (the style guide) plus voice/samples/*.md (writing to learn from).
 * Several samples from different writers make a composite; voice.md says how to blend them.
 */
export function loadVoice(): string {
  if (!existsSync("voice/voice.md")) return "";
  const guide = readFileSync("voice/voice.md", "utf8").trim();
  const samples = existsSync("voice/samples")
    ? readdirSync("voice/samples")
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => `<sample name="${f}">\n${readFileSync(path.join("voice/samples", f), "utf8").trim()}\n</sample>`)
    : [];
  return `\n\nHouse voice. This overrides the default tone above, but never the format, sourcing or accuracy rules.
<voice_guide>
${guide}
</voice_guide>${samples.length ? `\n\nWriting samples that show the voice. Learn the rhythm, word choice and attitude. Never reuse their sentences or topics.\n${samples.join("\n")}` : ""}`;
}

async function callClaudeOnce(sel: Selection, date: string, effort: "high" | "medium"): Promise<z.infer<typeof IssueSchema>> {
  const client = new Anthropic();
  // The reply and Claude's thinking share max_tokens. 21,000 is the most a single non-streamed call allows.
  const response = await client.beta.messages.parse({
    model: config.model,
    max_tokens: 21000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort, format: zodOutputFormat(IssueSchema) },
    system: SYSTEM + loadVoice(),
    messages: [{ role: "user", content: `Write the issue for ${date} from this material:\n\n${material(sel)}` }],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Claude declined to write the issue (${response.stop_details?.category ?? "no category"}).`);
  }
  if (response.stop_reason === "max_tokens") throw new Error("Issue was cut off at max_tokens.");
  if (!response.parsed_output) throw new Error("Claude's reply did not match the issue schema.");
  return response.parsed_output;
}

/**
 * One retry. On 2026-11-13 the reply was cut off mid-sentence (thinking had used up the room), the JSON could not be
 * read, and there was no issue that morning. A second try with less thinking leaves more room for the issue itself.
 */
async function callClaude(sel: Selection, date: string): Promise<z.infer<typeof IssueSchema>> {
  try {
    return await callClaudeOnce(sel, date, "high");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Only a cut-off or unreadable reply is worth a second call; a refusal or a missing key is not.
    if (!/parse structured output|cut off at max_tokens|did not match the issue schema/i.test(message)) throw err;
    console.warn(`  ! first try failed (${message.slice(0, 120)}); trying once more with less thinking`);
    return callClaudeOnce(sel, date, "medium");
  }
}

/** Placeholder issue for testing the pipeline without Claude credentials. Never publishable. */
function dryRunIssue(sel: Selection): z.infer<typeof IssueSchema> {
  const link = (s: ScoredStory) => `*${s.source}*: [${s.title}](${s.url})`;
  const blurb = (s: ScoredStory) => `[DRY RUN, no Claude call] ${link(s)}. ${s.summary ?? ""}`.trim();
  return {
    title: sel.deepDives[0]?.title ?? "Dry Run",
    teaser: sel.deepDives.slice(1).map((s) => s.title).join(", "),
    sections: [
      ...sel.deepDives.map((s) => ({
        headline: s.title,
        body: blurb(s),
        items: (s.related ?? []).slice(0, 1).map((r) => ({ leadIn: "", text: `*${r.source}*: [${r.title}](${r.url})` })),
        socialHook: s.title,
        soWhat: "[DRY RUN] What this means for the family goes here.",
      })),
      { headline: sel.gem.title, body: blurb(sel.gem), items: [], socialHook: sel.gem.title, soWhat: "[DRY RUN]" },
      { headline: "", body: "", items: sel.opinions.slice(0, 2).map((s) => ({ leadIn: s.source, text: link(s) })), socialHook: "Sabi nila.", soWhat: "" },
      { headline: "", body: "", items: sel.quickHits.map((s) => ({ leadIn: s.source, text: link(s) })), socialHook: "Iba pang balita.", soWhat: "" },
      { headline: "", body: "", items: sel.offbeat.slice(0, 1).map((s) => ({ leadIn: s.title.slice(0, 4), text: link(s) })), socialHook: "Noong araw.", soWhat: "" },
    ],
  };
}

/** Lowercase letters/digits only, quote marks dropped, so a quote matches its source despite punctuation, casing or quote style. */
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/['"‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** All text the writer was given, normalized for quote lookup. */
function sourceText(sel: Selection): string {
  const stories = [...sel.deepDives, sel.gem, ...sel.quickHits, ...sel.offbeat, ...sel.opinions];
  return normalize(
    stories
      .flatMap((s) => [
        s.title,
        s.summary ?? "",
        s.article?.text ?? "",
        ...(s.hn?.topComments ?? []),
        ...(s.related ?? []).flatMap((r) => [r.title, r.text ?? ""]),
      ])
      .join(" \n "),
  );
}

/** Quotes of 4+ words must appear in the source material; shorter ones are usually scare quotes. */
function unsourcedQuotes(text: string, corpus: string): string[] {
  const quotes = [...text.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1]);
  return quotes.filter((q) => q.split(/\s+/).length >= 4 && !corpus.includes(normalize(q)));
}

/** Words that mark an accusation or proceeding against someone. Any hit means the editor must check the item by hand. */
export const ALLEGATION =
  /\b(hack(ed|ing)?|breach(ed)?|malware|trojan|backdoor|compromised|fraud|scam(med|mer)?|spy(ing)?|surveillance|arrest(ed)?|lawsuit|sue[sd]?|charged|indicted|accus(ed|es|ation)|alleg(ed|edly|ation|ations)|suspen(ded|sion)|ombudsman|graft|corrupt(ion)?|plunder|estafa|bribe(ry)?|kickback|conflict of interest|investigat(ed|es|ing|ion))\b/i;

/** Phrases that turn information into a recommendation. */
const FINANCIAL_ADVICE = /\b(you should (buy|sell|invest|convert|send|wait)|buy (dollars|pesos|now)|sell (dollars|now)|invest in|best time to (send|convert|buy)|wait before sending|send now|convert now|guaranteed returns?)\b/i;
/** Named Philippine officials and offices that draw commentary. */
const OFFICIALS = /\b(president|vice president|senator|sen\.|congressman|congresswoman|rep\.|secretary|usec|undersecretary|mayor|governor|marcos|duterte|romualdez|escudero|speaker)\b/i;
const OPINION_WORDS = /\b(failed|failure|incompetent|corrupt|disgrace|shameful|should resign|must resign|lied|liar|hypocri\w*|clueless|useless|betray\w*)\b/i;

/** Links in a written section. */
const linksIn = (md: string) => [...md.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);

/**
 * The writer may reorder or merge the deep dives, so section i is not always deepDives[i].
 * Match by the links the section actually uses; fall back to position.
 */
function storyFor(s: { body: string; items: { text: string }[] }, i: number, sel: Selection): ScoredStory | undefined {
  const links = new Set(linksIn([s.body, ...s.items.map((it) => it.text)].join(" ")));
  const owns = (st: ScoredStory) => links.has(st.url) || (st.related ?? []).some((r) => links.has(r.url));
  const pool = [...sel.deepDives, ...sel.quickHits];
  return pool.find((st) => links.has(st.url)) ?? pool.find(owns) ?? sel.deepDives[i];
}

/** Warnings that must be in the Telegram ping, not just review.md. */
export const isLegalWarning = (w: string) => w.includes("LEGAL CHECK") || w.includes("LEAD SOURCE") || w.includes("could not be read");

/** Enforces the blueprint after generation: unknown links are unlinked, rule breaks become review warnings. */
export function check(raw: z.infer<typeof IssueSchema>, sel: Selection): { sections: IssueSection[]; warnings: string[] } {
  const warnings: string[] = [];
  if (raw.sections.length !== SECTIONS) warnings.push(`Expected ${SECTIONS} sections, got ${raw.sections.length}.`);
  const allowed = allowedUrls(sel);
  const corpus = sourceText(sel);

  const clean = (md: string, where: string) =>
    md.replace(/\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
      if (allowed.has(url)) return match;
      warnings.push(`${where}: removed link to unknown URL ${url}`);
      return label;
    });

  const sections = raw.sections.slice(0, SECTIONS).map((s, i): IssueSection => {
    const number = i + 1;
    const where = `Section ${number}`;
    const text = mdToText([s.body, ...s.items.map((it) => it.text), s.socialHook, s.soWhat].join(" "));
    if (number <= 4 && !s.soWhat.trim()) warnings.push(`${where}: missing the "para sa pamilya" line.`);
    for (const word of config.bannedWords) {
      if (new RegExp(`\\b${word}\\b`, "i").test(text)) warnings.push(`${where}: banned word "${word}"`);
    }
    for (const quote of text.match(/"[^"]+"/g) ?? []) {
      if (quote.split(/\s+/).length > 25) warnings.push(`${where}: long quote (${quote.slice(0, 40)}…)`);
    }
    if (text.includes("—")) warnings.push(`${where}: contains an em dash (house style: never).`);
    for (const quote of unsourcedQuotes(text, corpus)) {
      warnings.push(`${where}: quote not found in source material, verify or cut: "${quote}"`);
    }
    if (number <= 3) {
      const n = mdToText(s.body).split(/\s+/).filter(Boolean).length;
      if (n < 100 || n > 180) warnings.push(`${where}: main paragraph is ${n} words (target 100-180).`);
      const story = storyFor(s, i, sel);
      const label = story ? ` ("${story.title.slice(0, 60)}")` : "";
      if (story && story.article?.status !== "ok") {
        warnings.push(`${where}${label}: the article could not be read, so this rests on the headline and summary only. Verify before sending.`);
      } else if (story?.article?.kind === "social-post") {
        warnings.push(
          `${where}${label}: LEAD SOURCE IS A SOCIAL POST (${story.source}), not reporting. Find a published report or cut the section.`,
        );
      } else if (story?.article?.kind === "thin") {
        warnings.push(`${where}${label}: the source page is short (${story.article.text.length} chars), so the writer had little to go on. Verify.`);
      }
    }
    // Accusations, in any section: the editor reads the item against its sources before approving.
    const accusation = mdToText([s.headline, s.body, ...s.items.map((it) => `${it.leadIn} ${it.text}`), s.socialHook].join(" ")).match(ALLEGATION);
    if (accusation && number <= 6) {
      const story = number <= 3 ? storyFor(s, i, sel) : undefined;
      const reports = story ? 1 + (story.related?.filter((r) => r.source !== "Hacker News" && r.kind !== "social-post").length ?? 0) : 0;
      warnings.push(
        `${where}: LEGAL CHECK, accusation language ("${accusation[0]}"). Open the sources: is it "alleged", attributed, straight in tone, ` +
          `and is the accused side's response included (or "no response in the coverage")?` +
          (story && reports < 2 ? ` Only ${reports} report in the material; house rule is two independent sources.` : ""),
      );
    }
    if (s.socialHook.length > 220) warnings.push(`${where}: social hook is ${s.socialHook.length} characters (target under 200).`);
    if (number === 6 && (s.items.length < 3 || s.items.length > 4)) warnings.push(`${where}: ${s.items.length} quick items (target 3-4).`);
    // Legal desk: things a lawyer or the editor must look at before anything goes out.
    const all = mdToText([s.headline, s.body, ...s.items.map((it) => `${it.leadIn} ${it.text}`), s.socialHook, s.soWhat].join(" "));
    const advice = all.match(FINANCIAL_ADVICE);
    if (advice) warnings.push(`${where}: LEGAL CHECK, sounds like financial advice ("${advice[0]}"). Reword as information, not a recommendation.`);
    const official = all.match(OFFICIALS);
    if (official && number !== 5 && OPINION_WORDS.test(all)) {
      warnings.push(`${where}: LEGAL CHECK, opinion language near a named official ("${official[0]}"). House rule: facts and the source link only.`);
    }
    const kicker: string | undefined = FIXED[number as keyof typeof FIXED] ?? (number <= 3 ? "Balita" : undefined);
    return {
      number,
      kicker,
      headline: number >= 5 ? kicker! : s.headline,
      body: clean(s.body, where),
      items: s.items.map((it) => ({ leadIn: it.leadIn, text: clean(it.text, where) })),
      socialHook: s.socialHook,
      soWhat: number <= 4 ? clean(s.soWhat, where) : undefined,
    };
  });
  return { sections, warnings };
}

export async function write(sel: Selection, date: string, opts: { dryRun?: boolean } = {}): Promise<Issue> {
  const dryRun = !!opts.dryRun;
  let raw: z.infer<typeof IssueSchema>;
  if (dryRun) {
    raw = dryRunIssue(sel);
  } else {
    try {
      raw = await callClaude(sel, date);
    } catch (err) {
      // The key hint only when the key is the problem; a cut-off reply once got this hint and it misled.
      if (err instanceof Anthropic.AuthenticationError || !process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          `${err instanceof Error ? err.message : err}\nSet ANTHROPIC_API_KEY in .env, or test the pipeline with: npm run draft -- --dry-run`,
        );
      }
      throw err;
    }
  }

  const { sections, warnings } = check(raw, sel);
  if (dryRun) warnings.unshift("DRY RUN: placeholder text, not written by Claude. This issue cannot be published.");
  return {
    date,
    newsletterName: config.newsletterName,
    editor: config.editor,
    title: raw.title,
    teaser: raw.teaser,
    sections,
    ...(sel.rates ? { rates: sel.rates } : {}),
    dryRun,
    warnings,
  };
}
