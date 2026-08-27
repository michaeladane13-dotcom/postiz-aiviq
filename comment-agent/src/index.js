import crypto from 'node:crypto';
import http from 'node:http';
import { Pool } from 'pg';
import {
  ACCOUNT_ROUTES,
  PERSONAS,
  buildReplyPrompt,
  classifyComment,
  metaSubscriptionTarget,
  routeIntegration,
} from './policy.js';

const PORT = Number(process.env.PORT || 3000);
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v26.0';
const DATABASE_URL = process.env.DATABASE_URL;
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const ADMIN_TOKEN = process.env.COMMENT_AGENT_ADMIN_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';

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
let subscriptionSummary = { subscribed: 0, failed: 0, pending: 0, reasons: {} };

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
    CREATE TABLE IF NOT EXISTS "CommentAgentEvent" (
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
    CREATE TABLE IF NOT EXISTS "PersonaReplyDraft" (
      "id" UUID PRIMARY KEY,
      "commentId" TEXT NOT NULL UNIQUE REFERENCES "CommentAgentEvent"("commentId") ON DELETE CASCADE,
      "integrationId" TEXT NOT NULL,
      "persona" TEXT NOT NULL,
      "draft" TEXT,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "model" TEXT,
      "error" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS "PersonaContactProfile" (
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
    CREATE TABLE IF NOT EXISTS "MetaAccountSubscription" (
      "integrationId" TEXT PRIMARY KEY,
      "metaAccountId" TEXT NOT NULL,
      platform TEXT NOT NULL,
      persona TEXT NOT NULL,
      fields TEXT[] NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE "CommentAgentEvent" ADD COLUMN IF NOT EXISTS "senderId" TEXT;
    CREATE INDEX IF NOT EXISTS "CommentAgentEvent_createdAt_idx"
      ON "CommentAgentEvent" ("createdAt" DESC);
    CREATE INDEX IF NOT EXISTS "CommentAgentEvent_sender_idx"
      ON "CommentAgentEvent" ("integrationId", "senderId", "createdAt" DESC);
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

function extractEvents(payload) {
  const events = [];
  const object = payload?.object;
  for (const entry of payload?.entry || []) {
    const changes = Array.isArray(entry.changes)
      ? entry.changes
      : entry.field
        ? [{ field: entry.field, value: entry.value }]
        : [];

    for (const change of changes) {
      const value = change?.value || {};
      if (object === 'instagram' && ['comments', 'live_comments'].includes(change.field)) {
        events.push({
          platform: 'instagram',
          metaAccountId: String(entry.id),
          commentId: String(value.id || ''),
          text: String(value.text || ''),
          username: String(value.from?.username || value.from?.id || ''),
          senderId: String(value.from?.id || ''),
          postId: String(value.media?.id || ''),
          raw: { object, entryId: entry.id, change },
        });
      }

      if (
        object === 'page' &&
        change.field === 'feed' &&
        value.item === 'comment' &&
        value.verb === 'add'
      ) {
        events.push({
          platform: 'facebook',
          metaAccountId: String(entry.id),
          commentId: String(value.comment_id || ''),
          text: String(value.message || ''),
          username: String(value.sender_name || value.from?.name || ''),
          senderId: String(value.sender_id || value.from?.id || ''),
          postId: String(value.post_id || value.parent_id || ''),
          raw: { object, entryId: entry.id, change },
        });
      }
    }
  }
  return events.filter((event) => event.commentId && event.metaAccountId);
}

async function graphRequest(path, accessToken, options = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
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
    throw error;
  }
  return body;
}

async function syncSubscriptions() {
  const summary = { subscribed: 0, failed: 0, pending: accountsByMetaId.size, reasons: {} };
  for (const account of accountsByMetaId.values()) {
    const fields = account.platform === 'facebook' ? ['feed'] : ['comments'];
    let status = 'subscribed';
    let error = null;
    try {
      // Facebook Login supplies a Page access token for Instagram integrations.
      // Meta requires /me/subscribed_apps for that flow: /me resolves to the
      // linked Facebook Page, while Instagram webhook payloads still carry the
      // Instagram professional account ID used by accountsByMetaId.
      const subscriptionTarget = metaSubscriptionTarget(
        account.platform,
        account.metaAccountId
      );
      await graphRequest(
        `${subscriptionTarget}/subscribed_apps?subscribed_fields=${encodeURIComponent(fields.join(','))}`,
        account.accessToken,
        { method: 'POST' }
      );
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
      `INSERT INTO "MetaAccountSubscription"
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
  return { draft: draft.slice(0, 1000), model: OPENAI_MODEL, error: null };
}

async function saveEvent(event, account, decision) {
  const result = await pool.query(
    `INSERT INTO "CommentAgentEvent"
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
  if (!event.senderId) {
    return { relationship: 'new_follower', notes: '', recentHistory: [] };
  }

  await pool.query(
    `INSERT INTO "PersonaContactProfile"
      ("integrationId", "metaUserId", persona, username)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT ("integrationId", "metaUserId") DO UPDATE
       SET username=EXCLUDED.username, "updatedAt"=NOW()`,
    [account.integrationId, event.senderId, account.persona, event.username || null]
  );

  const profileResult = await pool.query(
    `SELECT relationship, notes, confirmed
       FROM "PersonaContactProfile"
      WHERE "integrationId"=$1 AND "metaUserId"=$2`,
    [account.integrationId, event.senderId]
  );
  const profile = profileResult.rows[0];

  const historyResult = await pool.query(
    `SELECT "commentText", status, "createdAt"
       FROM "CommentAgentEvent"
      WHERE "integrationId"=$1 AND "senderId"=$2 AND "commentId"<>$3
      ORDER BY "createdAt" DESC LIMIT 6`,
    [account.integrationId, event.senderId, event.commentId]
  );

  return {
    relationship: profile?.confirmed ? profile.relationship : 'new_follower',
    notes: profile?.confirmed ? profile.notes || '' : '',
    recentHistory: historyResult.rows.reverse().map((row) => ({
      comment: row.commentText,
      outcome: row.status,
    })),
  };
}

async function updateEvent(commentId, status, error = null) {
  await pool.query(
    `UPDATE "CommentAgentEvent"
        SET status=$2, error=$3, "processedAt"=NOW()
      WHERE "commentId"=$1`,
    [commentId, status, error]
  );
}

async function processEvent(event) {
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
      const generated = await generateDraft({
        persona: account.persona,
        comment: event.text,
        postText,
        username: event.username,
        relationship: relationship.relationship,
        relationshipNotes: relationship.notes,
        recentHistory: relationship.recentHistory,
      });
      await pool.query(
        `INSERT INTO "PersonaReplyDraft"
          (id, "commentId", "integrationId", persona, draft, status, model, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          crypto.randomUUID(),
          event.commentId,
          account.integrationId,
          account.persona,
          generated.draft,
          generated.draft ? 'pending' : 'generation_blocked',
          generated.model,
          generated.error,
        ]
      );
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
    sendJson(response, 200, {
      ok: true,
      accountsLoaded: accountsByMetaId.size,
      personaDrafting: Boolean(OPENAI_API_KEY),
      mode: 'shadow',
      subscriptions: subscriptionSummary,
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
         FROM "PersonaReplyDraft" d
         JOIN "CommentAgentEvent" e ON e."commentId" = d."commentId"
        ORDER BY d."createdAt" DESC LIMIT 100`
    );
    return sendJson(response, 200, { drafts: rows });
  }

  if (request.method === 'GET' && url.pathname === '/admin/events') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT "commentId", platform, "integrationId", persona, username, "commentText",
              action, reason, status, error, "createdAt", "processedAt"
         FROM "CommentAgentEvent" ORDER BY "createdAt" DESC LIMIT 200`
    );
    return sendJson(response, 200, { events: rows });
  }

  if (request.method === 'GET' && url.pathname === '/admin/meta-status') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT "integrationId", "metaAccountId", platform, persona, fields, status,
              error, "updatedAt"
         FROM "MetaAccountSubscription" ORDER BY persona, platform`
    );
    return sendJson(response, 200, { accounts: rows });
  }

  if (request.method === 'GET' && url.pathname === '/admin/contacts') {
    if (!isAdmin(request)) return sendJson(response, 401, { error: 'Unauthorized' });
    const { rows } = await pool.query(
      `SELECT "integrationId", "metaUserId", persona, username, relationship, notes,
              confirmed, "createdAt", "updatedAt"
         FROM "PersonaContactProfile" ORDER BY "updatedAt" DESC LIMIT 500`
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
        `INSERT INTO "PersonaContactProfile"
          ("integrationId", "metaUserId", persona, username, relationship, notes, confirmed)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT ("integrationId", "metaUserId") DO UPDATE
           SET persona=EXCLUDED.persona, username=COALESCE(EXCLUDED.username, "PersonaContactProfile".username),
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

await migrate();
await loadAccounts();
await syncSubscriptions();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`comment_agent_ready port=${PORT} accounts=${accountsByMetaId.size} drafting=${Boolean(OPENAI_API_KEY)}`);
});

setInterval(() => loadAccounts().catch((error) => console.error('account_reload_failed', error.message)), 10 * 60 * 1000).unref();
setInterval(() => syncSubscriptions().catch((error) => console.error('subscription_sync_failed', error.message)), 10 * 60 * 1000).unref();

export { extractEvents };
