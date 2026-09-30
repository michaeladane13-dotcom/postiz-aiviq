import crypto from 'node:crypto';

// Explicit allowlist. In particular, the personal Michaela Dane integration is
// intentionally absent. A changed/missing integration fails closed.
export const DAILY_REEL_ROUTES = Object.freeze({
  chaya: Object.freeze({ instagram: 'cmt0ql9300001msb2pvozfwe9', facebook: 'cmt1vavvs0007myc1cbsep0dd' }),
  ren: Object.freeze({ instagram: 'cmt0qnn4j0005msb2y947wjgo', facebook: 'cmt3axou80001l6padw48ggsi' }),
  david: Object.freeze({ facebook: 'cmt0rnpaa0003n4bf1mkdhe9s' }),
  quietmoon: Object.freeze({ instagram: 'cmt0qmpc70003msb2rcdw9rg5' }),
  pullmychart: Object.freeze({ instagram: 'cmt0qr1ky000dmsb2jvsgahou' }),
  nadja: Object.freeze({ instagram: 'cmt0qpsu7000bmsb2oga61nh4', facebook: 'cmt3axpg50003l6pa5i2lf62b' }),
});

const REPOSITORY = 'michaeladane13-dotcom/reel-factory';
const INSTAGRAM_FALLBACKS = Object.freeze({
  cmt0qmpc70003msb2rcdw9rg5: 'thequietmoonstore',
  cmt0qr1ky000dmsb2jvsgahou: 'pullmychart',
});
const APPROVED_INSTAGRAM_TOKEN_IDS = Object.freeze([
  DAILY_REEL_ROUTES.chaya.instagram,
  DAILY_REEL_ROUTES.ren.instagram,
  DAILY_REEL_ROUTES.nadja.instagram,
]);
const GH_HEADERS = (token) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'User-Agent': 'aiviq-daily-reels',
  'X-GitHub-Api-Version': '2022-11-28',
});

export function vancouverDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function selectTodayAssets(registry, day) {
  const latest = new Map();
  for (const record of registry) {
    if (record?.state !== 'READY' || !DAILY_REEL_ROUTES[record.brand]) continue;
    if (typeof record.asset_locator !== 'string' || !record.asset_locator.startsWith('github-release:')) continue;
    if (record.asset_locator.split('/').at(-1)?.slice(0, 10) !== day) continue;
    if (!/^[a-f0-9]{64}$/.test(record.content_sha256 || '')) continue;
    const prior = latest.get(record.brand);
    if (!prior || Date.parse(record.recorded_at) > Date.parse(prior.recorded_at)) latest.set(record.brand, record);
  }
  return [...latest.values()];
}

export function captionFor(brand, shadow) {
  if (shadow?.brand !== brand || shadow?.state !== 'DRAFT' || !shadow?.caption) {
    throw new Error('The private draft does not match the generated brand');
  }
  const base = String(shadow.caption).replace(/\s+/g, ' ').trim();
  if (!base || base.length > 1800) throw new Error('Invalid reel caption');
  return `${base}\n\nExplore the link on this page. Use code REELS33 at checkout.`;
}

async function jsonResponse(response, label) {
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { throw new Error(`${label}: invalid response (HTTP ${response.status})`); }
  if (!response.ok || data?.error) {
    const code = data?.error?.code || response.status;
    throw new Error(`${label}: ${data?.error?.message || 'HTTP error'} (${code})`);
  }
  return data;
}

