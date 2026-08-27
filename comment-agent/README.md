# Meta comment agent

Account-locked moderation and shadow-mode persona reply drafting for the approved
Chaya, Ren and David Facebook/Instagram integrations.

## Safety behaviour

- Persona is selected only from the Postiz integration ID and matching Meta account ID.
- Explicit AI-accusation comments are deleted immediately. If Meta rejects deletion,
  the agent attempts to hide the comment and records the deletion error.
- Questions and ambiguous mentions of AI are held for review.
- Replies are drafts only; this service has no endpoint that publishes a reply.
- Relationship memory is isolated by integration ID and exact Meta user ID. A regular
  or friend-like voice is used only for a confirmed contact on that persona's account.
- All received decisions and moderation results are logged in Postgres.

## Required environment

- `DATABASE_URL`
- `FACEBOOK_APP_SECRET`
- `META_VERIFY_TOKEN`
- `COMMENT_AGENT_ADMIN_TOKEN`
- `META_GRAPH_VERSION` (optional; defaults to `v25.0`)
- `OPENAI_API_KEY` (optional; without it, moderation runs but drafts are marked blocked)
- `OPENAI_MODEL` (optional; defaults to `gpt-5-mini`)

The Meta callback URL is `https://<service-domain>/webhooks/meta`.

Confirmed relationship profiles can be listed or updated through the protected
`/admin/contacts` endpoint. The server always derives the persona from the fixed
integration route; callers cannot assign a contact to a different persona.
