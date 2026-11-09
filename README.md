# Good Morning Manila

A calm, sourced, economy-first morning brief for Filipinos at home and abroad: OFWs, Filipino Americans and their
families. Posted by hand on the **Digitally Manila** Facebook page. Built on the Diskarte Daily machine.

**Nothing posts by itself.** Each weekday morning a draft is written, a private preview goes up, and a Telegram
ping arrives with the legal-desk flags first. Napoleon reads it, then posts it on Facebook.

## What's in a brief
- **Piso ngayon:** the dollar-peso reference rate (and 7 other currencies), change from the previous day and over
  about a month, and "$500 sent home = about ₱…". Fetched by code from the European Central Bank's reference rates
  (via Frankfurter); the AI never writes these numbers.
- **Balita (3):** the lead stories on the peso, prices, oil, jobs and OFW policy, each with "Para sa pamilya".
- **Diskarte:** one thing a family can do this week (a deadline, fee, requirement, benefit, scam warning).
- **Sabi nila:** up to 3 named columnists' views, quoted short, linked and labelled as opinion.
- **Iba pang balita:** 3-4 quick items.
- **Noong araw:** a Philippine event on this day, from Wikipedia's "On this day" (skipped if none).

## Guardrails (carried over from Diskarte Daily, plus a legal desk)
Only links from harvested sources; quotes of 4+ words must appear in the source; no em dashes; accusations flagged
(alleged, response, two sources); no commentary on cases about named officials; no financial advice (flagged);
opinion only from named columnists; AI-disclosure, "not financial advice" and "we never message you about money"
on every brief. `review.md` carries the legal-desk checklist. A lawyer before keeping any accusation.

## Setup (once)
1. **Secrets** (repo → Settings → Secrets and variables → Actions → New repository secret):
   - `ANTHROPIC_API_KEY`: same key as Diskarte Daily.
   - `TELEGRAM_BOT_TOKEN`: same bot as Diskarte Daily.
   - `TELEGRAM_CHAT_ID`: the new **GMM desk** Telegram group's id (not Diskarte's).
   - `DRAFT_TOKEN`: the private path segment for previews (Claude gives you one).
   - `DISKARTE_DISPATCH_TOKEN`: a fine-grained GitHub token with **Actions: read and write** on
     `pinoycoach/diskarte-daily` only. It can start Diskarte's "GMM preview" workflow but cannot change its code.
     Diskarte holds the other half: `GMM_READ_TOKEN` (Contents: read on this repo only) to copy the preview in.
2. **Timer:** a cron-job.org job at **05:00 Manila, Monday to Friday**, posting to this repo's `draft.yml`
   workflow_dispatch API (same setup as Diskarte's 04:40 job). GitHub's own backups run at 05:20 and 05:45.

## Commands
- `npm run draft -- --dry-run --no-ping`: full test run, no Claude call, nothing sent.
- `npm run rebuild -- <date>`: regenerate the preview and Facebook text after editing `dist/issue-<date>/issue.json`.
- `npm run ping -- <date>`: resend the saved Telegram ping.
