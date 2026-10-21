// Keep major news; drop opinion, commentary and listicle pieces.
// Two signals: the publisher (outlets that mainly publish commentary or holdings-filing posts) and the headline wording.
const COMMENTARY_PUBLISHERS = [
  "motley fool", "24/7 wall st", "zacks", "simply wall st", "seeking alpha", "investorplace", "insider monkey", "trefis",
  "validea", "finbold", "kiplinger", "investopedia", "marketbeat", "the street pro", "stocknews", "tipranks", "247wallst",
  "moneywise", "moneylion", "stocktwits", "tikr", "moby", "cryptoprowl",
];
const COMMENTARY_HEADLINE = [
  /\bshould you\b/i, /\bis it (too late|time)\b/i, /\bhere'?s (why|what|how|where)\b/i, /\b(i'?d|i would|i'm|i am|my)\b/i,
  /\b(buy|sell|hold)\b.*\?\s*$/i, /\bbetter (buy|stock)\b/i, /^\d+\s|\b\d+\s+(stocks?|reasons?|ways?|things?|charts?)\b/i,
  /\b(millionaire|forever|no-brainer|screaming|bargain|retire|passive income|dividend stocks? to)\b/i, /^prediction:/i,
  /\bforget\b/i, /\bwhat happened to \$/i, /\$[\d,]+ invested\b/i, /\bbuys\b.*\b(million|billion)\b.*\b(more|stake|shares)\b/i,
  /\b(stake|position) in\b/i, /\bshares (sold|bought|acquired) by\b/i, /\bis (this|it) a buy\b/i, /\bwall street (thinks|says)\b/i,
  /\b(analyst blog highlights|blog highlights)\b/i, /\bvs\.?\s.*:\s/i,
  /\?\s*$/, // questions are almost always commentary ("Can X keep winning?", "Is it a buy?")
  // general market wraps are not news about the holding itself
  /^(stock market today|stock market news for|sector update|how major us stock indexes fared|dow jones futures|stocks? (to watch|making the biggest moves))/i,
  /\bhow to play\b/i, /^why .+ (stock|shares) (rallied|jumped|fell|dropped|soared|sank|plunged)/i, /\bwhat happened to\b/i,
];

export function isMajorNews(n) {
  const pub = String(n.publisher ?? "").toLowerCase();
  if (COMMENTARY_PUBLISHERS.some((p) => pub.includes(p))) return false;
  return !COMMENTARY_HEADLINE.some((re) => re.test(String(n.title ?? "")));
}
