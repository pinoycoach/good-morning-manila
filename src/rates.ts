import { getJson } from "./util.js";

/**
 * "Piso ngayon": peso reference rates, fetched by code, never written by the AI.
 * Source: the European Central Bank's daily reference rates via Frankfurter (free, no key). The BSP's own
 * reference-rate page refused a cloud session on 2026-11-06, so the ECB rate is used and named. Remittance
 * companies' rates differ from reference rates; the issue says so.
 */
export interface PesoRate {
  code: string;
  label: string;
  /** Pesos per 1 unit of the currency. */
  php: number;
  /** Pesos per unit on the previous published day and about 30 days ago. */
  prev?: number;
  monthAgo?: number;
}

export interface Rates {
  /** Date the rates are for (ECB publishes on working days). */
  date: string;
  source: string;
  sourceUrl: string;
  rates: PesoRate[];
}

/** Currencies OFWs and families send from, as far as the ECB covers them (no Gulf currencies in its set). */
const CURRENCIES: [string, string][] = [
  ["USD", "US dollar"],
  ["CAD", "Canadian dollar"],
  ["GBP", "British pound"],
  ["EUR", "Euro"],
  ["SGD", "Singapore dollar"],
  ["HKD", "Hong Kong dollar"],
  ["AUD", "Australian dollar"],
  ["JPY", "Japanese yen"],
];

const BASE = "https://api.frankfurter.dev/v1";

interface Series {
  rates: Record<string, Record<string, number>>;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Rates for `today` (or the latest working day before it), with the previous day and ~30 days earlier. */
export async function fetchRates(today: string): Promise<Rates> {
  const end = new Date(`${today}T00:00:00Z`);
  const start = new Date(end.getTime() - 35 * 86_400_000);
  // Frankfurter quotes "1 PHP = x foreign"; inverting gives pesos per unit.
  const data = await getJson<Series>(`${BASE}/${isoDay(start)}..${isoDay(end)}?base=PHP&symbols=${CURRENCIES.map(([c]) => c).join(",")}`);
  const days = Object.keys(data.rates ?? {}).sort();
  if (!days.length) throw new Error("No reference rates returned.");
  const last = days[days.length - 1];
  const prev = days[days.length - 2];
  const target = isoDay(new Date(end.getTime() - 30 * 86_400_000));
  const monthAgo = days.find((d) => d >= target) ?? days[0];
  const pesos = (day: string | undefined, code: string) => {
    const v = day ? data.rates[day]?.[code] : undefined;
    return v ? 1 / v : undefined;
  };
  return {
    date: last,
    source: "European Central Bank reference rates (via Frankfurter)",
    sourceUrl: "https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html",
    rates: CURRENCIES.map(([code, label]) => ({
      code,
      label,
      php: pesos(last, code)!,
      prev: pesos(prev, code),
      monthAgo: monthAgo !== last ? pesos(monthAgo, code) : undefined,
    })).filter((r) => r.php),
  };
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const change = (now: number, then?: number) => {
  if (!then) return "";
  const d = now - then;
  if (Math.abs(d) < 0.005) return "unchanged";
  return `${d > 0 ? "up" : "down"} ₱${fmt(Math.abs(d))}`;
};

/** Plain-text lines for the issue and the Facebook post. Numbers only from the fetched data. */
export function rateLines(r: Rates): string[] {
  const usd = r.rates.find((x) => x.code === "USD");
  const lines: string[] = [];
  if (usd) {
    lines.push(
      `$1 = ₱${fmt(usd.php)}${usd.prev ? ` (${change(usd.php, usd.prev)} from the previous day` : ""}${usd.monthAgo ? `${usd.prev ? "; " : " ("}${change(usd.php, usd.monthAgo)} in about a month)` : usd.prev ? ")" : ""}`,
      `$500 sent home = about ₱${Math.round(usd.php * 500).toLocaleString("en-US")} at the reference rate, before fees.`,
    );
  }
  return lines;
}
