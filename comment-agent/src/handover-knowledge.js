function normalizeHeading(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function extractClientSection(markdown, clientLabel) {
  const label = normalizeHeading(clientLabel);
  if (!label || label === 'identity unresolved') return '';

  const lines = String(markdown || '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^##\s+(.+?)\s*$/.exec(lines[index]);
    if (!match) continue;
    const heading = normalizeHeading(match[1]);
    if (!(heading === label || heading.startsWith(`${label} `))) continue;

    let end = index + 1;
    while (end < lines.length && !/^#{1,2}\s+/.test(lines[end])) end += 1;
    return lines.slice(index, end).join('\n').trim().slice(0, 8_000);
  }
  return '';
}

export class GitHubHandoverKnowledge {
  constructor({ repository, path = 'README.md', ref, token, fetchImpl = fetch }) {
    this.repository = repository;
    this.path = path;
    this.ref = ref;
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.etag = null;
    this.markdown = '';
    this.state = {
      configured: Boolean(repository && path && ref && token),
      loaded: false,
      bytesLoaded: 0,
      lastCheckedAt: null,
      lastSuccessfulSyncAt: null,
      sourceUpdatedAt: null,
      error: token ? null : 'CLIENT_HANDOVER_GITHUB_TOKEN is not configured',
    };
  }

  contextFor(profile) {
    if (!profile || profile.engagement === 'do_not_engage') return '';
    if (String(profile.id || '').includes('unresolved')) return '';
    return extractClientSection(this.markdown, profile.clientLabel);
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
      const markdown = await response.text();
      const size = Buffer.byteLength(markdown, 'utf8');
      if (!markdown.trim() || size > 500_000) throw new Error('handover knowledge file is empty or too large');

      this.markdown = markdown;
      this.etag = response.headers.get('etag');
      const updatedAt = /Last updated\s+(\d{4}-\d{2}-\d{2})/i.exec(markdown)?.[1] || null;
      this.state = {
        configured: true,
        loaded: true,
        bytesLoaded: size,
        lastCheckedAt: checkedAt,
        lastSuccessfulSyncAt: checkedAt,
        sourceUpdatedAt: updatedAt,
        error: null,
      };
      return { changed: true, status: this.status() };
    } catch (error) {
      this.state.error = String(error.message).slice(0, 500);
      throw error;
    }
  }
}
