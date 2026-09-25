import crypto from 'node:crypto';
import http from 'node:http';
import { Pool } from 'pg';
import { BufferApi } from './buffer.js';
import { GitHubClientDirectory } from './client-directory.js';
import { extractMetaEvents } from './meta-events.js';
import {
  ACCOUNT_ROUTES,
  PERSONAS,
  buildReplyPrompt,
  buildSafeTemplateReply,
  chayaReels33Decision,
  classifyComment,
  metaSubscriptionStrategy,
  routeIntegration,
  sanitizeReplyText,
} from './policy.js';
import {
  CHAYA_FACEBOOK_PAGE_ID,
  CHAYA_INSTAGRAM_ACCOUNT_ID,
  CHAYA_YES_THANK_YOU,
  PrivateReplyRateLimiter,
  buildChayaPrivateSalesReply,
  buildChayaSalesPublicReply,
  buildMetaPrivateReplyRequest,
  isChayaSalesAccount,
  isChayaSalesTrigger,
  isWithinStandardMessagingWindow,
  isYesOptIn,
} from './sales-private-replies.js';

const PORT = Number(process.env.PORT || 3000);
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
const DATABASE_URL = process.env.DATABASE_URL;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const ADMIN_TOKEN = process.env.COMMENT_AGENT_ADMIN_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const REPLY_MODE = process.env.REPLY_MODE || 'shadow';
const CHAYA_SALES_PRIVATE_REPLIES_ENABLED =
  process.env.CHAYA_SALES_PRIVATE_REPLIES_ENABLED === 'true';
const PRIVATE_REPLY_PER_MINUTE = Number(process.env.PRIVATE_REPLY_PER_MINUTE || 10);
const PRIVATE_REPLY_PER_DAY = Number(process.env.PRIVATE_REPLY_PER_DAY || 200);
const SALES_REPORT_TIME_ZONE = process.env.SALES_REPORT_TIME_ZONE || 'America/Vancouver';
const BUFFER_API_KEY = process.env.BUFFER_API_KEY || '';
const bufferApi = new BufferApi(BUFFER_API_KEY);
const CLIENT_HANDOVER_REPO = process.env.CLIENT_HANDOVER_REPO ||
  'michaeladane13-dotcom/chaya-client-handover';
const CLIENT_HANDOVER_PATH = process.env.CLIENT_HANDOVER_PATH || 'social-public-profiles.json';
const CLIENT_HANDOVER_REF = process.env.CLIENT_HANDOVER_REF || 'main';
const CLIENT_HANDOVER_GITHUB_TOKEN = process.env.CLIENT_HANDOVER_GITHUB_TOKEN || '';
const CLIENT_HANDOVER_SYNC_MS = 8 * 60 * 60 * 1000;
const clientDirectory = new GitHubClientDirectory({
  repository: CLIENT_HANDOVER_REPO,
  path: CLIENT_HANDOVER_PATH,
  ref: CLIENT_HANDOVER_REF,
  token: CLIENT_HANDOVER_GITHUB_TOKEN,
});
const privateReplyRateLimiter = new PrivateReplyRateLimiter({
  perMinute: PRIVATE_REPLY_PER_MINUTE,
  perDay: PRIVATE_REPLY_PER_DAY,
});