export class DailyReelPublisher {
  constructor({ pool, token, graphVersion = 'v26.0', fetchImpl = fetch, now = () => new Date(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    this.pool = pool;
    this.token = token;
    this.graphVersion = graphVersion;
    this.fetch = fetchImpl;
    this.now = now;
    this.sleep = sleep;
    this.running = false;
    this.status = { configured: Boolean(token), lastCheckedAt: null, lastSuccessAt: null, error: token ? null : 'GitHub read token unavailable' };
  }

  async github(path, accept = 'application/vnd.github+json') {
    const response = await this.fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
      headers: { ...GH_HEADERS(this.token), Accept: accept }, signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub ${path.split('/')[0]} returned HTTP ${response.status}`);
    return response;
  }

  async githubFile(path) {
    const response = await this.github(`contents/${path}?ref=main`, 'application/vnd.github.raw+json');
    return response.text();
  }

  async probe() {
    try {
      if (!this.token) throw new Error('GitHub read token unavailable');
      const registry = await this.githubFile('asset-registry.jsonl');
      if (!registry.includes('asset_locator')) throw new Error('Reel registry is unreadable');
      this.status.githubReadable = true;
      this.status.error = null;
    } catch (error) {
      this.status.githubReadable = false;
      this.status.error = String(error.message).slice(0, 500);
    }
    return { ...this.status };
  }

  async assetBytes(record) {
    const locator = record.asset_locator.slice('github-release:'.length);
    const slash = locator.indexOf('/');
    if (slash < 1) throw new Error('Invalid release locator');
    const tag = locator.slice(0, slash);
    const filename = locator.slice(slash + 1);
    if (!/^media-[0-9]+-[0-9]+$/.test(tag) || !/^[0-9-]+-[a-z]+-[a-f0-9]{12}\.mp4$/.test(filename)) {
      throw new Error('Unsafe release locator');
    }
    const release = await jsonResponse(await this.github(`releases/tags/${encodeURIComponent(tag)}`), 'release');
    const asset = release.assets?.find((candidate) => candidate.name === filename);
    if (!asset || !Number.isSafeInteger(asset.size) || asset.size < 100_000 || asset.size > 150_000_000) {
      throw new Error('Release MP4 missing or outside the allowed size');
    }
    const response = await this.github(`releases/assets/${asset.id}`, 'application/octet-stream');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== asset.size || crypto.createHash('sha256').update(bytes).digest('hex') !== record.content_sha256) {
      throw new Error('Release MP4 failed length/hash verification');
    }
    return bytes;
  }

  async graph(path, accessToken, { method = 'GET', body, fields } = {}) {
    const url = new URL(`https://graph.facebook.com/${this.graphVersion}/${path}`);
    url.searchParams.set('access_token', accessToken);
    if (fields) url.searchParams.set('fields', fields);
    const response = await this.fetch(url, {
      method, body, signal: AbortSignal.timeout(40_000),
    });
    return jsonResponse(response, `Meta ${path.split('/').at(-1)}`);
  }

  async upload(uri, accessToken, bytes) {
    const target = new URL(uri);
    if (target.protocol !== 'https:' || target.hostname !== 'rupload.facebook.com') {
      throw new Error('Meta returned an untrusted upload URI');
    }
    const response = await this.fetch(target, {
      method: 'POST', headers: {
        Authorization: `OAuth ${accessToken}`, offset: '0', file_size: String(bytes.length),
        'Content-Type': 'application/octet-stream',
      }, body: bytes, signal: AbortSignal.timeout(180_000),
    });
    return jsonResponse(response, 'Meta binary upload');
  }

  async migrate() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS comment_agent."DailyReelPublication" (
      "assetId" TEXT NOT NULL, "integrationId" TEXT NOT NULL, brand TEXT NOT NULL,
      platform TEXT NOT NULL, "scopeDay" DATE NOT NULL, status TEXT NOT NULL,
      "contentHash" TEXT NOT NULL, caption TEXT NOT NULL,
      "containerId" TEXT, "mediaId" TEXT, permalink TEXT, error TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY ("assetId", "integrationId"), UNIQUE (brand, platform, "scopeDay")
    )`);
  }

  async integration(id, platform) {
    const { rows } = await this.pool.query(
      `SELECT id, "internalId", "providerIdentifier", token, name FROM "Integration" WHERE id=$1 AND disabled=false`, [id]);
    const row = rows[0];
    if (!row || row.providerIdentifier !== platform || !/^\d+$/.test(String(row.internalId || ''))) {
      throw new Error(`Approved ${platform} integration ${id} is missing or mismatched`);
    }
    const accountId = String(row.internalId);
    const ownToken = String(row.token).split('___')[0];
    if (platform !== 'instagram') return { accountId, token: ownToken };
    try {
      await this.graph(accountId, ownToken, { fields: 'id' });
      return { accountId, token: ownToken };
    } catch (ownError) {
      const expectedUsername = INSTAGRAM_FALLBACKS[id];
      if (!expectedUsername) throw ownError;
      const alternatives = await this.pool.query(
        `SELECT id, token FROM "Integration"
          WHERE id = ANY($1::text[]) AND disabled=false AND "providerIdentifier"='instagram'`,
        [APPROVED_INSTAGRAM_TOKEN_IDS]);
      for (const candidate of alternatives.rows) {
        const token = String(candidate.token).split('___')[0];
        try {
          const account = await this.graph(accountId, token, { fields: 'id,username' });
          if (String(account.id) === accountId &&
              String(account.username || '').toLowerCase() === expectedUsername) {
            return { accountId, token };
          }
        } catch { /* This candidate does not have access to this exact account. */ }
      }
      throw ownError;
    }
  }

  async probeIntegrations() {
    const failures = [];
    let ready = 0;
    let expected = 0;
    for (const [brand, routes] of Object.entries(DAILY_REEL_ROUTES)) {
      for (const [platform, id] of Object.entries(routes)) {
        expected += 1;
        try {
          const account = await this.integration(id, platform);
          await this.graph(account.accountId, account.token, { fields: 'id' });
          ready += 1;
        } catch (error) {
          failures.push({ brand, platform, error: String(error.message).slice(0, 250) });
        }
      }
    }
    this.status.destinations = { ready, expected, failures };
    return this.status.destinations;
  }

  async reserve(record, platform, integrationId, caption, day) {
    let { rows } = await this.pool.query(
      `INSERT INTO comment_agent."DailyReelPublication"
         ("assetId", "integrationId", brand, platform, "scopeDay", status, "contentHash", caption)
       VALUES ($1,$2,$3,$4,$5,'reserved',$6,$7)
      ON CONFLICT DO NOTHING RETURNING *`,
      [record.asset_id, integrationId, record.brand, platform, day, record.content_sha256, caption]);
    if (!rows.length) {
      // A failure before Meta assigned a container cannot have published a
      // reel. This also recovers the common registry-before-release race.
      ({ rows } = await this.pool.query(
        `UPDATE comment_agent."DailyReelPublication"
            SET status='reserved', error=NULL, "updatedAt"=NOW()
          WHERE "assetId"=$1 AND "integrationId"=$2
            AND status='needs_review' AND "containerId" IS NULL
          RETURNING *`, [record.asset_id, integrationId]));
    }
    return Boolean(rows.length);
  }

  async publishIncoming(record, shadow, bytes) {
    if (!record || !DAILY_REEL_ROUTES[record.brand] || record.state !== 'READY') {
      throw new Error('Unapproved or unready reel asset');
    }
    const day = record.asset_locator?.split('/').at(-1)?.slice(0, 10);
    const today = vancouverDay(this.now());
    const yesterday = vancouverDay(new Date(this.now().getTime() - 24 * 60 * 60 * 1000));
    if (day !== today && day !== yesterday) throw new Error('Reel is outside the allowed daily delivery window');
    if (shadow?.asset_id !== record.asset_id || shadow?.job_id !== record.job_id) {
      throw new Error('Reel draft identity mismatch');
    }
    if (!Buffer.isBuffer(bytes) || bytes.length < 100_000 || bytes.length > 150_000_000 ||
        crypto.createHash('sha256').update(bytes).digest('hex') !== record.content_sha256) {
      throw new Error('Reel binary failed size/hash verification');
    }
    await this.migrate();
    const caption = captionFor(record.brand, shadow);
    const results = [];
    for (const [platform, integrationId] of Object.entries(DAILY_REEL_ROUTES[record.brand])) {
      const reserved = await this.reserve(record, platform, integrationId, caption, day);
      if (!reserved) {
        const { rows } = await this.pool.query(
          `SELECT status, error FROM comment_agent."DailyReelPublication"
            WHERE "assetId"=$1 AND "integrationId"=$2`, [record.asset_id, integrationId]);
        results.push({ brand: record.brand, platform,
          status: rows[0]?.status === 'verified' ? 'verified' : rows[0]?.status || 'conflict',
          error: rows[0]?.error || undefined });
        continue;
      }
      try {
        const account = await this.integration(integrationId, platform);
        if (platform === 'instagram') await this.instagram(record, integrationId, account, caption, bytes);
        else await this.facebook(record, integrationId, account, caption, bytes);
        results.push({ brand: record.brand, platform, status: 'verified' });
      } catch (error) {
        await this.update(record, integrationId, 'needs_review', { error: String(error.message).slice(0, 500) });
        console.error('daily_reel_destination_failed', record.brand, platform, error.message);
        results.push({ brand: record.brand, platform, status: 'needs_review', error: error.message });
      }
    }
    this.status.lastCheckedAt = this.now().toISOString();
    if (results.every((result) => result.status === 'verified')) {
      this.status.lastSuccessAt = this.now().toISOString();
      this.status.error = null;
    } else {
      this.status.error = 'One or more daily reel destinations need repair';
    }
    return results;
  }

  async update(record, integrationId, status, fields = {}) {
    await this.pool.query(
      `UPDATE comment_agent."DailyReelPublication" SET status=$3,
        "containerId"=COALESCE($4,"containerId"), "mediaId"=COALESCE($5,"mediaId"),
        permalink=COALESCE($6,permalink), error=$7, "updatedAt"=NOW()
       WHERE "assetId"=$1 AND "integrationId"=$2`,
      [record.asset_id, integrationId, status, fields.containerId || null, fields.mediaId || null,
        fields.permalink || null, fields.error || null]);
  }

  async instagram(record, integrationId, account, caption, bytes) {
    await this.update(record, integrationId, 'starting');
    const container = await this.graph(`${account.accountId}/media`, account.token, {
      method: 'POST', body: new URLSearchParams({ media_type: 'REELS', upload_type: 'resumable', caption }),
    });
    if (!container.id || !container.uri) throw new Error('Instagram did not return a resumable container');
    await this.update(record, integrationId, 'container_created', { containerId: container.id });
    await this.upload(container.uri, account.token, bytes);
    await this.update(record, integrationId, 'processing');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await this.graph(container.id, account.token, { fields: 'status_code' });
      if (status.status_code === 'FINISHED') break;
      if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') throw new Error(`Instagram container ${status.status_code}`);
      if (attempt === 29) throw new Error('Instagram container still processing; publishing was not retried');
      await this.sleep(3000);
    }
    // From this point onward an uncertain response must not cause another publish.
    await this.update(record, integrationId, 'publishing');
    const published = await this.graph(`${account.accountId}/media_publish`, account.token, {
      method: 'POST', body: new URLSearchParams({ creation_id: container.id }),
    });
    if (!published.id) throw new Error('Instagram publication was not acknowledged');
    await this.update(record, integrationId, 'published_unverified', { mediaId: published.id });
    const media = await this.graph(published.id, account.token, { fields: 'id,permalink,caption' });
    if (!media.permalink) throw new Error('Instagram has not returned a live permalink yet');
    await this.update(record, integrationId, 'verified', { permalink: media.permalink });
  }

  async facebook(record, integrationId, account, caption, bytes) {
    await this.update(record, integrationId, 'starting');
    const started = await this.graph('me/video_reels', account.token, {
      method: 'POST', body: new URLSearchParams({ upload_phase: 'start' }),
    });
    if (!started.video_id || !started.upload_url) throw new Error('Facebook did not return a Reel upload session');
    await this.update(record, integrationId, 'container_created', { containerId: started.video_id });
    await this.upload(started.upload_url, account.token, bytes);
    await this.update(record, integrationId, 'publishing');
    await this.graph('me/video_reels', account.token, {
      method: 'POST', body: new URLSearchParams({
        upload_phase: 'finish', video_id: String(started.video_id), video_state: 'PUBLISHED', description: caption,
      }),
    });
    await this.update(record, integrationId, 'published_unverified', { mediaId: started.video_id });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const media = await this.graph(started.video_id, account.token, { fields: 'id,status,permalink_url' });
      const state = String(media.status?.video_status || '').toLowerCase();
      if (state === 'error' || state === 'failed') throw new Error(`Facebook Reel processing ${state}`);
      if (['ready', 'published'].includes(state) || media.permalink_url) {
        await this.update(record, integrationId, 'verified', {
          permalink: media.permalink_url || `https://www.facebook.com/reel/${started.video_id}`,
        });
        return;
      }
      if (attempt < 39) await this.sleep(3000);
    }
    throw new Error('Facebook Reel accepted but is still processing; no duplicate upload was attempted');
  }

  async run() {
    if (this.running) return;
    this.running = true;
    this.status.lastCheckedAt = this.now().toISOString();
    try {
      if (!this.token) throw new Error('GitHub read token unavailable');
      await this.migrate();
      const day = vancouverDay(this.now());
      const registry = (await this.githubFile('asset-registry.jsonl')).split(/\r?\n/)
        .filter(Boolean).map((line) => JSON.parse(line));
      for (const record of selectTodayAssets(registry, day)) {
        const shadow = JSON.parse(await this.githubFile(`shadow-drafts/${record.job_id}.json`));
        if (shadow.asset_id !== record.asset_id) throw new Error(`Draft asset mismatch for ${record.brand}`);
        const caption = captionFor(record.brand, shadow);
        let bytes;
        for (const [platform, integrationId] of Object.entries(DAILY_REEL_ROUTES[record.brand])) {
          const reserved = await this.reserve(record, platform, integrationId, caption, day);
          if (!reserved) continue; // Durable one-post-per-brand/platform/day guard.
          try {
            const account = await this.integration(integrationId, platform);
            bytes ||= await this.assetBytes(record);
            if (platform === 'instagram') await this.instagram(record, integrationId, account, caption, bytes);
            else await this.facebook(record, integrationId, account, caption, bytes);
          } catch (error) {
            await this.update(record, integrationId, 'needs_review', { error: String(error.message).slice(0, 500) });
            console.error('daily_reel_destination_failed', record.brand, platform, error.message);
          }
        }
      }
      this.status.lastSuccessAt = this.now().toISOString();
      this.status.error = null;
    } catch (error) {
      this.status.error = String(error.message).slice(0, 500);
      console.error('daily_reel_scan_failed', this.status.error);
    } finally {
      this.running = false;
    }
  }
}
