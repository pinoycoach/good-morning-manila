import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { config } from "./config.js";
import type { Issue, IssueSection } from "./types.js";
import { escapeHtml, mdToText } from "./util.js";

/** Light markdown -> HTML. Escapes first, so model text can never inject markup. */
export function inline(md: string): string {
  return escapeHtml(md)
    .replace(/\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2">$1</a>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

/** Markdown -> plain text for Facebook, with each link written out after its label. */
export function plain(md: string): string {
  return md
    .replace(/\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1");
}

export const DISCLOSURE = (issue: Issue) =>
  `Drafted with AI from the day's linked sources, then checked and edited by ${issue.editor}. Information, not financial advice. Mistakes are ours; tell us and we'll fix them.`;
export const NEVER_DM = `${config.newsletterName} will never message you about money, transfers or "fees". Report anyone who does.`;

/** A section with nothing in it is never shown, whatever its number. */
export const isEmptySection = (s: IssueSection) => s.items.length === 0 && !s.body?.trim();

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Piso ngayon as HTML: the rate lines plus a small table, all from code. */
function ratesHtml(issue: Issue): string {
  if (!issue.rates) return "";
  const { data, lines } = issue.rates;
  return `<section class="rates">
  <div class="kicker">Piso ngayon</div>
  ${lines.map((l) => `<p class="big">${escapeHtml(l)}</p>`).join("\n  ")}
  <table>${data.rates.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>₱${fmt(r.php)}</td></tr>`).join("")}</table>
  <p class="note">Reference rates for ${escapeHtml(data.date)}: <a href="${escapeHtml(data.sourceUrl)}">${escapeHtml(data.source)}</a>. Remittance companies and banks use their own rates and fees.</p>
</section>`;
}

function renderSection(s: IssueSection): string {
  if (isEmptySection(s)) return "";
  return `<section>
  ${s.kicker ? `<div class="kicker">${escapeHtml(s.kicker)}</div>` : ""}
  ${s.number <= 4 ? `<h3>${escapeHtml(s.headline)}</h3>` : ""}
  ${s.body ? `<p>${inline(s.body)}</p>` : ""}
  ${s.items.map((it) => `<p class="item">${it.leadIn ? `<strong>${escapeHtml(it.leadIn)}:</strong> ` : ""}${inline(it.text)}</p>`).join("\n  ")}
  ${s.soWhat ? `<p class="sowhat"><strong>Para sa pamilya:</strong> ${inline(s.soWhat)}</p>` : ""}
</section>`;
}

const STYLE = `
:root{--bg:#fffaf2;--fg:#1d1b18;--muted:#6f6a61;--accent:#c2410c;--rule:#eadfce}
@media (prefers-color-scheme:dark){:root{--bg:#14120f;--fg:#efe9df;--muted:#a59d90;--accent:#fb923c;--rule:#2d2924}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.6 Georgia,"Times New Roman",serif}
main{max-width:680px;margin:0 auto;padding:28px 16px 64px}a{color:var(--accent)}
.mast{font:700 13px/1.2 system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--accent)}
h1{font-size:32px;line-height:1.15;margin:10px 0 6px}.teaser,.byline{color:var(--muted)}.byline{font:14px system-ui,sans-serif}
section{border-top:1px solid var(--rule);padding:20px 0}
.kicker{font:700 12px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
h3{font-size:23px;margin:6px 0}.item{margin:10px 0}
.sowhat{border-left:3px solid var(--accent);padding:6px 12px;margin:14px 0;font:15px/1.5 system-ui,sans-serif}
.rates .big{font:700 20px/1.4 system-ui,sans-serif;margin:6px 0}.rates table{font:15px system-ui,sans-serif;border-collapse:collapse;margin:8px 0}
.rates td{padding:2px 16px 2px 0}.note{font:13px/1.5 system-ui,sans-serif;color:var(--muted)}
footer{border-top:1px solid var(--rule);padding-top:16px;font:13px/1.6 system-ui,sans-serif;color:var(--muted)}
.dry{background:#ffd23f;color:#111;padding:10px 16px;font:600 14px system-ui,sans-serif;text-align:center}`;

/** The reading copy: the whole brief, for the owner's morning check and, later, the web. */
export function renderWebPage(issue: Issue): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(issue.title)} | ${escapeHtml(issue.newsletterName)}</title>
<style>${STYLE}</style></head><body>
${issue.dryRun ? `<div class="dry">DRY RUN: placeholder text, not for publishing</div>` : ""}
<main>
  <div class="mast">${escapeHtml(issue.newsletterName)}</div>
  <h1>${escapeHtml(issue.title)}</h1>
  <p class="teaser">${escapeHtml(issue.teaser)}</p>
  <p class="byline">By ${escapeHtml(issue.editor)} · ${escapeHtml(issue.date)}</p>
  ${ratesHtml(issue)}
  ${issue.sections.map(renderSection).join("\n")}
  <footer>
    <p>${escapeHtml(DISCLOSURE(issue))} Corrections: ${escapeHtml(config.pageName)} page messages.</p>
    <p><strong>${escapeHtml(NEVER_DM)}</strong></p>
  </footer>
</main></body></html>`;
}

/** The whole brief as one Facebook post: plain text, links written out, rates first. */
export function facebookPost(issue: Issue): string {
  const shown = issue.sections.filter((s) => !isEmptySection(s));
  const lines: string[] = [`☀️ ${issue.newsletterName}, ${issue.date}`, "", issue.title, ""];
  if (issue.rates) lines.push("💵 PISO NGAYON", ...issue.rates.lines, `(Reference rate, ${issue.rates.data.date}. Remittance rates and fees differ.)`, "");
  for (const s of shown) {
    lines.push(`▪️ ${(s.kicker ?? "").toUpperCase()}${s.number <= 4 ? `: ${s.headline}` : ""}`);
    if (s.body) lines.push(mdToText(plain(s.body)));
    for (const it of s.items) lines.push(`• ${it.leadIn ? `${it.leadIn}: ` : ""}${mdToText(plain(it.text))}`);
    if (s.soWhat) lines.push(`👉 Para sa pamilya: ${mdToText(plain(s.soWhat))}`);
    lines.push("");
  }
  lines.push(DISCLOSURE(issue), `⚠️ ${NEVER_DM}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The first `n` sentences of a paragraph, as plain text without links (the links go in the first comment). */
function opening(md: string, n: number, maxChars: number): string {
  const text = mdToText(md).replace(/\s+/g, " ").trim();
  // A sentence ends at . ! or ? followed by a space and a capital or quote: "P7.83 per kWh" and "U.S." stay whole.
  const sentences = text.split(/(?<=[.!?])\s+(?=["“A-Z0-9])/).reduce<string[]>((acc, part) => {
    // "Rep. Santos" is one sentence: a piece ending in a title or abbreviation joins the next one.
    const last = acc[acc.length - 1];
    if (last && /\b(Rep|Sen|Sec|Usec|Gov|Atty|Dr|Mr|Ms|Mrs|Fr|Jr|Sr|St|No|vs|Gen|Col|Engr|Pres|Inc|Corp|Co|Ltd|U\.S|a\.m|p\.m)\.$/.test(last)) acc[acc.length - 1] = `${last} ${part}`;
    else acc.push(part);
    return acc;
  }, []);
  let out = "";
  for (const s of sentences.slice(0, n)) {
    if (out && (out + " " + s).length > maxChars) break;
    out = out ? `${out} ${s}` : s;
  }
  return out;
}

/**
 * The short Facebook post: the rate block, then each lead story as a headline, its opening and "Para sa pamilya".
 * No links in the body (Facebook shows link-heavy posts to fewer people); every source goes in the first comment.
 * The 2026-11-11 audit found the full post ran 7,700 to 8,700 characters with 10 to 15 raw links.
 */
export function facebookShortPost(issue: Issue): string {
  const leads = issue.sections.filter((s) => !isEmptySection(s) && s.number <= 4);
  const lines: string[] = [`☀️ ${issue.newsletterName}, ${issue.date}`, ""];
  if (issue.rates) lines.push("💵 PISO NGAYON", ...issue.rates.lines, `(Reference rate, ${issue.rates.data.date}. Remittance rates and fees differ.)`, "");
  for (const s of leads) {
    lines.push(`▪️ ${s.headline}`);
    if (s.body) lines.push(opening(s.body, 2, 300));
    if (s.soWhat) lines.push(`👉 Para sa pamilya: ${mdToText(s.soWhat)}`);
    lines.push("");
  }
  lines.push("Sources and more stories are in the first comment. 👇", "", "AI-drafted from the linked sources, checked by a person. Information, not financial advice.", `⚠️ ${NEVER_DM}`);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The first comment: every source link in the brief, in order, then the quick items. */
export function facebookSourcesComment(issue: Issue): string {
  const seen = new Set<string>();
  const links = (md: string) =>
    [...md.matchAll(/\[((?:[^\[\]]|\[[^\[\]]*\])+)\]\((https?:\/\/[^)\s]+)\)/g)]
      .filter((m) => !seen.has(m[2]) && seen.add(m[2]))
      .map((m) => `• ${m[1]}: ${m[2]}`);
  const lines: string[] = ["Sources for today's brief:"];
  for (const s of issue.sections.filter((x) => !isEmptySection(x) && x.number <= 4)) {
    lines.push(...links([s.body ?? "", ...s.items.map((i) => i.text)].join("\n")));
  }
  const more = issue.sections.filter((x) => !isEmptySection(x) && x.number > 4).flatMap((s) => s.items.map((i) => `• ${mdToText(plain(i.text))}`));
  if (more.length) lines.push("", "Iba pang balita:", ...more);
  if (issue.rates) lines.push("", `Peso rates: ${issue.rates.data.source}, ${issue.rates.data.sourceUrl}`);
  return lines.join("\n");
}

export const BTN = "font:600 15px system-ui,sans-serif;padding:8px 14px;margin:4px 6px 4px 0;cursor:pointer;border:1px solid #111;border-radius:6px;background:#fff;color:#111";
export const COPY_SCRIPT = `function flash(b,t){const o=b.dataset.label||b.textContent;b.dataset.label=o;b.textContent=t;setTimeout(()=>b.textContent=o,2500)}
function copyText(t,b){(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(()=>flash(b,"Copied"),()=>{const a=document.createElement("textarea");a.value=t;document.body.appendChild(a);a.select();document.execCommand("copy");a.remove();flash(b,"Copied")})}
document.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
if(b.dataset.copyFrom){const el=document.getElementById(b.dataset.copyFrom);copyText(el.value??el.textContent,b)}});`;

/** Preview page for the Facebook step: image and the full post text, each one tap. Nothing posts by itself. */
export function renderFacebookPage(issue: Issue): string {
  const post = facebookPost(issue);
  const short = facebookShortPost(issue);
  const comment = facebookSourcesComment(issue);
  const AREA = "width:100%;font:15px/1.5 system-ui,sans-serif;padding:10px;border:1px solid #eadfce;border-radius:6px";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Facebook: ${escapeHtml(issue.title)}</title></head>
<body style="margin:0;background:#fffaf2;font:16px/1.5 system-ui,sans-serif;color:#1d1b18">
<main style="max-width:640px;margin:0 auto;padding:16px">
<h1 style="font:700 22px Georgia,serif;margin:8px 0 4px">Post for ${escapeHtml(config.pageName)}, ${escapeHtml(issue.date)}</h1>
<p style="margin:0 0 16px;color:#6f6a61">Read it all first. Nothing here posts by itself. Edit freely.</p>
<h2 style="font-size:16px;margin:16px 0 6px">1. Image</h2>
<img src="og/cover.png" alt="Cover card: ${escapeHtml(issue.title)}" style="width:100%;border-radius:6px;border:1px solid #eadfce">
<p><a href="og/cover.png" download="good-morning-manila-${escapeHtml(issue.date)}.png" style="${BTN};display:inline-block;text-decoration:none">Save image</a> <span style="color:#6f6a61;font-size:14px">On a phone: press and hold the image, then Save.</span></p>
<h2 style="font-size:16px;margin:16px 0 6px">2. Short post (${short.length.toLocaleString()} characters, no links)</h2>
<textarea id="fbshort" rows="16" style="${AREA}">${escapeHtml(short)}</textarea>
<button type="button" style="${BTN}" data-copy-from="fbshort">Copy short post</button>
<h2 style="font-size:16px;margin:16px 0 6px">3. First comment: sources (${comment.length.toLocaleString()} characters)</h2>
<p style="margin:0 0 6px;color:#6f6a61;font-size:14px">Post this as the first comment right after posting, so every claim keeps its source.</p>
<textarea id="fbcomment" rows="8" style="${AREA}">${escapeHtml(comment)}</textarea>
<button type="button" style="${BTN}" data-copy-from="fbcomment">Copy first comment</button>
<h2 style="font-size:16px;margin:24px 0 6px">Or: the full brief as one post (${post.length.toLocaleString()} characters, links inside)</h2>
<textarea id="fbpost" rows="10" style="${AREA}">${escapeHtml(post)}</textarea>
<button type="button" style="${BTN}" data-copy-from="fbpost">Copy full post</button>
</main>
<script>${COPY_SCRIPT}</script>
</body></html>`;
}

function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if ((line + " " + word).trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = (line + " " + word).trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, maxChars - 2) + " …";
  }
  return lines;
}

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 1080x1080 morning card: the date, the USD rate (from code) and the lead headline. */
export function renderCover(issue: Issue): Buffer {
  const lines = wrap(issue.title, 22, 4);
  const usd = issue.rates?.data.rates.find((r) => r.code === "USD");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
  <rect width="1080" height="1080" fill="#fffaf2"/>
  <rect x="0" y="0" width="1080" height="20" fill="#c2410c"/>
  <text x="80" y="140" fill="#c2410c" font-family="Liberation Sans, Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="4">☀ GOOD MORNING MANILA</text>
  <text x="80" y="190" fill="#6f6a61" font-family="Liberation Sans, Arial, sans-serif" font-size="30">${xmlEscape(issue.date)}</text>
  ${usd ? `<text x="80" y="330" fill="#1d1b18" font-family="Liberation Sans, Arial, sans-serif" font-size="64" font-weight="700">$1 = ₱${xmlEscape(fmt(usd.php))}</text>
  <text x="80" y="380" fill="#6f6a61" font-family="Liberation Sans, Arial, sans-serif" font-size="26">Reference rate, ${xmlEscape(issue.rates!.data.date)}</text>` : ""}
  ${lines.map((l, i) => `<text x="80" y="${520 + i * 84}" fill="#1d1b18" font-family="Liberation Serif, Georgia, serif" font-size="68" font-weight="700">${xmlEscape(l)}</text>`).join("\n  ")}
  <text x="80" y="1010" fill="#6f6a61" font-family="Liberation Sans, Arial, sans-serif" font-size="26">${xmlEscape(config.pageName)} · Sourced. Checked. Not financial advice.</text>
</svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "Liberation Sans" } }).render().asPng();
}

/** Writes everything for review into `dir`. */
export async function buildKit(issue: Issue, dir: string): Promise<void> {
  await mkdir(path.join(dir, "og"), { recursive: true });
  await writeFile(path.join(dir, "index.html"), renderWebPage(issue));
  await writeFile(path.join(dir, "facebook.html"), renderFacebookPage(issue));
  await writeFile(path.join(dir, "og", "cover.png"), renderCover(issue));
}