for (const [name, value] of Object.entries({
  DATABASE_URL,
  META_VERIFY_TOKEN,
  FACEBOOK_APP_SECRET,
  ADMIN_TOKEN,
})) {
  if (!value) throw new Error(`${name} is required`);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

let accountsByMetaId = new Map();
let subscriptionSummary = {
  subscribed: 0,
  failed: 0,
  pending: 0,
  appLevelConfigured: 0,
  reasons: {},
};
let tiktokSchedulerSummary = {
  configured: Boolean(BUFFER_API_KEY),
  validated: false,
  connectedChannels: 0,
  error: BUFFER_API_KEY ? null : 'BUFFER_API_KEY is not configured',
};
let databaseSummary = {
  ready: false,
  lastCheckedAt: null,
  lastSuccessfulAt: null,
  error: 'Database initialization is pending',
};

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyMetaSignature(rawBody, signatureHeader, appSecret = FACEBOOK_APP_SECRET) {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(signatureHeader, expected);
}

async function migrate() {
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS comment_agent;
    CREATE TABLE IF NOT EXISTS comment_agent."CommentAgentEvent" (
      "commentId" TEXT PRIMARY KEY,
      "platform" TEXT NOT NULL,
      "integrationId" TEXT NOT NULL,
      "metaAccountId" TEXT NOT NULL,
      "persona" TEXT NOT NULL,
      "username" TEXT,
      "senderId" TEXT,
      "commentText" TEXT NOT NULL,
      "postId" TEXT,
      "action" TEXT NOT NULL,
      "reason" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'received',
      "error" TEXT,
      "rawEvent" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "processedAt" TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS comment_agent."PersonaReplyDraft" (
      "id" UUID PRIMARY KEY,
      "commentId" TEXT NOT NULL UNIQUE REFERENCES comment_agent."CommentAgentEvent"("commentId") ON DELETE CASCADE,
      "integrationId" TEXT NOT NULL,
      "persona" TEXT NOT NULL,
      "draft" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "model" TEXT,
      "error" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS comment_agent."PersonaContactProfile" (
      "integrationId" TEXT NOT NULL,
      "metaUserId" TEXT NOT NULL,
      "persona" TEXT NOT NULL,
      "username" TEXT,
      "relationship" TEXT NOT NULL DEFAULT 'new_follower',
      "notes" TEXT,
      "confirmed" BOOLEAN NOT NULL DEFAULT FALSE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("integrationId", "metaUserId")
    );
    CREATE TABLE IF NOT EXISTS comment_agent."MetaAccountSubscription" (
      "integrationId" TEXT PRIMARY KEY,
      "metaAccountId" TEXT NOT NULL,
      platform TEXT NOT NULL,
      persona TEXT NOT NULL,
      fields TEXT[] NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS comment_agent."PrivateReplyLog" (
      "commentId" TEXT PRIMARY KEY REFERENCES comment_agent."CommentAgentEvent"("commentId") ON DELETE CASCADE,
      platform TEXT NOT NULL,
      "integrationId" TEXT NOT NULL,
      "metaAccountId" TEXT NOT NULL,
      "postId" TEXT,
      "commentSenderId" TEXT,
      "metaRecipientId" TEXT,
      "openingVariant" INTEGER NOT NULL,
      "messageText" TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'reserved',
      "metaMessageId" TEXT,
      error TEXT,
      "attemptedAt" TIMESTAMPTZ,
      "sentAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS comment_agent."MessagingInboundEvent" (
      "messageId" TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      "integrationId" TEXT NOT NULL,
      "metaAccountId" TEXT NOT NULL,
      "senderId" TEXT NOT NULL,
      "recipientId" TEXT,
      "messageText" TEXT,
      "eventTimestamp" TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      error TEXT,
      "rawEvent" JSONB,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "processedAt" TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS comment_agent."MessagingOptIn" (
      platform TEXT NOT NULL,
      "integrationId" TEXT NOT NULL,
      "metaAccountId" TEXT NOT NULL,
      "recipientId" TEXT NOT NULL,
      "sourceCommentId" TEXT REFERENCES comment_agent."CommentAgentEvent"("commentId") ON DELETE SET NULL,
      "sourceMessageId" TEXT,
      "localOptInAt" TIMESTAMPTZ,
      "lastInboundAt" TIMESTAMPTZ,
      "thankYouSentAt" TIMESTAMPTZ,
      "metaMarketingToken" TEXT,
      "metaMarketingOptInAt" TIMESTAMPTZ,
      "marketingStatus" TEXT NOT NULL DEFAULT 'local_yes_only',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("integrationId", "recipientId")
    );
    ALTER TABLE comment_agent."CommentAgentEvent" ADD COLUMN IF NOT EXISTS "senderId" TEXT;
    CREATE INDEX IF NOT EXISTS "CommentAgentEvent_createdAt_idx"
      ON comment_agent."CommentAgentEvent" ("createdAt" DESC);
    CREATE INDEX IF NOT EXISTS "CommentAgentEvent_sender_idx"
      ON comment_agent."CommentAgentEvent" ("integrationId", "senderId", "createdAt" DESC);
    CREATE INDEX IF NOT EXISTS "PrivateReplyLog_sentAt_idx"
      ON comment_agent."PrivateReplyLog" ("sentAt" DESC);
    CREATE INDEX IF NOT EXISTS "PrivateReplyLog_recipient_idx"
      ON comment_agent."PrivateReplyLog" ("integrationId", "metaRecipientId", "sentAt" DESC);
    CREATE INDEX IF NOT EXISTS "MessagingOptIn_localOptInAt_idx"
      ON comment_agent."MessagingOptIn" ("localOptInAt" DESC);
  `);
}

async function loadAccounts() {
  const integrationIds = Object.keys(ACCOUNT_ROUTES);
  const { rows } = await pool.query(
    `SELECT id, "internalId", "providerIdentifier", token, name
       FROM "Integration"
      WHERE id = ANY($1::text[]) AND disabled = false`,
    [integrationIds]
  );

  const loaded = new Map();
  for (const row of rows) {
    const route = routeIntegration(row.id);
    if (!route) continue;
    if (route.platform !== row.providerIdentifier) {
      throw new Error(`Account route mismatch for integration ${row.id}`);
    }
    const existing = loaded.get(String(row.internalId));
    if (existing && existing.integrationId !== row.id) {
      throw new Error(`Duplicate Meta account routing for ${row.internalId}`);
    }
    loaded.set(String(row.internalId), {
      integrationId: row.id,
      metaAccountId: String(row.internalId),
      platform: route.platform,
      persona: route.persona,
      name: row.name,
      accessToken: String(row.token).split('___')[0],
    });
  }

  const missing = integrationIds.filter((id) => !rows.some((row) => row.id === id));
  if (missing.length) throw new Error(`Missing approved integrations: ${missing.join(', ')}`);
  accountsByMetaId = loaded;
}

async function refreshMetaAccountState() {
  try {
    await migrate();
    await loadAccounts();
    await syncSubscriptions();
    const completedAt = new Date().toISOString();
    databaseSummary = {
      ready: true,
      lastCheckedAt: completedAt,
      lastSuccessfulAt: completedAt,
      error: null,
    };
  } catch (error) {
    databaseSummary = {
      ...databaseSummary,
      ready: false,
      lastCheckedAt: new Date().toISOString(),
      error: String(error.message).slice(0, 1000),
    };
    throw error;
  }
}

function extractEvents(payload) {
  return extractMetaEvents(payload);
}

async function graphRequest(path, accessToken, options = {}, host = 'graph.facebook.com') {
  const url = new URL(`https://${host}/${GRAPH_VERSION}/${path}`);
  url.searchParams.set('access_token', accessToken);
  const response = await fetch(url, options);
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = bodyText;
  }
  if (!response.ok || body?.error) {
    const error = new Error(body?.error?.message || `Meta returned HTTP ${response.status}`);
    error.code = body?.error?.code;
    error.status = response.status;
    error.retryAfter = Number(response.headers.get('retry-after') || 0);
    throw error;
  }
  return body;
}

async function syncSubscriptions() {
  const summary = {
    subscribed: 0,
    failed: 0,
    pending: accountsByMetaId.size,
    appLevelConfigured: 0,
    reasons: {},
  };
  for (const account of accountsByMetaId.values()) {
    const strategy = metaSubscriptionStrategy(account.platform, account.metaAccountId, {
      includeMessaging:
        CHAYA_SALES_PRIVATE_REPLIES_ENABLED && isChayaSalesAccount(account),
    });
    const fields = strategy.fields;
    let status = strategy.mode === 'app_level' ? 'configured_app_webhook' : 'subscribed';
    let error = null;
    try {
      // Instagram with Facebook Login is configured once on the app's
      // Instagram webhook object. Per-account /subscribed_apps is the
      // Instagram Login flow and returns Meta error 3 for Page tokens.
      if (strategy.mode === 'app_level') {
        summary.appLevelConfigured += 1;
      } else {
        await graphRequest(
          `${strategy.target}/subscribed_apps?subscribed_fields=${encodeURIComponent(fields.join(','))}`,
          account.accessToken,
          { method: 'POST' },
          strategy.host
        );
      }
      summary.subscribed += 1;
    } catch (subscriptionError) {
      status = 'failed';
      error = String(subscriptionError.message).slice(0, 1000);
      summary.failed += 1;
      const category = /pages_manage_metadata/i.test(error)
        ? 'missing_pages_manage_metadata'
        : /permission/i.test(error)
          ? `permission_error_${subscriptionError.code || 'unknown'}`
          : /unsupported|does not exist|cannot be loaded/i.test(error)
            ? `unsupported_endpoint_${subscriptionError.code || 'unknown'}`
            : `meta_error_${subscriptionError.code || 'unknown'}`;
      const reasonKey = `${account.platform}:${category}`;
      summary.reasons[reasonKey] = (summary.reasons[reasonKey] || 0) + 1;
    }
    summary.pending -= 1;
    await pool.query(
      `INSERT INTO comment_agent."MetaAccountSubscription"
        ("integrationId", "metaAccountId", platform, persona, fields, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT ("integrationId") DO UPDATE
         SET "metaAccountId"=EXCLUDED."metaAccountId", platform=EXCLUDED.platform,
             persona=EXCLUDED.persona, fields=EXCLUDED.fields, status=EXCLUDED.status,
             error=EXCLUDED.error, "updatedAt"=NOW()`,
      [
        account.integrationId,
        account.metaAccountId,
        account.platform,
        account.persona,
        fields,
        status,
        error,
      ]
    );
  }
  subscriptionSummary = summary;
  console.log(`subscription_sync subscribed=${summary.subscribed} failed=${summary.failed}`);
}

async function syncTikTokScheduler() {
  if (!BUFFER_API_KEY) return;
  try {
    const channels = await bufferApi.connectedTikTokChannels();
    tiktokSchedulerSummary = {
      configured: true,
      validated: channels.length === 3,
      connectedChannels: channels.length,
      error: channels.length === 3 ? null : `Expected 3 approved TikTok channels, found ${channels.length}`,
    };
  } catch (error) {
    tiktokSchedulerSummary = {
      configured: true,
      validated: false,
      connectedChannels: 0,
      error: String(error.message).slice(0, 500),
    };
  }
}

async function deleteOrHide(event, account) {
  try {
    await graphRequest(encodeURIComponent(event.commentId), account.accessToken, { method: 'DELETE' });
    return { status: 'deleted', error: null };
  } catch (deleteError) {
    try {
      await graphRequest(encodeURIComponent(event.commentId), account.accessToken, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_hidden: true }),
      });
      return {
        status: 'hidden_pending_delete_permission',
        error: `Delete failed: ${deleteError.message}`.slice(0, 1000),
      };
    } catch (hideError) {
      return {
        status: 'moderation_failed',
        error: `Delete failed: ${deleteError.message}; hide failed: ${hideError.message}`.slice(0, 1000),
      };
    }
  }
}

async function fetchPostContext(event, account) {
  if (!event.postId) return '';
  const fields = account.platform === 'instagram' ? 'caption' : 'message';
  try {
    const post = await graphRequest(
      `${encodeURIComponent(event.postId)}?fields=${encodeURIComponent(fields)}`,
      account.accessToken
    );
    return String(post?.caption || post?.message || '');
  } catch {
    return '';
  }
}

async function generateDraft(input) {
  if (!OPENAI_API_KEY) return { draft: null, model: null, error: 'OPENAI_API_KEY is not configured' };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: buildReplyPrompt(input),
      max_output_tokens: 120,
      store: false,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message || `OpenAI returned HTTP ${response.status}`);
  const draft = (body.output || [])
    .flatMap((item) => item?.content || [])
    .filter((part) => part?.type === 'output_text')
    .map((part) => part.text || '')
    .join('')
    .trim();
  if (!draft) throw new Error('OpenAI returned an empty draft');
  return { draft: sanitizeReplyText(draft).slice(0, 1000), model: OPENAI_MODEL, error: null };
}

