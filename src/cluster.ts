import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "./config.js";
import type { ScoredStory } from "./types.js";
import { clip } from "./util.js";

const Triage = z.object({
  groups: z
    .array(z.array(z.string()).describe("Story ids that report the same underlying event."))
    .describe("Only groups of 2 or more. Stories about different events never share a group."),
  ratings: z
    .array(
      z.object({
        id: z.string(),
        relevance: z
          .number()
          .int()
          .min(0)
          .max(3)
          .describe("3: directly changes an OFW family's money, costs, papers or safety this week (peso, oil, prices, fees, OFW rules, visas, scams). 2: economy or policy news they'd want explained. 1: Philippine news of passing interest. 0: not for them (partisan politics, crime, celebrity, foreign news with no Filipino angle)."),
        why: z.string().describe("Under 12 words."),
        usableTool: z
          .boolean()
          .describe(
            "true only if a family can act on it this week: a deadline, a new fee or requirement, a benefit to claim, an advisory, a price change to plan around, or a scam warning with what to do. False for analysis, politics or general news.",
          ),
        repeat: z
          .enum(["new", "update", "same"])
          .describe(
            "Against the recently covered headlines: new = not covered; update = same story but this item reports a genuinely new fact (a statement, a fix, a number, an arrest); same = readers already got this story and the item adds nothing material.",
          ),
      }),
    )
    .describe("One rating per story id, all of them."),
});

export type Rating = { relevance: number; why: string; repeat: "new" | "update" | "same"; usableTool: boolean };

/**
 * One small-model pass over the candidates, doing two jobs keyword rules do badly:
 * 1. Group different reports of the same event, so one story can't take two slots.
 * 2. Rate each story's relevance to our reader: OFWs, Filipino Americans and their families.
 * Skipped silently when Claude is unavailable (dry runs); the caller falls back to keyword scoring.
 */
export async function triage(
  candidates: ScoredStory[],
  recentHeadlines: { date: string; title: string }[] = [],
): Promise<{ groups: string[][]; ratings: Map<string, Rating> }> {
  const empty = { groups: [] as string[][], ratings: new Map<string, Rating>() };
  if (candidates.length < 2) return empty;
  const client = new Anthropic();
  try {
    const response = await client.messages.parse({
      model: config.clusterModel,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(Triage) },
      system: `You triage news for "Good Morning Manila", a daily brief for Filipinos at home and abroad: OFWs, Filipino Americans and their families. Economy first: the peso, remittances, oil and prices, inflation, jobs, and government policies that touch OFWs and families (DMW, OWWA, SSS, PhilHealth, Pag-IBIG, taxes, visas). The brief stays low on controversy: partisan politics, crime and celebrity are noise unless they change money or OFW rules.

Jobs:
1. Group items that report the same underlying event (same announcement, price change, policy or incident), even under different headlines or from different outlets. Same topic but different events stay separate.
2. Rate every item's relevance to the reader, 0-3. Peso, oil, price, fee and OFW-policy stories get 3. Economy and policy explainers get 2. Partisan politics, feuds, crime and showbiz are 0 or 1 unless they change money or OFW rules.
3. Mark usableTool (here it means "actionable"): can a family act on it this week?
4. Mark whether each item repeats a story readers already got in the recently covered headlines. A different outlet's write-up of the same event is "same" unless it reports something genuinely new.`,
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            recentlyCovered: recentHeadlines,
            candidates: candidates.map((s) => ({ id: s.id, title: s.title, source: s.source, summary: clip(s.summary ?? "", 200) || undefined })),
          }),
        },
      ],
    });
    const out = response.parsed_output;
    if (!out) {
      console.warn(`  ! triage reply unusable (stop_reason: ${response.stop_reason}); using keyword scores`);
      return empty;
    }
    return {
      groups: out.groups,
      ratings: new Map(out.ratings.map((r) => [r.id, { relevance: r.relevance, why: r.why, repeat: r.repeat, usableTool: r.usableTool }])),
    };
  } catch (err) {
    console.warn(`  ! triage skipped: ${err instanceof Error ? err.message : err}`);
    return empty;
  }
}

/** Merges each group into its top-scoring member; the rest become that story's related links. */
export function mergeGroups(candidates: ScoredStory[], groups: string[][]): ScoredStory[] {
  const byId = new Map(candidates.map((s) => [s.id, s]));
  const absorbed = new Set<string>();
  for (const group of groups) {
    const members = group.map((id) => byId.get(id)).filter((s): s is ScoredStory => !!s && !absorbed.has(s.id));
    if (members.length < 2) continue;
    members.sort((a, b) => b.score - a.score);
    const [primary, ...rest] = members;
    for (const s of rest) {
      absorbed.add(s.id);
      primary.related = [...(primary.related ?? []), { source: s.source, title: s.title, url: s.url }, ...(s.related ?? [])];
      primary.reasons.push(`merged: ${s.source}`);
      // Keep the richer discussion when the duplicate had a bigger HN thread.
      if (s.hn && (!primary.hn || s.hn.comments > primary.hn.comments)) {
        primary.related.push({ source: "Hacker News", title: `Discussion: ${s.title}`, url: s.hn.discussionUrl });
      }
    }
  }
  if (absorbed.size) console.log(`  merged ${absorbed.size} duplicate report(s) of the same event`);
  return candidates.filter((s) => !absorbed.has(s.id));
}
