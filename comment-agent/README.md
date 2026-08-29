# Meta comment agent

Account-locked moderation and shadow-mode persona reply drafting for the approved
Chaya, Ren and David Facebook/Instagram integrations.

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
- The agent reads only `social-public-profiles.json`. It never reads the handover
  repository's confidential README or sends client labels/private context into reply
  generation.
- Each approved Facebook Page and Instagram professional account is installed on the
  app automatically and retried every ten minutes if Meta reports a missing permission.
- All received decisions and moderation results are logged in Postgres.

## Required environment

- `DATABASE_URL`
- `FACEBOOK_APP_SECRET`
- `META_VERIFY_TOKEN`
- `COMMENT_AGENT_ADMIN_TOKEN`
- `META_GRAPH_VERSION` (optional; defaults to `v25.0`)
- `OPENAI_API_KEY` (optional; without it, moderation runs but drafts are marked blocked)
- `OPENAI_MODEL` (optional; defaults to `gpt-5-mini`)
- `REPLY_MODE` (optional; `shadow` by default, or `limited_live` for curated replies)
- `CLIENT_HANDOVER_GITHUB_TOKEN` (fine-grained, read-only contents access to the
  private `chaya-client-handover` repository)
- `CLIENT_HANDOVER_REPO` (optional; defaults to
  `michaeladane13-dotcom/chaya-client-handover`)
- `CLIENT_HANDOVER_PATH` (optional; defaults to `social-public-profiles.json`)
- `CLIENT_HANDOVER_REF` (optional; defaults to `main`)

The Meta callback URL is `https://<service-domain>/webhooks/meta`.

Confirmed relationship profiles can be listed or updated through the protected
`/admin/contacts` endpoint. The server always derives the persona from the fixed
integration route; callers cannot assign a contact to a different persona.
