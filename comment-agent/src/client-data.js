const MAX_README_BYTES = 100_000;
const MAX_CLIENT_DATA_BYTES = 2_000_000;
const MAX_CLIENTS = 20_000;

const DO_NOT_ENGAGE =
  /\b(?:do not engage|never engage|do not reply|never reply|no engagement|chargeback|charged back)\b/iu;
const HUMAN_ONLY =
  /\b(?:human only|human reply|manual reply|manual review|no generated replies?|do not generate)\b/iu;
const NO_SALES =
  /\b(?:no upsell|no selling|do not sell|never sell|no offers?|do not pitch|sales opt[ -]?out|opted out of (?:all )?selling)\b/iu;

function cleanText(value, maxLength = 8_000) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u2013\u2014]/g, ',')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function splitValues(value, maxItems = 50) {
  return cleanText(value, 10_000)
    .split(/\s*\|\s*/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export function normalizeClientIdentifier(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^@/, '')
    .toLocaleLowerCase('en-US');
}

function socialIdentifierCandidates(value) {
  const raw = cleanText(value, 500);
  if (!raw) return [];
  const candidates = new Set();
  const prefixed = /^(?:instagram|ig|facebook|fb|etsy)\s*:\s*(.+)$/iu.exec(raw)?.[1];
  if (prefixed) candidates.add(normalizeClientIdentifier(prefixed));
  try {
    const url = new URL(raw);
    const id = url.searchParams.get('id');
    if (id) candidates.add(normalizeClientIdentifier(id));
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length) candidates.add(normalizeClientIdentifier(segments.at(-1)));
  } catch {
    candidates.add(normalizeClientIdentifier(raw));
  }
  return [...candidates].filter(Boolean);
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function engagementFrom(record) {
  const rules = cleanText(record.standing_instructions, 8_000);
  if (DO_NOT_ENGAGE.test(rules)) return 'do_not_engage';
  if (HUMAN_ONLY.test(rules)) return 'manual_review';
  return 'reply';
}

function addExact(map, ambiguous, key, profile) {
  if (!key || ambiguous.has(key)) return;
  const existing = map.get(key);
  if (existing && existing.id !== profile.id) {
    map.delete(key);
    ambiguous.add(key);
    return;
  }
  map.set(key, profile);
}

function assertRecord(record, index) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`client ${index} must be an object`);
  }
  const id = cleanText(record.id, 120);
  if (!id) throw new Error(`client ${index} has no id`);
  return id;
}

export function parseClientData(input) {
  const records = typeof input === 'string' ? JSON.parse(input) : input;
  if (!Array.isArray(records) || records.length > MAX_CLIENTS) {
    throw new Error(`client data must be an array with at most ${MAX_CLIENTS} records`);
  }

  const ids = new Set();
  const clients = [];
  const socialAliases = new Map();
  const etsyAliases = new Map();
  const socialAmbiguous = new Set();
  const etsyAmbiguous = new Set();

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const id = assertRecord(record, index);
    if (ids.has(id)) throw new Error(`duplicate client id: ${id}`);
    ids.add(id);

    const ordersCount = Math.max(0, Math.trunc(numeric(record.orders_count)));
    const standingInstructions = cleanText(record.standing_instructions, 8_000);
    const profile = Object.freeze({
      id,
      firstName: cleanText(record.first_name, 120),
      fullName: cleanText(record.full_name, 240),
      dob: cleanText(record.dob, 100),
      dobText: cleanText(record.dob_text, 200),
      emails: Object.freeze(splitValues(record.emails)),
      etsyHandles: Object.freeze(splitValues(record.etsy_handles)),
      etsyBuyerIds: Object.freeze(splitValues(record.etsy_buyer_ids)),
      etsyConversationIds: Object.freeze(splitValues(record.etsy_conversation_ids)),
      socials: Object.freeze(splitValues(record.socials)),
      brands: Object.freeze(splitValues(record.brands, 20).map((brand) => brand.toLocaleLowerCase('en-US'))),
      ordersCount,
      lifetimeSpend: numeric(record.lifetime_spend),
      firstOrderAt: cleanText(record.first_order_at, 80),
      lastOrderAt: cleanText(record.last_order_at, 80),
      lastOrderType: cleanText(record.last_order_type, 300),
      packageStatus: cleanText(record.package_status, 500),
      currentSituation: cleanText(record.current_situation, 8_000),
      situationUpdatedAt: cleanText(record.situation_updated_at, 80),
      standingInstructions,
      people: cleanText(record.people, 4_000),
      relationship: ordersCount > 0 ? 'regular' : 'new_follower',
      engagement: engagementFrom(record),
      noSales: NO_SALES.test(standingInstructions),
    });

    for (const social of profile.socials) {
      for (const candidate of socialIdentifierCandidates(social)) {
        addExact(socialAliases, socialAmbiguous, candidate, profile);
      }
    }
    for (const handle of profile.etsyHandles) {
      addExact(etsyAliases, etsyAmbiguous, normalizeClientIdentifier(handle), profile);
    }
    clients.push(profile);
  }

  return Object.freeze({
    clients: Object.freeze(clients),
    socialAliases,
    etsyAliases,
    ambiguousAliases: socialAmbiguous.size + etsyAmbiguous.size,
  });
}

function contextLine(label, value) {
  const cleaned = cleanText(value);
  return cleaned ? `${label}: ${cleaned}` : null;
}