async function publishReply(event, account, message) {
  const path = account.platform === 'instagram'
    ? `${encodeURIComponent(event.commentId)}/replies`
    : `${encodeURIComponent(event.commentId)}/comments`;
  const body = new URLSearchParams({ message: sanitizeReplyText(message) });
  return graphRequest(path, account.accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

async function publishPrivateSalesReply(event, account, message) {
  const request = buildMetaPrivateReplyRequest({
    platform: account.platform,
    commentId: event.commentId,
    message: sanitizeReplyText(message),
  });
  if (request.form) {
    return graphRequest(request.path, account.accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(request.form),
    });
  }
  return graphRequest(request.path, account.accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request.json),
  });
}

async function sendStandardMessage(event, account, message) {
  if (!isWithinStandardMessagingWindow(event.timestamp)) {
    throw new Error('The standard Meta messaging window is closed');
  }
  const pageId = account.platform === 'instagram' ? CHAYA_FACEBOOK_PAGE_ID : account.metaAccountId;
  return graphRequest(`${encodeURIComponent(pageId)}/messages`, account.accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: event.senderId },
      messaging_type: 'RESPONSE',
      message: { text: sanitizeReplyText(message) },
    }),
  });
}

async function sendChayaSalesPrivateReply(event, account) {
  const reply = buildChayaPrivateSalesReply(event.commentId);
  const reservation = await pool.query(
    `INSERT INTO comment_agent."PrivateReplyLog"
      ("commentId", platform, "integrationId", "metaAccountId", "postId", "commentSenderId",
       "openingVariant", "messageText")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT ("commentId") DO NOTHING
     RETURNING "commentId"`,
    [
      event.commentId,
      event.platform,
      account.integrationId,
      account.metaAccountId,
      event.postId || null,
      event.senderId || null,
      reply.openingVariant,
      reply.message,
    ]
  );
  if (reservation.rowCount !== 1) return { status: 'duplicate', error: null };

  const rate = privateReplyRateLimiter.take(account.integrationId);
  if (!rate.allowed) {
    await pool.query(
      `UPDATE comment_agent."PrivateReplyLog"
          SET status='rate_limited_local', error=$2, "updatedAt"=NOW()
        WHERE "commentId"=$1`,
      [event.commentId, `Conservative ${rate.reason} private-reply limit reached`]
    );
    return { status: 'rate_limited_local', error: rate.reason };
  }

  await pool.query(
    `UPDATE comment_agent."PrivateReplyLog"
        SET status='attempting', "attemptedAt"=NOW(), "updatedAt"=NOW()
      WHERE "commentId"=$1`,
    [event.commentId]
  );
  try {
    const result = await publishPrivateSalesReply(event, account, reply.message);
    await pool.query(
      `UPDATE comment_agent."PrivateReplyLog"
          SET status='sent', "metaRecipientId"=$2, "metaMessageId"=$3,
              error=NULL, "sentAt"=NOW(), "updatedAt"=NOW()
        WHERE "commentId"=$1`,
      [
        event.commentId,
        String(result?.recipient_id || event.senderId || '') || null,
        String(result?.message_id || result?.id || '') || null,
      ]
    );
    return { status: 'sent', error: null };
  } catch (error) {
    const message = String(error.message).slice(0, 1000);
    const status = error.status === 429 || error.code === 4 || error.code === 17 || error.code === 32
      ? 'rate_limited_meta'
      : 'failed';
    await pool.query(
      `UPDATE comment_agent."PrivateReplyLog"
          SET status=$2, error=$3, "updatedAt"=NOW()
        WHERE "commentId"=$1`,
      [event.commentId, status, message]
    );
    return { status, error: message };
  }
}

