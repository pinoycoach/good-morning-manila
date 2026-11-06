import { mergeGroups, triage } from "./cluster.js";
import type { RecentCoverage } from "./memory.js";
import { config } from "./config.js";
import type { ScoredStory, Selection, Story } from "./types.js";
import { canonicalUrl } from "./util.js";

/** Money: the peso, prices, oil, inflation, rates, remittances, jobs. The heart of the brief. */
const MONEY_TERMS = /\b(pesos?|php|dollar|exchange rate|forex|remittances?|padala|inflation|prices?|oil|gasoline|diesel|lpg|rice|electricity|meralco|water rates?|fares?|tax(es)?|bir|interest rates?|bsp|bangko sentral|gdp|economy|wages?|minimum wage|salar(y|ies)|jobs?|employment|unemployment|bonus|13th month|sss|philhealth|pag-?ibig|gsis|loans?|savings?|banks?|gcash|maya|fees?)\b/i;
/** The core of the brief: what moves the padala and the grocery bill. */
const CORE_MONEY = /\b(pesos?|exchange rate|remittances?|padala|inflation|oil|fuel|gasoline|diesel|lpg|rice|prices?|rollback|price hike)\b/i;
/** OFWs, migrants and families abroad. */
const OFW_TERMS = /\b(ofws?|overseas filipinos?|migrant workers?|filipino workers?|dmw|owwa|poea|mwo|polo|deploy\w*|repatriat\w*|visas?|work permits?|immigration|uscis|green cards?|h-?1b|caregivers?|seafarers?|domestic workers?|kasambahay|filipino[- ]americans?|fil-?ams?|diaspora|balikbayan)\b/i;
/** Where OFWs work. Counts only together with a Filipino word: "Saudi" alone is foreign news. */
const HOST_COUNTRIES = /\b(saudi|uae|dubai|abu dhabi|qatar|kuwait|bahrain|oman|hong kong|singapore|japan|taiwan|korea|canada|united states|u\.s\.|uk|italy|israel)\b/i;
const PH_TERMS = /\b(philippin\w*|filipin\w*|ph|manila|cebu|davao|pinoy|ofws?|pesos?|dmw|owwa|bsp|doe|dti|psa)\b/i;
/** Things a family can act on: a deadline, a new fee, a requirement, a scam warning, an advisory. */
const ACTION_TERMS = /\b(deadline|apply|application|requirements?|registration|register|renew\w*|advisory|reminder|scams?|warn\w*|fraud|rollback|price hike|increase|discount|refund|claim|benefits?|assistance|ayuda|hotline|how to|guide|tips?)\b/i;
/** Hard politics and crime: low on controversy, so these sink unless they change money or OFW rules. */
const POLITICS_TERMS = /\b(snubs?|hearing|inquiry|deport\w*|pogos?|senat\w*|congress\w*|impeach\w*|election\w*|comelec|party-?list|opposition|duterte|marcos|sara|rodrigo|bongbong|icc|killed|murder\w*|shooting|arrest\w*|drugs?|rape|stabb\w*)\b/i;

const words =(s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);

function similar(a: string, b: string): boolean {
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return false;
  const shared = [...wa].filter((w) => wb.has(w)).length;
  return shared / Math.min(wa.size, wb.size) >= 0.6;
}

/** Merges duplicate coverage into one story; the extra outlets become `related` follow-on links. */
export function dedupe(stories: Story[]): Story[] {
  const kept: Story[] = [];
  // HN stories first so they win the merge and keep their discussion data.
  for (const s of [...stories].sort((a, b) => Number(!!b.hn) - Number(!!a.hn))) {
    const dup = kept.find(
      (k) => k.kind === s.kind && (canonicalUrl(k.url) === canonicalUrl(s.url) || similar(k.title, s.title)),
    );
    if (!dup) {
      kept.push({ ...s });
      continue;
    }
    dup.summary ??= s.summary;
    if (canonicalUrl(dup.url) !== canonicalUrl(s.url)) {
      dup.related = [...(dup.related ?? []), { source: s.source, title: s.title, url: s.url }];
    }
  }
  return kept;
}

function scoreNews(s: Story): ScoredStory {
  const haystack = `${s.title} ${s.summary ?? ""}`;
  const reasons: string[] = [];
  // Relevance is to our reader: money and OFW news first; politics only when it moves money or OFW rules.
  const money = MONEY_TERMS.test(haystack);
  const ofw = OFW_TERMS.test(haystack) || (HOST_COUNTRIES.test(haystack) && /\b(filipin\w*|pinoys?|kababayan)\b/i.test(haystack));
  const politics = POLITICS_TERMS.test(haystack);
  let relevance = money && ofw ? 1.5 : ofw ? 1.2 : money ? 1 : PH_TERMS.test(haystack) ? 0.5 : 0.15;
  if (politics && !money && !ofw) relevance = Math.min(relevance, 0.2);
  reasons.push(`relevance ${relevance}${ofw ? " (OFW)" : ""}${money ? " (money)" : ""}${politics ? " (politics)" : ""}`);

  // Some feeds stamp local time as UTC, which reads as "from the future"; never let that count as extra fresh.
  const ageHours = Math.max(0, s.publishedAt ? (Date.now() - Date.parse(s.publishedAt)) / 3.6e6 : 12);
  const weight = config.feeds.find((f) => f.name === s.source)?.weight ?? 1;
  const momentum = weight * Math.max(0.1, 1 - ageHours / config.maxAgeHours);
  reasons.push(`${s.source}, ${ageHours.toFixed(1)}h old`);

  const coverage = (s.related?.length ?? 0) * 0.5;
  if (coverage) reasons.push(`covered by ${s.related!.length} more outlet(s)`);
  const core = CORE_MONEY.test(haystack) ? 0.6 : 0;
  if (core) reasons.push("peso or prices");
  const action = ACTION_TERMS.test(haystack) ? 0.3 : 0;
  if (action) reasons.push("something to act on");
  return { ...s, score: relevance * (1 + momentum + coverage) + core + action, weird: 0, reasons };
}

