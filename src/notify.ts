import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/** Where a ping waits when the workflow sends it after the commit (DEFER_PING=1). Not committed. */
export const PENDING_PING = ".pending-ping.txt";

/** Sends a plain-text message to the owner (Telegram, and Discord if set). Never throws; logs any failure. */
export async function notify(text: string): Promise<void> {
  const jobs: [string, Promise<Response>][] = [];
  const opts = (body: unknown) => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (process.env.DISCORD_WEBHOOK_URL) jobs.push(["Discord", fetch(process.env.DISCORD_WEBHOOK_URL, opts({ content: text.slice(0, 1990) }))]);
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    jobs.push([
      "Telegram",
      fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, opts({ chat_id: process.env.TELEGRAM_CHAT_ID, text: text.slice(0, 4000) })),
    ]);
  }
  const results = await Promise.allSettled(jobs.map(([, p]) => p));
  results.forEach((r, i) => {
    const name = jobs[i][0];
    if (r.status === "rejected") console.warn(`  ! ${name} ping failed: ${r.reason}`);
    else if (!r.value.ok) console.warn(`  ! ${name} ping refused: HTTP ${r.value.status}`);
  });
}

/**
 * The morning ping. In the workflows (DEFER_PING=1) it is saved and sent by a later step, after the draft is
 * committed and online, so the owner never gets a link to a page that failed to save (audit 2026-11-09).
 */
export async function sendOrDefer(text: string): Promise<void> {
  if (process.env.DEFER_PING !== "1") return notify(text);
  await writeFile(PENDING_PING, text);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "ping=true\n");
  console.log("Ping saved; the workflow sends it after the commit.");
}

/** Sends the saved ping, if any (`npm run ping`). */
export async function sendPending(): Promise<void> {
  if (!existsSync(PENDING_PING)) return console.log("No saved ping.");
  await notify(await readFile(PENDING_PING, "utf8"));
  await rm(PENDING_PING);
}
