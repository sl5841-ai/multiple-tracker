// Headline sentiment from a finance word list: each positive cue scores +1, each negative cue -1.
// Rule-based and headline-only, so it is a quick read of the wording, not of the story or its market impact.
const POSITIVE = [
  "beat", "beats", "tops", "topped", "exceeds", "exceeded", "surge", "surges", "surged", "soar", "soars", "soared",
  "jump", "jumps", "jumped", "rally", "rallies", "rallied", "gain", "gains", "gained", "rise", "rises", "rose", "climbs", "climbed",
  "record", "upgrade", "upgrades", "upgraded", "outperform", "outperforms", "raises", "raised", "boost", "boosts", "boosted",
  "strong", "stronger", "strength", "growth", "grows", "profit", "profitable", "wins", "win", "won", "approval", "approved", "approves",
  "bullish", "breakout", "expands", "expansion", "partnership", "buyback", "upbeat", "optimistic", "rebound", "rebounds", "recovers",
  "higher", "highs", "accelerates", "overweight", "advance", "advances", "lift", "lifts", "lifted", "beating", "outpaces", "soaring",
];
const NEGATIVE = [
  "miss", "misses", "missed", "fall", "falls", "fell", "drop", "drops", "dropped", "plunge", "plunges", "plunged", "slump", "slumps",
  "tumble", "tumbles", "tumbled", "sink", "sinks", "sank", "slide", "slides", "slid", "decline", "declines", "declined", "lower", "lows",
  "downgrade", "downgrades", "downgraded", "underperform", "underweight", "cut", "cuts", "slashes", "slashed", "lawsuit", "sues", "sued",
  "probe", "investigation", "recall", "recalls", "layoffs", "layoff", "warns", "warning", "loss", "losses", "weak", "weaker", "weakness",
  "bearish", "bubble", "crash", "crashes", "fraud", "fined", "fine", "halt", "halts", "delay", "delays", "delayed", "concern", "concerns",
  "fears", "selloff", "sell-off", "bankruptcy", "default", "disappoints", "disappointing", "slowdown", "slows", "pressure", "risks",
  "struggles", "worst", "plummets", "tanks", "retreats", "retreat",
];
const POS = new Set(POSITIVE), NEG = new Set(NEGATIVE);
const NEGATORS = new Set(["not", "no", "never", "without", "fails", "failed", "can't", "won't", "unlikely"]);
// multi-word cues, checked before single words
const PHRASES = [
  ["all-time high", 1], ["record high", 1], ["52-week high", 1], ["price target raised", 1], ["raises price target", 1],
  ["all-time low", -1], ["52-week low", -1], ["price target cut", -1], ["cuts price target", -1], ["guidance cut", -1], ["cuts guidance", -1],
];

export function headlineSentiment(title) {
  // "Shares fall despite earnings beat": the clause after "despite" / "even as" describes what did NOT drive the move
  const main = String(title).toLowerCase().split(/\b(?:despite|even as|even though)\b/)[0];
  let score = 0;
  const cues = [];
  let rest = main;
  for (const [p, sign] of PHRASES) if (rest.includes(p)) { score += sign; cues.push(p); rest = rest.split(p).join(" "); }
  const words = rest.match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
  words.forEach((w, i) => {
    const sign = POS.has(w) ? 1 : NEG.has(w) ? -1 : 0;
    if (!sign) return;
    // "not expected to rebound": a negator up to three words back flips the cue
    const flipped = [1, 2, 3].some((k) => NEGATORS.has(words[i - k]));
    score += flipped ? -sign : sign;
    cues.push(flipped ? `not ${w}` : w);
  });
  return { sentiment: score > 0 ? "positive" : score < 0 ? "negative" : "neutral", cues };
}

// Does the headline name the company? Matches the ticker as a word, or a distinctive word from the company name.
const GENERIC = new Set(["inc", "corp", "corporation", "co", "company", "the", "group", "holdings", "holding", "ltd", "plc", "new", "class",
  "trust", "etf", "fund", "shares", "international", "technologies", "technology", "systems", "and"]);
export function mentionsCompany(title, symbol, name) {
  const t = String(title);
  if (new RegExp(`(^|[^A-Za-z])${symbol.replace(/[.-]/g, "[.\-]")}([^A-Za-z]|$)`).test(t)) return true;
  // compare without spaces too, so "ExxonMobil" in a name matches "Exxon Mobil" in a headline and vice versa
  const lower = t.toLowerCase(), squashed = lower.replace(/[^a-z0-9]/g, "");
  return String(name).toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 4 && !GENERIC.has(w) && (lower.includes(w) || squashed.includes(w)));
}
