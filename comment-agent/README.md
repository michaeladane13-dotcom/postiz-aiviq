# Meta comment agent

Account-locked moderation and shadow-mode persona reply drafting for the approved
Chaya, Ren, Nadja and David Facebook/Instagram integrations.

## Safety behaviour

- Persona is selected only from the Postiz integration ID and matching Meta account ID.
- Explicit AI-accusation comments are deleted immediately. If Meta rejects deletion,
  the agent attempts to hide the comment and records the deletion error.
- Questions and ambiguous mentions of AI are held for review.
- In `limited_live` mode, only unmistakably positive, low-risk comments receive
  a short curated persona reply. Questions, complaints, links, sensitive topics
  and ambiguous comments remain drafts or review items.
- Relationship memory is isolated by integration ID and exact Meta user ID. Three
  clearly positive interactions can establish a returning regular; friend-like voice
  is used only for a manually confirmed contact on that persona's account.
- A private, public-safe client directory is refreshed from GitHub at startup and
  every eight hours. Social aliases are matched exactly after case-folding, trimming
  and removing one leading `@`; fuzzy matching is intentionally forbidden.
- Public replies use only `social-public-profiles.json` and never receive the
  handover repository's confidential README.
- The inbox responder refreshes the confidential handover README every eight hours.
  It can use only the section belonging to an exact matched Chaya identity, only in
  a private DM, and only as background for tone and continuity. Unresolved identities,
  public replies, and the Ren, Nadja and David inboxes never receive that context.
- A separate public-safe brand knowledge file is refreshed from GitHub at startup
  and every eight hours. It contains exactly Chaya, Ren, Nadja and David, plus safe
  operating facts sourced from Chaya Ops. The agent then refreshes an allowlisted
  set of pages on each brand's official website and extracts only page metadata and
  structured product or service facts. It never places raw webpage body text in a
  model prompt.
- Brand knowledge is account-isolated. A reply on one persona's integration cannot
  receive another persona's facts, links, services or offers. Prices are stripped
  from public-comment context. Inbox replies may use a price only when the latest
  official structured website data explicitly contains it.
- Inbox handling is locked to the exact Chaya Facebook and Instagram, Ren Facebook
  and Instagram, Nadja Facebook and Instagram, and David Facebook integrations.
- The comment sales flow uses that same seven-integration allowlist. A new follower
  who comments `READ`, `READY`, `YES`, `ME`, or asks about a reading receives a
  price-free public acknowledgement and one private, brand-specific offer. Known
  regulars continue through the normal relationship-aware reply path.
- Safe greeting, gratitude and reading-inquiry templates can run without a model.
  Any other ordinary inbox message needs the configured model. Technology-identity
  questions, distress, medical/legal/financial subjects, orders and disputes go to
  review without an automatic reply.
- Each approved Facebook Page and Instagram professional account is installed on the
  app automatically and retried every ten minutes if Meta reports a missing permission.
- All received decisions and moderation results are logged in Postgres.
- Buffer TikTok channel validation uses one combined GraphQL request, caches the
  result for 24 hours, and honors Buffer's `Retry-After` header without repeatedly
  consuming the API quota. Post creation is never automatically retried because
  Buffer does not provide an idempotency key for that write.

## Required environment

- `DATABASE_URL`
- `FACEBOOK_APP_SECRET`
- `META_VERIFY_TOKEN`
- `COMMENT_AGENT_ADMIN_TOKEN`
- `META_GRAPH_VERSION` (optional; defaults to `v25.0`)
- `OPENAI_API_KEY` (optional; without it, moderation runs but drafts are marked blocked)
- `OPENAI_MODEL` (optional; defaults to `gpt-5-mini`)
- `REPLY_MODE` (optional; `shadow` by default, or `limited_live` for curated replies)
- `CHAYA_SALES_PRIVATE_REPLIES_ENABLED` (optional; must be exactly `true` to enable
  the approved comment-to-private-message sales flow when the newer flag is absent)
- `SALES_PRIVATE_REPLIES_ENABLED` (optional; when present, must be exactly `true`
  to enable the approved Chaya, Ren, Nadja and David sales flow)
- `META_INBOX_RESPONDER_ENABLED` (optional; must be exactly `true` to enable the
  exact-account inbox responder)
- `PRIVATE_REPLY_PER_MINUTE` (optional; conservative default `10` per integration)
- `PRIVATE_REPLY_PER_DAY` (optional; conservative default `200` per integration)
- `INBOX_REPLY_PER_MINUTE` (optional; conservative default `20` per integration)
- `INBOX_REPLY_PER_DAY` (optional; conservative default `500` per integration)
- `SALES_REPORT_TIME_ZONE` (optional; defaults to `America/Vancouver`)
- `CLIENT_HANDOVER_GITHUB_TOKEN` (fine-grained, read-only contents access to the
  private `chaya-client-handover` repository)
- `CLIENT_HANDOVER_REPO` (optional; defaults to
  `michaeladane13-dotcom/chaya-client-handover`)
- `CLIENT_HANDOVER_PATH` (optional; defaults to `social-public-profiles.json`)
- `CLIENT_HANDOVER_KNOWLEDGE_PATH` (optional; defaults to `README.md`)
- `CLIENT_BRAND_KNOWLEDGE_PATH` (optional; defaults to
  `social-brand-knowledge.json`)
- `CLIENT_HANDOVER_REF` (optional; defaults to `main`)

The Meta callback URL is `https://<service-domain>/webhooks/meta`.

Confirmed relationship profiles can be listed or updated through the protected
`/admin/contacts` endpoint. The server always derives the persona from the fixed
integration route; callers cannot assign a contact to a different persona.

The five Chaya `REELS33` promotion-specific comment rules and human-review
boundaries are documented in [REELS33-HANDOVER.md](REELS33-HANDOVER.md).

The protected `/admin/private-replies`, `/admin/messaging-opt-ins`, and
`/admin/daily-sales-report` endpoints provide delivery logs, opt-in records, and
daily aggregate reporting. A typed `YES` is recorded locally, but it is not treated
as a Meta Marketing Messages token. This service does not send outside the standard
24-hour window unless Meta has supplied its own opt-in token, and outside-window
sends remain disabled.

The protected `/admin/inbox-replies` endpoint records every automatic inbox decision,
reply, Meta message id and failure. Inbox replies are never sent outside Meta's
standard 24-hour window.
