/** Sends a plain-text message to the owner (Telegram, and Discord if set). Never throws. */
export async function notify(text: string): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  if (process.env.DISCORD_WEBHOOK_URL) {
    jobs.push(fetch(process.env.DISCORD_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text }),
    }));
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    jobs.push(fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text }),
    }));
  }
  for (const r of await Promise.allSettled(jobs)) {
    if (r.status === "rejected") console.warn(`  ! preview notification failed: ${r.reason}`);
  }
}
