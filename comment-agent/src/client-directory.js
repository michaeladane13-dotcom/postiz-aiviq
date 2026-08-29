const ALLOWED_RELATIONSHIPS = new Set(['new_follower', 'regular']);
const ALLOWED_ENGAGEMENT = new Set(['reply', 'manual_review', 'do_not_engage']);
const ALLOWED_DOCUMENT_KEYS = new Set(['version', 'updatedAt', 'matching', 'profiles']);
const ALLOWED_PROFILE_KEYS = new Set([
  'id',
  'clientLabel',
  'aliases',
  'relationship',
  'engagement',
]);

export function normalizeSocialAlias(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/^@/, '')
    .toLocaleLowerCase('en-US');
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function parseClientDirectory(input) {
  const document = typeof input === 'string' ? JSON.parse(input) : input;
  assertPlainObject(document, 'client directory');
  const unexpectedDocumentKeys = Object.keys(document)
    .filter((key) => !ALLOWED_DOCUMENT_KEYS.has(key));
  if (unexpectedDocumentKeys.length) {
    throw new Error(`client directory contains forbidden fields: ${unexpectedDocumentKeys.join(', ')}`);
  }
  if (document.version !== 1) throw new Error('client directory version must be 1');
  if (document.matching !== 'exact_normalized_alias') {
    throw new Error('client directory matching must be exact_normalized_alias');
  }
  if (!Array.isArray(document.profiles) || document.profiles.length > 500) {
    throw new Error('client directory profiles must be an array with at most 500 entries');
  }

  const aliases = new Map();
  const profiles = document.profiles.map((profile, index) => {
    assertPlainObject(profile, `profile ${index}`);
    const unexpectedKeys = Object.keys(profile).filter((key) => !ALLOWED_PROFILE_KEYS.has(key));
    if (unexpectedKeys.length) {
      throw new Error(`profile ${index} contains forbidden fields: ${unexpectedKeys.join(', ')}`);
    }

    const id = String(profile.id || '').trim();
    const clientLabel = String(profile.clientLabel || '').trim();
    const relationship = String(profile.relationship || 'regular');
    const engagement = String(profile.engagement || 'reply');
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id)) throw new Error(`profile ${index} has invalid id`);
    if (!clientLabel || clientLabel.length > 120) throw new Error(`profile ${index} has invalid clientLabel`);
    if (!ALLOWED_RELATIONSHIPS.has(relationship)) {
      throw new Error(`profile ${id} has invalid relationship`);
    }
    if (!ALLOWED_ENGAGEMENT.has(engagement)) {
      throw new Error(`profile ${id} has invalid engagement`);
    }
    if (!Array.isArray(profile.aliases) || !profile.aliases.length || profile.aliases.length > 20) {
      throw new Error(`profile ${id} must have 1 to 20 aliases`);
    }

    const normalizedAliases = profile.aliases.map(normalizeSocialAlias);
    for (const alias of normalizedAliases) {
      if (!alias || alias.length > 100) throw new Error(`profile ${id} has invalid alias`);
      if (aliases.has(alias)) throw new Error(`duplicate client alias: ${alias}`);
    }

    const safeProfile = Object.freeze({
      id,
      clientLabel,
      aliases: Object.freeze(normalizedAliases),
      relationship,
      engagement,
    });
    for (const alias of normalizedAliases) aliases.set(alias, safeProfile);
    return safeProfile;
  });

  return Object.freeze({
    version: 1,
    updatedAt: String(document.updatedAt || '').slice(0, 40),
    profiles: Object.freeze(profiles),
    aliases,
  });
}

export class GitHubClientDirectory {
  constructor({ repository, path, ref, token, fetchImpl = fetch }) {
    this.repository = repository;
    this.path = path;
    this.ref = ref;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.etag = null;
    this.directory = parseClientDirectory({
      version: 1,
      updatedAt: '',
      matching: 'exact_normalized_alias',
      profiles: [],
    });
    this.state = {
      configured: Boolean(repository && path && ref && token),
      loaded: false,
      profilesLoaded: 0,
      aliasesLoaded: 0,
      lastCheckedAt: null,
      lastSuccessfulSyncAt: null,
      sourceUpdatedAt: null,
      error: token ? null : 'CLIENT_HANDOVER_GITHUB_TOKEN is not configured',
    };
  }

  match(username) {
    return this.directory.aliases.get(normalizeSocialAlias(username)) || null;
  }

  status() {
    return { ...this.state };
  }

  async sync() {
    const checkedAt = new Date().toISOString();
    this.state.lastCheckedAt = checkedAt;
    if (!this.state.configured) return { changed: false, status: this.status() };

    const [owner, repo, ...extra] = String(this.repository).split('/');
    if (!owner || !repo || extra.length) throw new Error('CLIENT_HANDOVER_REPO must be owner/name');
    const url = new URL(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
        `/contents/${this.path.split('/').map(encodeURIComponent).join('/')}`
    );
    url.searchParams.set('ref', this.ref);
    const headers = {
      Accept: 'application/vnd.github.raw+json',
      Authorization: `Bearer ${this.token}`,
      'User-Agent': 'aiviq-meta-comment-agent',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.etag) headers['If-None-Match'] = this.etag;

    try {
      const response = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (response.status === 304) {
        this.state.lastSuccessfulSyncAt = checkedAt;
        this.state.error = null;
        return { changed: false, status: this.status() };
      }
      if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > 250_000) throw new Error('client directory is too large');

      const directory = parseClientDirectory(raw);
      this.directory = directory;
      this.etag = response.headers.get('etag');
      this.state = {
        configured: true,
        loaded: true,
        profilesLoaded: directory.profiles.length,
        aliasesLoaded: directory.aliases.size,
        lastCheckedAt: checkedAt,
        lastSuccessfulSyncAt: checkedAt,
        sourceUpdatedAt: directory.updatedAt || null,
        error: null,
      };
      return { changed: true, status: this.status() };
    } catch (error) {
      this.state.error = String(error.message).slice(0, 500);
      throw error;
    }
  }
}
