try {
  process.loadEnvFile();
} catch {
  // No .env file; rely on the real environment.
}

export const config = {
  newsletterName: process.env.NEWSLETTER_NAME || "Good Morning Manila",
  editor: process.env.NEWSLETTER_EDITOR || "Napoleon Beltran",
  /** Where the Facebook post and previews link; the page itself is the home for now. */
  siteUrl: (process.env.SITE_URL || "https://diskartedaily.com").replace(/\/$/, ""),
  /** The Facebook page the brief is posted on. */
  pageName: process.env.PAGE_NAME || "Digitally Manila",
  /** Where "Subscribe" goes (email list), once there is one. Empty: no subscribe line. */
  subscribeUrl: process.env.SUBSCRIBE_URL || "",

  model: "claude-opus-5-5",
  /** Groups same-event stories and rates them for the reader; a small, cheap job. */
  clusterModel: "claude-haiku-5-5",
  /** Hosts whose pages are posts, not reporting. A lead story resting on one gets flagged. */
  socialHosts: [/\.social$/, /^(x|twitter|bsky|threads|reddit|linkedin|facebook|mastodon)\.(com|app|net|org)$/, /^news\.ycombinator\.com$/],

  maxAgeHours: 30,

  /**
   * The reader: Filipinos at home and abroad, OFWs, Filipino Americans and their families. Economy first:
   * the peso, prices, oil, policies that touch OFWs and families. Low on politics and controversy.
   * Checked 2026-11-06 from a cloud session: Inquirer, PhilStar, BusinessWorld, Arab News and Asian Journal
   * answered; Rappler refused the cloud session (it answers GitHub Actions for Diskarte) [check in the first run].
   * Google News RSS is NOT used: its terms allow personal, non-commercial use only.
   */
  feeds: [
    // OFWs and the diaspora
    { name: "Inquirer Global Nation", url: "https://globalnation.inquirer.net/feed", weight: 1.2 },
    { name: "Asian Journal", url: "https://www.asianjournal.com/feed/", weight: 1.1 },
    { name: "Arab News", url: "https://www.arabnews.com/cat/1/rss.xml", weight: 0.9 },
    // Economy, prices, policy
    { name: "BusinessWorld", url: "https://www.bworldonline.com/economy/feed/", weight: 1.3 },
    { name: "Inquirer Business", url: "https://business.inquirer.net/feed", weight: 1.2 },
    { name: "PhilStar Business", url: "https://www.philstar.com/rss/business", weight: 1.2 },
    { name: "Rappler", url: "https://www.rappler.com/business/feed/", weight: 1.2 },
    // General news, lower weight: policy that touches families, without the politics
    { name: "PhilStar", url: "https://www.philstar.com/rss/headlines", weight: 0.8 },
    { name: "Inquirer", url: "https://newsinfo.inquirer.net/feed", weight: 0.8 },
    // Opinion, for "Sabi nila": named columnists, quoted short and labelled as opinion
    { name: "PhilStar Opinion", url: "https://www.philstar.com/rss/opinion", weight: 0.7, opinion: true },
  ] as { name: string; url: string; weight: number; opinion?: boolean }[],

  bannedWords: [
    "delve", "tapestry", "testament", "game-changer", "game changer", "fast-paced world", "landscape",
    "leverage", "synergy", "as someone who",
  ],
};

export const DAY_MS = 24 * 3600 * 1000;
