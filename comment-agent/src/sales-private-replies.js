export const CHAYA_FACEBOOK_PAGE_ID = '319309021256227';
export const CHAYA_INSTAGRAM_ACCOUNT_ID = '17841466326798701';
export const REELS33_URL =
  'https://chayathemedium.org/shop/same-day-three-questions-next-three-months?promo=REELS33';

const SALES_ACCOUNT_ROUTES = Object.freeze({
  cmt0ql9300001msb2pvozfwe9: Object.freeze({ persona: 'chaya', platform: 'instagram' }),
  cmt1vavvs0007myc1cbsep0dd: Object.freeze({ persona: 'chaya', platform: 'facebook' }),
  cmt0qnn4j0005msb2y947wjgo: Object.freeze({ persona: 'ren', platform: 'instagram' }),
  cmt3axou80001l6padw48ggsi: Object.freeze({ persona: 'ren', platform: 'facebook' }),
  cmt0qpsu7000bmsb2oga61nh4: Object.freeze({ persona: 'nadja', platform: 'instagram' }),
  cmt3axpg50003l6pa5i2lf62b: Object.freeze({ persona: 'nadja', platform: 'facebook' }),
  cmt0rnpaa0003n4bf1mkdhe9s: Object.freeze({ persona: 'david', platform: 'facebook' }),
});

export const SALES_INTEGRATION_IDS = Object.freeze(Object.keys(SALES_ACCOUNT_ROUTES));

const SALES_REPLIES = Object.freeze({
  chaya: Object.freeze({
    openings: Object.freeze([
      'Hello, it’s Chaya. You asked, so here it is:',
      'Hi, it’s Chaya. I saw your comment and wanted to send this your way:',
      'Hello lovely, Chaya here. Since you asked about a reading, I wanted you to have this:',
    ]),
    body:
      `Three questions answered today, in writing, with where your next three months are heading, CA$39 for new clients. ${REELS33_URL} (code applies itself). If you’d like the occasional offer from me here, reply YES.`,
    publicAcknowledgements: Object.freeze([
      'I’ve sent you a private message, lovely 💜',
      'I’ve popped the details into a private message for you 💜',
      'Check your private messages, lovely. I’ve sent it over 💜',
    ]),
    yesThankYou: 'Thank you, lovely. I’ll keep you posted here 💜',
  }),
  ren: Object.freeze({
    openings: Object.freeze([
      'Hello, it’s Ren. I saw your comment and wanted to send this personally:',
      'Hi, Ren here. Since you asked about a reading, here are my current options:',
      'Hello, it’s Ren. Your comment reached me, so I wanted you to have this:',
    ]),
    body:
      'My private written readings cover love, career and your soul path. You can see the current options here: https://renlevyreadings.com/readings. Tell me what you’d like guidance on and I’ll point you to the right one. If you’d like the occasional offer from me here, reply YES.',
    publicAcknowledgements: Object.freeze([
      'I’ve sent the reading details to you privately.',
      'Check your private messages. I’ve sent the options over.',
      'I’ve sent you a private message with the details.',
    ]),
    yesThankYou: 'Thank you. I’ll keep you posted here.',
  }),
  nadja: Object.freeze({
    openings: Object.freeze([
      'Hello lovely, it’s Nadja. I saw your comment and wanted to send this to you:',
      'Hi lovely, Nadja here. Since you asked, here are my current options:',
      'Hello, it’s Nadja. Your comment reached me, so I wanted you to have this:',
    ]),
    body:
      'My current work includes tarot readings, question readings, medium sessions and spell casting. You can see the options here: https://nadjaromawitch.store/. Tell me what you need help with and I’ll point you to the right place. If you’d like the occasional offer from me here, reply YES.',
    publicAcknowledgements: Object.freeze([
      'I’ve sent you a private message, lovely.',
      'Check your private messages, lovely. I’ve sent the details over.',
      'I’ve sent the options to you privately, lovely.',
    ]),
    yesThankYou: 'Thank you, lovely. I’ll keep you posted here.',
  }),
  david: Object.freeze({
    openings: Object.freeze([
      'Hello, it’s David. I saw your comment and wanted to send this to you:',
      'Hi, David here. Since you asked about a reading, here are my current options:',
      'Hello, it’s David. Your comment reached me, so I wanted you to have this:',
    ]),
    body:
      'My private written services include psychic guidance, mediumship, astrology, numerology and spell work. You can see the current options here: https://davidthemystic.ca/. Tell me what you’d like help with and I’ll point you to the right one. If you’d like the occasional offer from me here, reply YES.',
    publicAcknowledgements: Object.freeze([
      'I’ve sent the details to you privately.',
      'Check your private messages. I’ve sent the reading options over.',
      'I’ve sent you a private message with the details.',
    ]),
    yesThankYou: 'Thank you. I’ll keep you posted here.',
  }),
});