async function processChayaSalesComment(event, account) {
  const publicReply = buildChayaSalesPublicReply(event.commentId);
  let publicSent = false;
  let publicError = null;
  if (REPLY_MODE === 'limited_live') {
    try {
      await publishReply(event, account, publicReply);
      publicSent = true;
      await saveDraft({
        event,
        account,
        draft: publicReply,
        status: 'published_sales_public',
        model: 'curated-sales-public-v1',
      });
    } catch (error) {
      publicError = String(error.message).slice(0, 1000);
      await saveDraft({
        event,
        account,
        draft: publicReply,
        status: 'sales_public_failed',
        model: 'curated-sales-public-v1',
        error: publicError,
      });
    }
  } else {
    await saveDraft({
      event,
      account,
      draft: publicReply,
      status: 'pending_sales_public',
      model: 'curated-sales-public-v1',
    });
    await updateEvent(event.commentId, 'drafted_sales_public_private_disabled');
    return;
  }

  const privateResult = await sendChayaSalesPrivateReply(event, account);
  if (publicSent && privateResult.status === 'sent') {
    await updateEvent(event.commentId, 'replied_sales_public_and_private');
  } else if (publicSent) {
    await updateEvent(
      event.commentId,
      'replied_sales_public_private_failed',
      privateResult.error || privateResult.status
    );
  } else if (privateResult.status === 'sent') {
    await updateEvent(event.commentId, 'sales_private_sent_public_failed', publicError);
  } else {
    await updateEvent(
      event.commentId,
      'sales_public_and_private_failed',
      [publicError, privateResult.error || privateResult.status].filter(Boolean).join('; ').slice(0, 1000)
    );
  }
}