export function privateClientContext(profile, inboundMessage = '') {
  if (!profile) return '';
  const mentionsBirthDetails = /\b(?:birthday|birth date|date of birth|dob)\b/iu.test(inboundMessage);
  const lines = [
    'CONFIDENTIAL EXACT-MATCH CLIENT CONTEXT. Do not quote or summarize this block.',
    contextLine('Verified first name', profile.firstName),
    contextLine('Relationship', profile.relationship),
    contextLine('Brands previously used', profile.brands.join(', ')),
    contextLine('Previous order count', profile.ordersCount),
    contextLine('Last order type', profile.lastOrderType),
    contextLine('Package status', profile.packageStatus),
    contextLine('Standing instructions', profile.standingInstructions),
    contextLine('Current situation with its recorded dates', profile.currentSituation),
    contextLine('Situation last updated', profile.situationUpdatedAt),
    contextLine('People previously mentioned', profile.people),
    mentionsBirthDetails ? contextLine('Date of birth', profile.dob || profile.dobText) : null,
    `Sales permission: ${profile.noSales ? 'Do not sell or offer anything.' : profile.relationship === 'regular' ? 'Do not cold-pitch. Recommend an offer only when this message asks for a reading or clearly raises a need the offer fits.' : 'A relevant offer may be recommended when it answers this message.'}`,
    profile.packageStatus
      ? 'Package rule: do not sell work that may already be covered. If coverage is unclear, say it will be checked.'
      : null,
  ].filter(Boolean);
  return lines.join('\n').slice(0, 16_000);
}

function githubRawUrl(repository, path, ref) {
  const [owner, repo, ...extra] = String(repository || '').split('/');
  if (!owner || !repo || extra.length) throw new Error('CLIENT_DATA_REPO must be owner/name');
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/contents/${String(path).split('/').map(encodeURIComponent).join('/')}`
  );
  url.searchParams.set('ref', ref);
  return url;
}

export class GitHubClientData {
  constructor({
    repository,
    path = 'clients.json',
    readmePath = 'README.md',
    metadataPath = 'README.txt',
    ref = 'main',
    token,
    fetchImpl = fetch,
  }) {
    this.repository = repository;
    this.path = path;
    this.readmePath = readmePath;
    this.metadataPath = metadataPath;
    this.ref = ref;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.etags = new Map();
    this.data = parseClientData([]);
    this.state = {
      configured: Boolean(repository && path && readmePath && ref && token),
      loaded: false,
      recordsLoaded: 0,
      matchableProfiles: 0,
      exactAliasesLoaded: 0,
      ambiguousAliases: 0,
      refreshHours: 3,
      lastCheckedAt: null,
      lastSuccessfulSyncAt: null,
      sourceExportedAt: null,
      readmeVerified: false,
      error: token ? null : 'CLIENT_DATA_GITHUB_TOKEN is not configured',
    };
  }

  status() {
    return { ...this.state };
  }

  matchSocial({ username = '', senderId = '' } = {}) {
    const usernameKey = normalizeClientIdentifier(username);
    const senderKey = normalizeClientIdentifier(senderId);
    return (
      (usernameKey && this.data.socialAliases.get(usernameKey)) ||
      (senderKey && this.data.socialAliases.get(senderKey)) ||
      (usernameKey && this.data.etsyAliases.get(usernameKey)) ||
      null
    );
  }

  contextFor(profile, inboundMessage = '') {
    return privateClientContext(profile, inboundMessage);
  }

  async fetchFile(path, maxBytes) {
    const headers = {
      Accept: 'application/vnd.github.raw+json',
      Authorization: `Bearer ${this.token}`,
      'User-Agent': 'aiviq-meta-comment-agent',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const etag = this.etags.get(path);
    if (etag) headers['If-None-Match'] = etag;
    const response = await this.fetchImpl(githubRawUrl(this.repository, path, this.ref), {
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 304) return { changed: false, text: null };
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status} for ${path}`);
    const text = await response.text();
    if (!text.trim() || Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new Error(`${path} is empty or too large`);
    }
    this.etags.set(path, response.headers.get('etag'));
    return { changed: true, text };
  }

  async sync() {
    const checkedAt = new Date().toISOString();
    this.state.lastCheckedAt = checkedAt;
    if (!this.state.configured) return { changed: false, status: this.status() };

    try {
      const readme = await this.fetchFile(this.readmePath, MAX_README_BYTES);
      if (readme.changed) {
        if (!/private/i.test(readme.text) || !/read[- ]only/i.test(readme.text)) {
          throw new Error('client data README does not contain the required privacy and read-only rules');
        }
        this.state.readmeVerified = true;
      } else if (!this.state.readmeVerified) {
        throw new Error('client data README has not been verified');
      }

      let sourceExportedAt = this.state.sourceExportedAt;
      const metadata = await this.fetchFile(this.metadataPath, MAX_README_BYTES);
      if (metadata.changed) {
        sourceExportedAt = /export,\s*([^.]*(?:UTC|GMT))/iu.exec(metadata.text)?.[1]?.trim() || null;
      }

      const clientFile = await this.fetchFile(this.path, MAX_CLIENT_DATA_BYTES);
      if (clientFile.changed) this.data = parseClientData(clientFile.text);
      const matchable = new Set([
        ...this.data.socialAliases.values(),
        ...this.data.etsyAliases.values(),
      ]).size;
      this.state = {
        configured: true,
        loaded: true,
        recordsLoaded: this.data.clients.length,
        matchableProfiles: matchable,
        exactAliasesLoaded: this.data.socialAliases.size + this.data.etsyAliases.size,
        ambiguousAliases: this.data.ambiguousAliases,
        refreshHours: 3,
        lastCheckedAt: checkedAt,
        lastSuccessfulSyncAt: checkedAt,
        sourceExportedAt,
        readmeVerified: true,
        error: null,
      };
      return { changed: clientFile.changed, status: this.status() };
    } catch (error) {
      this.state.error = String(error.message).slice(0, 500);
      throw error;
    }
  }
}