export async function score(stories: Story[], opts: { cluster?: boolean; recent?: RecentCoverage } = {}): Promise<Selection> {
  const unique = dedupe(stories);
  const all = unique.filter((s) => s.kind === "news").map(scoreNews).sort((a, b) => b.score - a.score);
  // Opinion columns feed "Sabi nila" only; they are never news.
  let news = all.filter((s) => !s.opinion);
  const columns = all.filter((s) => s.opinion);
  const history = unique.filter((s) => s.kind === "history").map((s): ScoredStory => ({ ...s, score: 0, weird: 0, reasons: ["today in history"] }));

  // Memory, cheap pass: the exact link readers already got, or a near-identical headline, is dropped outright.
  // Different outlets on the same event are left for the triage model, which can tell a repeat from an update.
  if (opts.recent) {
    const { urls, headlines } = opts.recent;
    const before = news.length;
    news = news.filter((s) => !urls.has(canonicalUrl(s.url)) && !headlines.some((h) => similar(h.title, s.title)));
    if (before > news.length) console.log(`  skipped ${before - news.length} story(ies) readers already got`);
  }

  // Small-model pass: merge same-event reports and rate relevance to our reader. Keyword scoring got the
  // candidates this far; the rating decides who she actually hears about. Every feed story is a candidate
  // (there are few and we chose the feeds for her); HN contributes its top 30.
  if (opts.cluster !== false) {
    const candidates = news.slice(0, 60);
    const { groups, ratings } = await triage(candidates, opts.recent?.headlines);
    const merged = mergeGroups(candidates, groups);
    const rest = news.filter((s) => !candidates.some((c) => c.id === s.id));
    news = [...merged, ...rest]
      .map((s) => {
        const r = ratings.get(s.id);
        if (!r) return s;
        // A repeat with nothing new sinks to the bottom; a real update keeps most of its weight and is labelled.
        const weight = [0.1, 0.5, 1, 1.6][r.relevance] * (r.repeat === "same" ? 0.05 : r.repeat === "update" ? 0.8 : 1);
        const keyword = Number(/relevance ([\d.]+)/.exec(s.reasons[0] ?? "")?.[1] ?? 1);
        const memory = r.repeat === "same" ? ["already covered"] : r.repeat === "update" ? ["update to a recent story"] : [];
        const tool = r.usableTool ? ["actionable"] : [];
        return {
          ...s,
          score: (s.score / keyword) * weight,
          reasons: [`reader relevance ${r.relevance}/3: ${r.why}`, ...memory, ...tool, ...s.reasons.slice(1)],
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  const used = new Set<string>();
  const take = (pool: ScoredStory[], n: number, ok: (s: ScoredStory) => boolean = () => true) => {
    const picked = pool.filter((s) => !used.has(s.id) && ok(s)).slice(0, n);
    picked.forEach((s) => used.add(s.id));
    return picked;
  };

  const relevant = (s: ScoredStory) =>
    !s.reasons.some(
      (r) => r.startsWith("relevance 0.15") || r.startsWith("reader relevance 0/") || r.startsWith("reader relevance 1/") || r === "already covered",
    );
  const deepDives = take(news, 3, relevant);
  if (deepDives.length < 3) deepDives.push(...take(news, 3 - deepDives.length));

  // Diskarte: one item a family can act on (a deadline, a fee, a requirement, a scam warning).
  // The triage model's "actionable" judgment first; keyword rules are the fallback for dry runs.
  const gem =
    take(news, 1, (s) => s.reasons.includes("actionable") && relevant(s))[0] ??
    take(news, 1, (s) => s.reasons.includes("something to act on") && relevant(s))[0] ??
    take(news, 1)[0];
  if (!gem) throw new Error("No Diskarte candidate.");

  const fresh = (s: ScoredStory) => !s.reasons.includes("already covered");
  // Politics-only stories never fill the quick hits; politics that moves money or OFW rules can.
  const politicsOnly = (s: ScoredStory) => {
    const r = s.reasons.find((x) => x.startsWith("relevance")) ?? "";
    return r.includes("(politics)") && !r.includes("(OFW)") && !r.includes("(money)");
  };
  const quickHits = take(news, 4, (s) => fresh(s) && !politicsOnly(s));
  const opinions = columns.slice(0, 4);
  if (history.length === 0) console.log("  no Philippine event in today's history feed; Noong araw will be skipped");

  return { deepDives, gem, quickHits, offbeat: history.slice(0, 2), opinions, recent: opts.recent?.headlines };
}