async function saveDraft({ event, account, draft, status, model, error = null }) {
  await pool.query(
    `INSERT INTO comment_agent."PersonaReplyDraft"
      (id, "commentId", "integrationId", persona, draft, status, model, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      crypto.randomUUID(),
      event.commentId,
      account.integrationId,
      account.persona,
      draft,
      status,
      model,
      error,
    ]
  );
}

async function saveEvent(event, account, decision) {
  const result = await pool.query(
    `INSERT INTO comment_agent."CommentAgentEvent"
      ("commentId", platform, "integrationId", "metaAccountId", persona, username, "senderId",
       "commentText", "postId", action, reason, status, "rawEvent")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'received',$12)
     ON CONFLICT ("commentId") DO NOTHING
     RETURNING "commentId"`,
    [
      event.commentId,
      event.platform,
      account.integrationId,
      event.metaAccountId,
      account.persona,
      event.username || null,
      event.senderId || null,
      event.text,
      event.postId || null,
      decision.action,
      decision.reason,
      event.raw,
    ]
  );
  return result.rowCount === 1;
}

async function loadRelationship(event, account) {
  const directoryProfile = clientDirectory.match(event.username);
  if (!event.senderId) {
    return {
      relationship: directoryProfile?.relationship || 'new_follower',
      engagement: directoryProfile?.engagement || 'reply',
      notes: '',
      recentHistory: [],
    };
  }

  await pool.query(
    `INSERT INTO comment_agent."PersonaContactProfile"
      ("integrationId", "metaUserId", persona, username)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT ("integrationId", "metaUserId") DO UPDATE
       SET username=EXCLUDED.username, "updatedAt"=NOW()`,
    [account.integrationId, event.senderId, account.persona, event.username || null]
  );

  const profileResult = await pool.query(
    `SELECT relationship, notes, confirmed
       FROM comment_agent."PersonaContactProfile"
      WHERE "integrationId"=$1 AND "metaUserId"=$2`,
    [account.integrationId, event.senderId]
  );
  const profile = profileResult.rows[0];

  const historyResult = await pool.query(
    `SELECT "commentText", status, "createdAt"
       FROM comment_agent."CommentAgentEvent"
      WHERE "integrationId"=$1 AND "senderId"=$2 AND "commentId"<>$3
      ORDER BY "createdAt" DESC LIMIT 6`,
    [account.integrationId, event.senderId, event.commentId]
  );
  const positiveHistoryCount = historyResult.rows.filter((row) =>
    buildSafeTemplateReply({
      persona: account.persona,
      comment: row.commentText,
      relationship: 'new_follower',
    })
  ).length;

  return {
    relationship: profile?.confirmed
      ? profile.relationship
      : directoryProfile?.relationship
        ? directoryProfile.relationship
        : positiveHistoryCount >= 3
          ? 'regular'
          : 'new_follower',
    engagement: directoryProfile?.engagement || 'reply',
    notes: profile?.confirmed ? profile.notes || '' : '',
    recentHistory: historyResult.rows.reverse().map((row) => ({
      comment: row.commentText,
      outcome: row.status,
    })),
  };
}

async function updateEvent(commentId, status, error = null) {
  await pool.query(
    `UPDATE comment_agent."CommentAgentEvent"
        SET status=$2, error=$3, "processedAt"=NOW()
      WHERE "commentId"=$1`,
    [commentId, status, error]
  );
}

async function saveInboundMessage(event, account) {
  const eventTime = new Date(Number(event.timestamp));
  const result = await pool.query(
    `INSERT INTO comment_agent."MessagingInboundEvent"
      ("messageId", platform, "integrationId", "metaAccountId", "senderId", "recipientId",
       "messageText", "eventTimestamp", "rawEvent")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT ("messageId") DO NOTHING
     RETURNING "messageId"`,
    [
      event.messageId,
      event.platform,
      account.integrationId,
      account.metaAccountId,
      event.senderId,
      event.recipientId || null,
      event.text || null,
      eventTime,
      event.raw,
    ]
  );
  return result.rowCount === 1;
}

async function updateInboundMessage(messageId, status, error = null) {
  await pool.query(
    `UPDATE comment_agent."MessagingInboundEvent"
        SET status=$2, error=$3, "processedAt"=NOW()
      WHERE "messageId"=$1`,
    [messageId, status, error]
  );
}

async function processInboundMessage(event) {
  const account = accountsByMetaId.get(event.metaAccountId);
  if (!account || !isChayaSalesAccount(account)) return;
  if (!(await saveInboundMessage(event, account))) return;
  if (!isYesOptIn(event.text)) {
    await updateInboundMessage(event.messageId, 'ignored_not_yes');
    return;
  }

  const sourceResult = await pool.query(
    `SELECT "commentId"
       FROM comment_agent."PrivateReplyLog"
      WHERE "integrationId"=$1 AND status='sent'
        AND ("metaRecipientId"=$2 OR "commentSenderId"=$2)
      ORDER BY "sentAt" DESC LIMIT 1`,
    [account.integrationId, event.senderId]
  );
  const sourceCommentId = sourceResult.rows[0]?.commentId || null;
  if (!sourceCommentId) {
    await updateInboundMessage(event.messageId, 'ignored_unlinked_yes');
    return;
  }

  const eventTime = new Date(Number(event.timestamp));
  await pool.query(
    `INSERT INTO comment_agent."MessagingOptIn"
      (platform, "integrationId", "metaAccountId", "recipientId", "sourceCommentId",
       "sourceMessageId", "localOptInAt", "lastInboundAt", "marketingStatus")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$7,'local_yes_only')
     ON CONFLICT ("integrationId", "recipientId") DO UPDATE
       SET "sourceCommentId"=EXCLUDED."sourceCommentId",
           "sourceMessageId"=EXCLUDED."sourceMessageId",
           "localOptInAt"=EXCLUDED."localOptInAt",
           "lastInboundAt"=EXCLUDED."lastInboundAt",
           "updatedAt"=NOW()`,
    [
      event.platform,
      account.integrationId,
      account.metaAccountId,
      event.senderId,
      sourceCommentId,
      event.messageId,
      eventTime,
    ]
  );

  if (!isWithinStandardMessagingWindow(event.timestamp)) {
    await updateInboundMessage(event.messageId, 'optin_recorded_window_closed');
    return;
  }

  try {
    await sendStandardMessage(event, account, CHAYA_YES_THANK_YOU);
    await pool.query(
      `UPDATE comment_agent."MessagingOptIn"
          SET "thankYouSentAt"=NOW(), "updatedAt"=NOW()
        WHERE "integrationId"=$1 AND "recipientId"=$2`,
      [account.integrationId, event.senderId]
    );
    await updateInboundMessage(event.messageId, 'optin_recorded_thanked');
  } catch (error) {
    await updateInboundMessage(
      event.messageId,
      'optin_recorded_thank_failed',
      String(error.message).slice(0, 1000)
    );
  }
}

async function processMarketingOptIn(event) {
  const account = accountsByMetaId.get(event.metaAccountId);
  if (!account || !isChayaSalesAccount(account) || !event.marketingToken) return;
  const eventTime = new Date(Number(event.timestamp));
  await pool.query(
    `INSERT INTO comment_agent."MessagingOptIn"
      (platform, "integrationId", "metaAccountId", "recipientId", "lastInboundAt",
       "metaMarketingToken", "metaMarketingOptInAt", "marketingStatus")
     VALUES ($1,$2,$3,$4,$5,$6,$5,'meta_token_active')
     ON CONFLICT ("integrationId", "recipientId") DO UPDATE
       SET "lastInboundAt"=EXCLUDED."lastInboundAt",
           "metaMarketingToken"=EXCLUDED."metaMarketingToken",
           "metaMarketingOptInAt"=EXCLUDED."metaMarketingOptInAt",
           "marketingStatus"='meta_token_active', "updatedAt"=NOW()`,
    [
      event.platform,
      account.integrationId,
      account.metaAccountId,
      event.senderId,
      eventTime,
      event.marketingToken,
    ]
  );
}

async function dailySalesReport(date, timeZone = SALES_REPORT_TIME_ZONE) {
  const { rows } = await pool.query(
    `WITH bounds AS (
       SELECT ($1::date::timestamp AT TIME ZONE $2) AS start_at,
              (($1::date + 1)::timestamp AT TIME ZONE $2) AS end_at
     )
     SELECT
       (SELECT COUNT(*)::int
          FROM comment_agent."CommentAgentEvent", bounds
         WHERE persona='chaya' AND status LIKE 'replied_%'
           AND "processedAt">=start_at AND "processedAt"<end_at) AS "commentsAnswered",
       (SELECT COUNT(*)::int
          FROM comment_agent."PrivateReplyLog", bounds
         WHERE status='sent' AND "sentAt">=start_at AND "sentAt"<end_at) AS "privateRepliesSent",
       (SELECT COUNT(*)::int
          FROM comment_agent."MessagingOptIn", bounds
         WHERE "localOptInAt">=start_at AND "localOptInAt"<end_at) AS "yesOptIns",
       (SELECT COUNT(*)::int
          FROM comment_agent."MessagingOptIn"
         WHERE "marketingStatus"='meta_token_active' AND "metaMarketingToken" IS NOT NULL)
         AS "metaMarketingTokensActive"`,
    [date, timeZone]
  );
  return {
    date,
    timeZone,
    ...rows[0],
    clicks: {
      measurable: false,
      count: null,
      reason: 'The approved direct destination URL does not send click events to this service.',
    },
    messagingCompliance: {
      localYesRecorded: true,
      metaMarketingTokenRequiredOutside24Hours: true,
      outside24HourSendsEnabled: false,
    },
  };
}

async function processEvent(event) {
  if (event.kind === 'message') return processInboundMessage(event);
  if (event.kind === 'marketing_optin') return processMarketingOptIn(event);
  const account = accountsByMetaId.get(event.metaAccountId);
  if (!account || account.platform !== event.platform) return;
  if (event.senderId && event.senderId === event.metaAccountId) return;

  const decision = classifyComment(event.text);
  if (!(await saveEvent(event, account, decision))) return;

  if (decision.action === 'delete') {
    const result = await deleteOrHide(event, account);
    await updateEvent(event.commentId, result.status, result.error);
    return;
  }

  if (decision.action === 'draft_reply') {
    try {
      const postText = await fetchPostContext(event, account);
      const relationship = await loadRelationship(event, account);
      if (relationship.engagement === 'do_not_engage') {
        await updateEvent(event.commentId, 'ignored_client_rule');
        return;
      }
      if (relationship.engagement === 'manual_review') {
        await updateEvent(event.commentId, 'needs_review_client_rule');
        return;
      }
      if (
        CHAYA_SALES_PRIVATE_REPLIES_ENABLED &&
        isChayaSalesAccount(account) &&
        isChayaSalesTrigger(event.text)
      ) {
        await processChayaSalesComment(event, account);
        return;
      }
      const promotion = chayaReels33Decision({
        persona: account.persona,
        postText,
        comment: event.text,
      });
      if (promotion?.action === 'review') {
        await updateEvent(event.commentId, `needs_review_${promotion.reason}`);
        return;
      }
      if (promotion?.action === 'reply') {
        if (REPLY_MODE === 'limited_live') {
          try {
            await publishReply(event, account, promotion.text);
            await saveDraft({
              event, account, draft: promotion.text,
              status: 'published_promo', model: 'curated-reels33-v1',
            });
            await updateEvent(event.commentId, `replied_${promotion.reason}`);
          } catch (error) {
            const message = String(error.message).slice(0, 1000);
            await saveDraft({
              event, account, draft: promotion.text,
              status: 'publish_failed', model: 'curated-reels33-v1', error: message,
            });
            await updateEvent(event.commentId, 'reply_failed', message);
          }
        } else {
          await saveDraft({
            event, account, draft: promotion.text,
            status: 'pending_promo', model: 'curated-reels33-v1',
          });
          await updateEvent(event.commentId, `drafted_${promotion.reason}`);
        }
        return;
      }
      const safeTemplate = buildSafeTemplateReply({
        persona: account.persona,
        comment: event.text,
        senderId: event.senderId,
        relationship: relationship.relationship,
      });

      if (safeTemplate) {
        if (REPLY_MODE === 'limited_live') {
          try {
            await publishReply(event, account, safeTemplate);
            await saveDraft({
              event,
              account,
              draft: safeTemplate,
              status: 'published_template',
              model: 'curated-template-v1',
            });
            await updateEvent(event.commentId, 'replied_template');
          } catch (error) {
            const message = String(error.message).slice(0, 1000);
            await saveDraft({
              event,
              account,
              draft: safeTemplate,
              status: 'publish_failed',
              model: 'curated-template-v1',
              error: message,
            });
            await updateEvent(event.commentId, 'reply_failed', message);
          }
        } else {
          await saveDraft({
            event,
            account,
            draft: safeTemplate,
            status: 'pending_template',
            model: 'curated-template-v1',
          });
          await updateEvent(event.commentId, 'drafted_template');
        }
        return;
      }

      const generated = await generateDraft({
        persona: account.persona,
        comment: event.text,
        postText,
        username: event.username,
        relationship: relationship.relationship,
        relationshipNotes: relationship.notes,
        recentHistory: relationship.recentHistory,
      });
      await saveDraft({
        event,
        account,
        draft: generated.draft,
        status: generated.draft ? 'pending' : 'generation_blocked',
        model: generated.model,
        error: generated.error,
      });
      await updateEvent(
        event.commentId,
        generated.draft ? 'drafted' : 'generation_blocked',
        generated.error
      );
    } catch (error) {
      await updateEvent(event.commentId, 'generation_failed', String(error.message).slice(0, 1000));
    }
    return;
  }

  await updateEvent(event.commentId, decision.action === 'review' ? 'needs_review' : 'ignored');
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('Request body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function isAdmin(request) {
  return safeEqual(request.headers.authorization, `Bearer ${ADMIN_TOKEN}`);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');

  if (request.method === 'GET' && url.pathname === '/health') {
    const expectedAccounts = Object.keys(ACCOUNT_ROUTES).length;
    const ok = databaseSummary.ready && accountsByMetaId.size === expectedAccounts;
    sendJson(response, ok ? 200 : 503, {
      ok,
      accountsLoaded: accountsByMetaId.size,
      expectedAccounts,
      personaDrafting: Boolean(OPENAI_API_KEY),
      mode: REPLY_MODE,
      limitedPersonaReplies: REPLY_MODE === 'limited_live',
      commentPolicy: { aiReferences: 'delete_no_reply' },
      chayaSalesPrivateReplies: {
        enabled: CHAYA_SALES_PRIVATE_REPLIES_ENABLED,
        facebookPageId: CHAYA_FACEBOOK_PAGE_ID,
        instagramAccountId: CHAYA_INSTAGRAM_ACCOUNT_ID,
        rateLimitPerMinute: PRIVATE_REPLY_PER_MINUTE,
        rateLimitPerDay: PRIVATE_REPLY_PER_DAY,
        metaMarketingTokenRequiredOutside24Hours: true,
        outside24HourSendsEnabled: false,
      },
      clientDirectory: clientDirectory.status(),
      tiktokScheduler: tiktokSchedulerSummary,
      subscriptions: subscriptionSummary,
      database: databaseSummary,
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/webhooks/meta') {
    const valid =
      url.searchParams.get('hub.mode') === 'subscribe' &&
      safeEqual(url.searchParams.get('hub.verify_token'), META_VERIFY_TOKEN);
    if (!valid) return sendJson(response, 403, { error: 'Verification failed' });
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.end(url.searchParams.get('hub.challenge') || '');
    return;
  }

  if (request.method === 'POST' && url.pathname === '/webhooks/meta') {
    try {
      const rawBody = await readBody(request);
      if (!verifyMetaSignature(rawBody, request.headers['x-hub-signature-256'])) {
        return sendJson(response, 401, { error: 'Invalid signature' });
      }
      const payload = JSON.parse(rawBody.toString('utf8'));
      const events = extractEvents(payload);
      sendJson(response, 200, { received: true });
      for (const event of events) {
        setImmediate(() => processEvent(event).catch((error) => console.error('event_failed', error.message)));
      }
    } catch (error) {
      if (!response.headersSent) sendJson(response, 400, { error: error.message });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/admin/drafts') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT d.id, d."commentId", d."integrationId", d.persona, d.draft, d.status,
              d."createdAt", e.username, e."commentText", e.platform
         FROM comment_agent."PersonaReplyDraft" d
         JOIN comment_agent."CommentAgentEvent" e ON e."commentId" = d."commentId"
        ORDER BY d."createdAt" DESC LIMIT 100`
    );
    return sendJson(response, 200, { drafts: rows });
  }

  if (request.method === 'GET' && url.pathname === '/admin/events') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT "commentId", platform, "integrationId", persona, username, "commentText",
              action, reason, status, error, "createdAt", "processedAt"
         FROM comment_agent."CommentAgentEvent" ORDER BY "createdAt" DESC LIMIT 200`
    );
    return sendJson(response, 200, { events: rows });
  }

  if (request.method === 'GET' && url.pathname === '/admin/meta-status') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT "integrationId", "metaAccountId", platform, persona, fields, status,
              error, "updatedAt"
         FROM comment_agent."MetaAccountSubscription" ORDER BY persona, platform`
    );
    return sendJson(response, 200, { accounts: rows });
  }

  if (request.method === 'GET' && url.pathname === '/admin/private-replies') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT "commentId", platform, "integrationId", "metaAccountId", "postId",
              "commentSenderId", "metaRecipientId", "openingVariant", status,
              "metaMessageId", error, "attemptedAt", "sentAt", "createdAt"
         FROM comment_agent."PrivateReplyLog"
        ORDER BY "createdAt" DESC LIMIT 500`
    );
    return sendJson(response, 200, { privateReplies: rows });
  }

  if (request.method === 'GET' && url.pathname === '/admin/messaging-opt-ins') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT platform, "integrationId", "metaAccountId", "recipientId", "sourceCommentId",
              "sourceMessageId", "localOptInAt", "lastInboundAt", "thankYouSentAt",
              "metaMarketingOptInAt", "marketingStatus",
              ("metaMarketingToken" IS NOT NULL) AS "hasMetaMarketingToken",
              "createdAt", "updatedAt"
         FROM comment_agent."MessagingOptIn"
        ORDER BY "updatedAt" DESC LIMIT 500`
    );
    return sendJson(response, 200, { optIns: rows });
  }

  if (request.method === 'GET' && url.pathname === '/admin/daily-sales-report') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const requestedDate = url.searchParams.get('date') || new Intl.DateTimeFormat('en-CA', {
      timeZone: SALES_REPORT_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
      return sendJson(response, 400, { error: 'date must be YYYY-MM-DD' });
    }
    try {
      return sendJson(response, 200, await dailySalesReport(requestedDate));
    } catch (error) {
      return sendJson(response, 400, { error: String(error.message).slice(0, 1000) });
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/tiktok/schedule') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    try {
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      const post = await bufferApi.scheduleTikTok(body);
      return sendJson(response, 201, { post });
    } catch (error) {
      return sendJson(response, 400, { error: String(error.message).slice(0, 1000) });
    }
  }

  if (request.method === 'GET' && url.pathname === '/admin/tiktok/status') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    try {
      const post = await bufferApi.post(url.searchParams.get('id'));
      return sendJson(response, 200, { post });
    } catch (error) {
      return sendJson(response, 400, { error: String(error.message).slice(0, 1000) });
    }
  }

  if (request.method === 'POST' && url.pathname === '/admin/meta-refresh-required') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const integrationIds = Object.keys(ACCOUNT_ROUTES);
    const { rows } = await pool.query(
      `UPDATE "Integration"
          SET "refreshNeeded" = true
        WHERE id = ANY($1::text[]) AND disabled = false
        RETURNING id`,
      [integrationIds]
    );
    return sendJson(response, 200, {
      marked: rows.length,
      expected: integrationIds.length,
    });
  }

  if (request.method === 'GET' && url.pathname === '/admin/contacts') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT "integrationId", "metaUserId", persona, username, relationship, notes,
              confirmed, "createdAt", "updatedAt"
         FROM comment_agent."PersonaContactProfile" ORDER BY "updatedAt" DESC LIMIT 500`
    );
    return sendJson(response, 200, { contacts: rows });
  }

  if (request.method === 'PUT' && url.pathname === '/admin/contacts') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    try {
      const body = JSON.parse((await readBody(request)).toString('utf8'));
      const route = routeIntegration(String(body.integrationId || ''));
      const allowedRelationships = new Set(['new_follower', 'regular', 'friend_regular']);
      if (!route || !body.metaUserId || !allowedRelationships.has(body.relationship)) {
        return sendJson(response, 400, { error: 'Invalid contact profile' });
      }
      const { rows } = await pool.query(
        `INSERT INTO comment_agent."PersonaContactProfile" AS existing
          ("integrationId", "metaUserId", persona, username, relationship, notes, confirmed)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT ("integrationId", "metaUserId") DO UPDATE
           SET persona=EXCLUDED.persona, username=COALESCE(EXCLUDED.username, existing.username),
               relationship=EXCLUDED.relationship, notes=EXCLUDED.notes,
               confirmed=EXCLUDED.confirmed, "updatedAt"=NOW()
         RETURNING "integrationId", "metaUserId", persona, username, relationship, notes, confirmed`,
        [
          body.integrationId,
          String(body.metaUserId),
          route.persona,
          body.username ? String(body.username).slice(0, 200) : null,
          body.relationship,
          body.notes ? String(body.notes).slice(0, 1000) : null,
          body.confirmed === true,
        ]
      );
      return sendJson(response, 200, { contact: rows[0] });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  }

  sendJson(response, 404, { error: 'Not found' });
});

await refreshMetaAccountState();
await syncTikTokScheduler();
await clientDirectory.sync().catch((error) => {
  console.error('client_directory_sync_failed', error.message);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`comment_agent_ready port=${PORT} accounts=${accountsByMetaId.size} drafting=${Boolean(OPENAI_API_KEY)}`);
});

setInterval(async () => {
  try {
    await refreshMetaAccountState();
  } catch (error) {
    console.error('account_sync_failed', error.message);
  }
}, 60 * 1000).unref();

setInterval(() => {
  syncTikTokScheduler().catch((error) => console.error('tiktok_sync_failed', error.message));
}, 5 * 60 * 1000).unref();

setInterval(() => {
  clientDirectory.sync().catch((error) => console.error('client_directory_sync_failed', error.message));
}, CLIENT_HANDOVER_SYNC_MS).unref();

export { extractEvents };
