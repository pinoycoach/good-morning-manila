import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { buildKit } from "./distribution-kit.js";
import { harvest } from "./harvester.js";
import { recentCoverage } from "./memory.js";
import { fetchRates, rateLines } from "./rates.js";
import { readSources } from "./reader.js";
import { score } from "./scorer.js";
import type { Issue, Selection } from "./types.js";
import { todayLocal } from "./util.js";
import { isLegalWarning, write } from "./writer.js";
import { notify } from "./notify.js";

const DIST = path.resolve("dist");
const issueDir = (date: string) => path.join(DIST, `issue-${date}`);

/** Files copied into the private preview (the workflow puts them on diskartedaily.com/drafts/<token>/gmm-<date>/). */
export const PREVIEW_FILES = ["index.html", "facebook.html", "review.md", "og"];

/** The private preview address, when DRAFT_TOKEN is set. */
const previewUrl = (date: string) =>
  process.env.DRAFT_TOKEN ? `${config.siteUrl}/drafts/${process.env.DRAFT_TOKEN}/gmm-${date}/` : undefined;

function reviewNotes(issue: Issue, sel: Selection): string {
  const picked = [
    ...sel.deepDives.map((s, i) => [`${i + 1} Balita`, s] as const),
    ["4 Diskarte", sel.gem] as const,
    ...sel.opinions.map((s) => ["5 Sabi nila", s] as const),
    ...sel.quickHits.map((s) => ["6 Iba pa", s] as const),
    ...sel.offbeat.map((s) => ["7 Noong araw", s] as const),
  ];
  return `# Review: ${issue.title} (${issue.date})

${issue.warnings.length ? `## Warnings (${issue.warnings.length})\n${issue.warnings.map((w) => `- ${w}`).join("\n")}` : "## Warnings\nNone."}

## Legal desk (read before posting)
- [ ] Every claim has its source link, and the link says what we say it says.
- [ ] Every number is copied from its source. Peso rates come from the rate block only.
- [ ] Quotes are short, word for word, and credited. Opinions (Sabi nila) are labelled as the columnist's view.
- [ ] Any accusation against a named person or company: "alleged", their response included or "no response in the coverage", two sources or flagged. No commentary on cases about named officials. Libel is a crime in the Philippines.
- [ ] No financial advice: nothing tells readers to buy, sell, convert or time a transfer.
- [ ] No private person's details.
- [ ] History item has its source.
- [ ] Ask a lawyer before posting anything that keeps an accusation against a named person.

## Selected stories
| Section | Score | Story | Article read? | Why |
|---|---|---|---|---|
${picked.map(([n, s]) => `| ${n} | ${s.score.toFixed(2)} | [${s.title.replace(/\|/g, "/")}](${s.url}) | ${s.article?.status === "ok" ? "yes" : "no"} | ${s.reasons.join("; ")} |`).join("\n")}
`;
}

/** Short form of a warning for the phone: section, then the gist. */
const shortFlag = (w: string) => `⚠ ${w.replace(/\. Open the sources.*$/, "").slice(0, 160)}`;

/** The morning ping: legal flags first, then the links in order. */
export function pingText(issue: Issue, preview: string | undefined): string {
  const legal = issue.warnings.filter(isLegalWarning);
  return [
    ...(legal.length ? [`⚠ ${legal.length} TO CHECK BEFORE POSTING (legal desk)`, ...legal.map(shortFlag), ""] : ["✅ No legal flags today."]),
    `${issue.newsletterName} ${issue.date}: "${issue.title}"${issue.dryRun ? " (DRY RUN)" : ""}`,
    ...(issue.rates ? [issue.rates.lines[0] ?? ""] : ["Peso rate: not available today (see review)."]),
    "",
    preview ? `1. Read: ${preview}` : `1. Read: dist/issue-${issue.date}/index.html`,
    ...(preview ? [`   Legal desk checklist: ${preview}review.md`] : []),
    "   Changes? Tell Claude before posting.",
    preview ? `2. Facebook (${config.pageName}): ${preview}facebook.html` : "2. Facebook: facebook.html",
    "   Nothing posts by itself.",
    ...(issue.warnings.length > legal.length ? ["", `Plus ${issue.warnings.length - legal.length} minor note(s) in the review.`] : []),
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n")
    .slice(0, 3900);
}

async function draft(flags: Set<string>): Promise<void> {
  const date = todayLocal();
  const dir = issueDir(date);
  if (existsSync(path.join(dir, "issue.json"))) {
    if (!flags.has("--force")) {
      if (process.env.GITHUB_ACTIONS) {
        console.log(`A draft for ${date} already exists; nothing to do. Use the "force" option to draft again.`);
        return;
      }
      throw new Error(`A draft for ${date} already exists in ${dir}. Rerun with --force to move it aside and draft again.`);
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await rename(dir, `${dir}-replaced-${stamp}`);
    console.log(`Moved the previous draft to issue-${date}-replaced-${stamp}/`);
  }
  await mkdir(dir, { recursive: true });

  console.log("1/6 Peso rates…");
  let rates: Selection["rates"];
  try {
    const data = await fetchRates(date);
    rates = { data, lines: rateLines(data) };
    console.log(`  ${rates.lines[0]}`);
  } catch (err) {
    console.warn(`  ! rates unavailable: ${err instanceof Error ? err.message : err}`);
  }

  console.log("2/6 Harvesting…");
  const stories = await harvest();
  await writeFile(path.join(dir, "stories.json"), JSON.stringify(stories, null, 2));

  console.log("3/6 Scoring…");
  const recent = await recentCoverage(date);
  if (recent.urls.size) console.log(`  memory: ${recent.urls.size} link(s) from the last 4 days' briefs`);
  const sel = await score(stories, { cluster: !flags.has("--dry-run"), recent });
  if (rates) sel.rates = rates;

  console.log("4/6 Reading the selected sources…");
  await readSources(sel);
  await writeFile(path.join(dir, "selection.json"), JSON.stringify(sel, null, 2));

  console.log(`5/6 Writing${flags.has("--dry-run") ? " (dry run)" : ` with ${config.model}`}…`);
  const issue = await write(sel, date, { dryRun: flags.has("--dry-run") });
  if (!rates) issue.warnings.push("Peso rates could not be fetched today; Piso ngayon is missing. Check before posting.");
  await writeFile(path.join(dir, "issue.json"), JSON.stringify(issue, null, 2));

  console.log("6/6 Building the preview and Facebook page…");
  await buildKit(issue, dir);
  await writeFile(path.join(dir, "review.md"), reviewNotes(issue, sel));

  const preview = previewUrl(date);
  console.log(`\nDraft ready: "${issue.title}"\n  ${path.join(dir, "index.html")}\n  ${issue.warnings.length} warning(s), see review.md`);
  if (preview) console.log(`Preview (once the workflow copies it): ${preview}`);
  // The ping is saved too, so the workflow can send it after the preview is online (npm run ping).
  await writeFile(path.join(dir, "ping.txt"), pingText(issue, preview));
  // Tells the workflow this run made a new draft, so the later steps (preview, ping) run once, not on every backup run.
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "drafted=true\n");
  if (flags.has("--no-ping")) console.log("\n--- ping (not sent) ---\n" + pingText(issue, preview));
  else await notify(pingText(issue, preview));
}

/** Regenerates the pages from issue.json, so hand edits reach the preview and the Facebook text. */
async function rebuild(date: string | undefined): Promise<void> {
  date ??= todayLocal();
  const dir = issueDir(date);
  const issue = JSON.parse(await readFile(path.join(dir, "issue.json"), "utf8")) as Issue;
  await buildKit(issue, dir);
  console.log(`Rebuilt ${dir}. Nothing has been posted.`);
}

const [command, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const positional = rest.filter((a) => !a.startsWith("--"));

try {
  if (command === "draft") await draft(flags);
  else if (command === "rebuild") await rebuild(positional[0]);
  else if (command === "ping") {
    const file = path.join(issueDir(positional[0] ?? todayLocal()), "ping.txt");
    if (existsSync(file)) await notify(await readFile(file, "utf8"));
    else console.log(`No ping saved at ${file} (no draft today, or it was skipped).`);
  }
  else console.log("Usage: npm run draft [-- --dry-run --force --no-ping] | npm run rebuild [-- <date>] | npm run ping [-- <date>]");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\nError: ${message}`);
  if (command === "draft") await notify(`${config.newsletterName} draft FAILED for ${todayLocal()}: ${message.slice(0, 300)}`);
  process.exitCode = 1;
}