const RETURNING_CLIENT_BODIES = Object.freeze({
  chaya:
    'Since you asked about another reading, tell me what you want guidance on and I’ll point you to the right option. You can also see the current returning-client readings here: https://chayathemedium.org/returning-clients.',
  ren:
    'Since you asked about another reading, tell me what you want guidance on and I’ll point you to the right option. You can also see my current readings here: https://renlevyreadings.com/readings.',
  nadja:
    'Since you asked about another reading or working, tell me what you need help with and I’ll point you to the right option. You can also see my current work here: https://nadjaromawitch.store/.',
  david:
    'Since you asked about another service, tell me what you need help with and I’ll point you to the right option. You can also see my current work here: https://davidthemystic.ca/.',
});

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

function salesReplyConfig(persona) {
  const config = SALES_REPLIES[persona];
  if (!config) throw new Error(`Unsupported sales persona: ${persona}`);
  return config;
}

export function isSalesAccount(account) {
  const route = account ? SALES_ACCOUNT_ROUTES[account.integrationId] : null;
  return Boolean(
    route &&
    route.persona === account.persona &&
    route.platform === account.platform
  );
}

export function isSalesTrigger(text) {
  const normalized = normalize(text);
  return Boolean(normalized && (SALES_KEYWORD.test(normalized) || READING_QUESTION.test(normalized)));
}

export function isDirectSalesInterest(text) {
  const normalized = normalize(text);
  return Boolean(
    /^(?:read|ready|yes|me)(?:\s|[.!?❤💜💕💖✨🙏🥰🫶])*$/iu.test(normalized) ||
    READING_QUESTION.test(normalized)
  );
}

export function isSalesEligibleRelationship(relationship) {
  return relationship === 'new_follower';
}

export function buildPrivateSalesReply(persona, commentId, { returningClient = false } = {}) {
  const config = salesReplyConfig(persona);
  const openingVariant = stableIndex(commentId, config.openings.length);
  return {
    openingVariant: openingVariant + 1,
    message: `${config.openings[openingVariant]} ${
      returningClient ? RETURNING_CLIENT_BODIES[persona] : config.body
    }`,
  };
}

export function buildSalesPublicReply(persona, commentId) {
  const replies = salesReplyConfig(persona).publicAcknowledgements;
  return replies[stableIndex(commentId, replies.length)];
}

export function buildSalesOptInThankYou(persona) {
  return salesReplyConfig(persona).yesThankYou;
}

export function buildMetaPrivateReplyRequest({
  platform,
  commentId,
  message,
  messagingEndpointId,
}) {
  if (platform === 'facebook') {
    return {
      path: `${encodeURIComponent(commentId)}/private_replies`,
      form: { message },
    };
  }
  if (platform === 'instagram') {
    if (!messagingEndpointId) {
      throw new Error('The Instagram messaging endpoint is not resolved');
    }
    return {
      path: `${encodeURIComponent(messagingEndpointId)}/messages`,
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
