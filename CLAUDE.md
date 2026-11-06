# Good Morning Manila: context for Claude sessions

A second publication on the Diskarte Daily machine (`pinoycoach/diskarte-daily`; read its CLAUDE.md and LESSONS.md
for the owner, the working rules and the guardrails, which all apply here). Built 2026-11-06.

- **Reader:** OFWs, Filipino Americans and their families, at home and abroad. Economy first (peso, prices, oil,
  jobs, OFW policy), low on controversy (sponsors), never financial advice.
- **Where it goes:** posted by hand on the Digitally Manila Facebook page (189k followers, owner's number).
  Owner is monetized there and on @callmenapoleon; subscriptions come after the 14-day test.
- **Flow:** `draft.yml` (05:00 Manila, outside timer; backups 05:20/05:45) → draft in `dist/issue-<date>/` →
  preview copied to diskartedaily.com/drafts/<DRAFT_TOKEN>/gmm-<date>/ (via DISKARTE_PUSH_TOKEN) → Telegram ping
  to the GMM desk group (not Diskarte's chat). No approve workflow: posting is by hand.
- **Telegram:** pings go to the "GMM desk" group (created 2026-11-06) through the same bot as Diskarte. Bots in
  groups only see commands addressed to them (`/start@diskarte_daily_bot`). If the group is ever upgraded (made public,
  special admin rights, large), its id changes to `-100…`: update the `TELEGRAM_CHAT_ID` secret.
- **Numbers:** peso rates come from `src/rates.ts` (ECB via Frankfurter; BSP refused cloud fetches 2026-11-06).
  The writer must never restate or compute rate numbers.
- **14-day test** (from `diskarte-daily/ideas/good-morning-manila.md`): baseline reach = first 3 days' median.
  Pass: reach ≥ 2× baseline, saves+shares ≥ 1% of reach on 5+ issues, ≥ 20 real comments per issue,
  ≥ 300 email signups or ≥ 100 taps on a subscribe-interest link. Fail: any wrong number needing a correction.
- **Not built yet:** email list, web archive, subscriptions, sponsors. Each needs its own yes.
- Run `npx tsc --noEmit` before committing; `npm run draft -- --dry-run --no-ping` tests end to end for free.
