export const CHAYA_CARD_KEYWORDS = Object.freeze([
  'MOON',
  'TOWER',
  'DEATH',
  'DEVIL',
  'SWORDS',
]);

export const CHAYA_CARD_BOT_MARKER = 'Chaya here.';
export const CHAYA_CARD_MISSED_PUBLIC_REPLY =
  'Have a look in your message requests, it is on its way.';

const KEYWORD_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}_])(${CHAYA_CARD_KEYWORDS.join('|')})(?![\\p{L}\\p{N}_])`,
  'iu'
);
const BOT_MARKER_PATTERN = /^Chaya here\.\r?\n\r?\n/u;
const LINK_LOCATION_QUESTION =
  /\b(?:where|which|find|see|lost|missing|can'?t\s+(?:find|see|open)|cannot\s+(?:find|see|open))\b.{0,80}\b(?:link|message|reading)\b|\b(?:link|message)\b.{0,80}\b(?:where|missing|not\s+there|won'?t\s+open)\b/iu;

export function chayaCardKeyword(text) {
  const match = String(text || '').normalize('NFKC').match(KEYWORD_PATTERN);
  return match ? match[1].toUpperCase() : null;
}

export function isChayaCardKeywordComment(event, account) {
  return Boolean(
    event?.kind === 'comment' &&
    account?.persona === 'chaya' &&
    ['facebook', 'instagram'].includes(account.platform) &&
    chayaCardKeyword(event.text)
  );
}

export function isChayaCardBotMessage(text) {
  return BOT_MARKER_PATTERN.test(String(text || ''));
}

export function conversationHasChayaCardBotMessage(messages, brandIds = []) {
  const ids = new Set(brandIds.map(String));
  return (messages || []).some((message) =>
    ids.has(String(message?.from?.id || '')) && isChayaCardBotMessage(message?.message)
  );
}

export function asksWhereChayaCardLink(text) {
  return LINK_LOCATION_QUESTION.test(String(text || '').normalize('NFKC'));
}

export function buildChayaCardReadingFollowUp(text) {
  if (asksWhereChayaCardLink(text)) {
    return 'It’s the chayathemedium.org link in the message above, lovely. If it isn’t opening, you can find the current readings at https://chayathemedium.org 💜';
  }
  return 'That sounds like something to bring into your reading, lovely. Use the link in the message above and send the questions you want Chaya to focus on 💜';
}

export function validateChayaCardFollowUpReply(text, { linkRequested = false } = {}) {
  const reply = String(text || '');
  if (isChayaCardBotMessage(reply)) return null;
  if (!linkRequested && /https?:\/\/|\bchayathemedium\.org\b/iu.test(reply)) return null;
  return reply;
}

export function chayaCardThreadPromptRule(isCardThread) {
  if (!isCardThread) return '';
  return [
    'This conversation started with a card message from Chaya whose first line was exactly Chaya here.',
    'Treat that earlier note as already sent. Never repeat the card note or its link unless the person explicitly asks where the link is.',
    'Answer only the person’s newest message. If they ask a reading question, do not give a free reading. Warmly direct them to use the reading link in the message above.',
    'Never mention the separate marketing process or describe how the first message was sent.',
  ].join(' ');
}
