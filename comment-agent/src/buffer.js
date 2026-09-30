const BUFFER_API_URL = 'https://api.buffer.com';

export const TIKTOK_CHANNELS = Object.freeze({
  chaya: '6a91debbccaf649a67361c10',
  iris: '6a921d9eccaf649a6738d3ae',
  ren: '6a922467ccaf649a67390159',
});

function normalizeBrand(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function validateMediaUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('mediaUrl must be a public HTTPS URL');
  }
  return url.toString();
}

function validateDueAt(value) {
  const dueAt = new Date(String(value || ''));
  if (!Number.isFinite(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
    throw new Error('dueAt must be a future ISO-8601 date');
  }
  return dueAt.toISOString();
}

function responseHeader(response, name) {
  return response?.headers && typeof response.headers.get === 'function'
    ? response.headers.get(name)
    : null;
}

export function parseBufferRateLimits(value) {
  const raw = String(value || '').trim();
  const windows = [...raw.matchAll(/"([^"]+)"\s*;\s*r=(\d+)\s*;\s*t=(\d+)/g)].map((match) => ({
    policy: match[1],
    remaining: Number(match[2]),
    resetsInSeconds: Number(match[3]),
  }));
  return {
    raw: raw || null,
    windows,
    minimumRemaining: windows.length
      ? Math.min(...windows.map((window) => window.remaining))
      : null,
  };
}

export function validateTikTokSchedule(input) {
  const brand = normalizeBrand(input?.brand);
  const channelId = TIKTOK_CHANNELS[brand];
  if (!channelId) throw new Error('Unknown TikTok brand');
  const caption = String(input?.caption || '').trim();
  if (caption.length > 2200) throw new Error('caption is too long');
  return {
    brand,
    channelId,
    caption,
    mediaUrl: validateMediaUrl(input?.mediaUrl),
    dueAt: validateDueAt(input?.dueAt),
  };
}

export class BufferApi {
  constructor(apiKey, fetchImpl = fetch) {
    this.apiKey = String(apiKey || '');
    this.fetch = fetchImpl;
    this.lastRateLimits = parseBufferRateLimits('');
  }

  rateLimitStatus() {
    return {
      raw: this.lastRateLimits.raw,
      windows: this.lastRateLimits.windows.map((window) => ({ ...window })),
      minimumRemaining: this.lastRateLimits.minimumRemaining,
    };
  }

  async graphql(query, variables = {}) {
    if (!this.apiKey) throw new Error('BUFFER_API_KEY is not configured');
    const response = await this.fetch(BUFFER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    this.lastRateLimits = parseBufferRateLimits(responseHeader(response, 'ratelimit'));
    if (!response.ok) {
      const apiMessage = body?.errors?.map((item) => item.message).filter(Boolean).join('; ');
      const error = new Error(apiMessage || `Buffer returned HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterSeconds = Math.max(0, Number(responseHeader(response, 'retry-after') || 0));
      error.rateLimitWindow = body?.errors?.find((item) => item.extensions?.window)?.extensions?.window || null;
      throw error;
    }
    if (body?.errors?.length) {
      throw new Error(body.errors.map((item) => item.message || String(item)).join('; '));
    }
    return body?.data || {};
  }

  async scheduleTikTok(input) {
    const schedule = validateTikTokSchedule(input);
    const data = await this.graphql(`
      mutation ScheduleTikTok($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess { post { id text status dueAt channelId } }
          ... on MutationError { message }
        }
      }
    `, {
      input: {
        text: schedule.caption,
        channelId: schedule.channelId,
        schedulingType: 'automatic',
        mode: 'customScheduled',
        dueAt: schedule.dueAt,
        assets: [{ video: { url: schedule.mediaUrl } }],
      },
    });
    const result = data.createPost;
    if (!result || result.__typename === 'MutationError' || result.message) {
      throw new Error(result?.message || 'Buffer did not create the post');
    }
    if (!result.post?.id) throw new Error('Buffer response is missing the created post');
    return result.post;
  }

  async connectedTikTokChannels() {
    const data = await this.graphql(`
      query ApprovedTikTokChannels(
        $chaya: ChannelId!
        $iris: ChannelId!
        $ren: ChannelId!
      ) {
        chaya: channel(input: { id: $chaya }) {
          id name displayName service isDisconnected isLocked
        }
        iris: channel(input: { id: $iris }) {
          id name displayName service isDisconnected isLocked
        }
        ren: channel(input: { id: $ren }) {
          id name displayName service isDisconnected isLocked
        }
      }
    `, TIKTOK_CHANNELS);
    const channels = [data.chaya, data.iris, data.ren].filter(Boolean);
    const approvedIds = new Set(Object.values(TIKTOK_CHANNELS));
    return channels.filter((channel) =>
      channel.service === 'tiktok' &&
      approvedIds.has(channel.id) &&
      !channel.isDisconnected &&
      !channel.isLocked
    );
  }

  async post(postId) {
    const encodedId = JSON.stringify(String(postId || ''));
    const data = await this.graphql(`
      query TikTokPostStatus {
        post(input: { id: ${encodedId} }) {
          id text status dueAt channelId sentAt externalLink updatedAt
          error { message supportUrl }
        }
      }
    `);
    if (!data.post?.id) throw new Error('Buffer post was not found');
    return data.post;
  }
}
