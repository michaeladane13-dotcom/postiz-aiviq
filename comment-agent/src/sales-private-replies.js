export const CHAYA_FACEBOOK_PAGE_ID = '319309021256227';
export const CHAYA_INSTAGRAM_ACCOUNT_ID = '17841466326798701';
export const REELS33_URL =
  'https://chayathemedium.org/shop/same-day-three-questions-next-three-months?promo=REELS33';

const PRIVATE_OPENINGS = Object.freeze([
  'Hello, it’s Chaya. You asked, so here it is:',
  'Hi, it’s Chaya. I saw your comment and wanted to send this your way:',
  'Hello lovely, Chaya here. Since you asked about a reading, I wanted you to have this:',
]);

const PUBLIC_ACKNOWLEDGEMENTS = Object.freeze([
  'I’ve sent you a private message, lovely 💜',
  'I’ve popped the details into a private message for you 💜',
  'Check your private messages, lovely. I’ve sent it over 💜',
]);

const PRIVATE_BODY =
  `Three questions answered today, in writing, with where your next three months are heading, CA$39 for new clients. ${REELS33_URL} (code applies itself). If you’d like the occasional offer from me here, reply YES.`;

const SALES_KEYWORD = /\b(?:read|ready|yes|me)\b/iu;
const READING_QUESTION =
  /(?:\b(?:can|could|would|will|do|does|how|when|where|what|may|please)\b.{0,100}\b(?:read|reading)\b|\b(?:read|reading)\b.{0,100}\?)/iu;
const YES_REPLY = /^\s*yes(?:\s|[.!?❤💜💕💖✨🙏🥰🫶])*$/iu;

function stableIndex(value, size) {
  let hash = 0;
  for (const character of String(value || '')) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }
  return size ? hash % size : 0;
}

function normalize(text) {
  return String(text || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function isChayaSalesAccount(account) {
  if (account?.persona !== 'chaya') return false;
  return (
    (account.platform === 'facebook' && account.metaAccountId === CHAYA_FACEBOOK_PAGE_ID) ||
    (account.platform === 'instagram' && account.metaAccountId === CHAYA_INSTAGRAM_ACCOUNT_ID)
  );
}

export function isChayaSalesTrigger(text) {
  const normalized = normalize(text);
  return Boolean(normalized && (SALES_KEYWORD.test(normalized) || READING_QUESTION.test(normalized)));
}

export function buildChayaPrivateSalesReply(commentId) {
  const openingVariant = stableIndex(commentId, PRIVATE_OPENINGS.length);
  return {
    openingVariant: openingVariant + 1,
    message: `${PRIVATE_OPENINGS[openingVariant]} ${PRIVATE_BODY}`,
  };
}

export function buildChayaSalesPublicReply(commentId) {
  return PUBLIC_ACKNOWLEDGEMENTS[stableIndex(commentId, PUBLIC_ACKNOWLEDGEMENTS.length)];
}

export function buildMetaPrivateReplyRequest({ platform, commentId, message }) {
  if (platform === 'facebook') {
    return {
      path: `${encodeURIComponent(commentId)}/private_replies`,
      form: { message },
    };
  }
  if (platform === 'instagram') {
    return {
      path: `${CHAYA_FACEBOOK_PAGE_ID}/messages`,
      json: {
        recipient: { comment_id: commentId },
        message: { text: message },
      },
    };
  }
  throw new Error(`Unsupported private-reply platform: ${platform}`);
}

export function isYesOptIn(text) {
  return YES_REPLY.test(normalize(text));
}

export function isWithinStandardMessagingWindow(timestamp, now = Date.now()) {
  const eventTime = Number(timestamp);
  return (
    Number.isFinite(eventTime) &&
    eventTime <= now + 5 * 60 * 1000 &&
    now - eventTime <= 24 * 60 * 60 * 1000
  );
}

export class PrivateReplyRateLimiter {
  constructor({ perMinute = 10, perDay = 200, now = () => Date.now() } = {}) {
    this.perMinute = perMinute;
    this.perDay = perDay;
    this.now = now;
    this.events = new Map();
  }

  take(key) {
    const now = this.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const minuteAgo = now - 60 * 1000;
    const recent = (this.events.get(key) || []).filter((timestamp) => timestamp > dayAgo);
    const minuteCount = recent.filter((timestamp) => timestamp > minuteAgo).length;
    if (minuteCount >= this.perMinute) return { allowed: false, reason: 'per_minute' };
    if (recent.length >= this.perDay) return { allowed: false, reason: 'per_day' };
    recent.push(now);
    this.events.set(key, recent);
    return { allowed: true, reason: null };
  }
}

export const CHAYA_YES_THANK_YOU = 'Thank you, lovely. I’ll keep you posted here 💜';
