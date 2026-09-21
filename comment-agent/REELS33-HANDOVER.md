# Chaya REELS33 comment handover

Five Chaya reels are scheduled on both her Facebook Page and Instagram account,
one per day at 4:00 PM America/Vancouver, September 21–25, 2026:

1. What happens after you book: explain only the written-reading process stated in the caption. Do not disclose client messages or promise outcomes.
2. The yes or no mistake: an exact `QUESTION` comment receives a **public** reply with three sample open-ended questions. No DM is sent; the agent has no DM workflow.
3. Everyone apologises first: welcome people without asking them to put private details in a public comment.
4. The first thing I was taught: acknowledge kind comments; do not invent family history or biographical details beyond the reel.
5. One question: hold submitted questions for Chaya to choose. Never select a winner or perform a reading automatically.

The live reply path is limited to Chaya's two immutable Meta integration IDs and
to a caption beginning with the matching opening and containing `REELS33`.
Simple booking/link/code questions get the approved public answer: book through
the link in Chaya's bio and enter `REELS33` at checkout. Do not state a discount
amount, expiry date, eligibility rule, or price that has not been supplied.

Code failures, payments/refunds, complaints, sensitive personal situations,
individual predictions, and the reel-five question selection are recorded as
`needs_review_*` events in `/admin/events`. Those require a person to respond.
Existing low-risk positive-comment templates remain active. Existing explicit
AI-reference moderation remains active on both accounts.

The bot's `limited_live` mode does not generate bespoke AI replies. When the
Meta post caption cannot be fetched, campaign-specific replies are disabled:
it must not infer the reel from the comment alone. If a user expected the
promised question list in a private message, a human must follow up because
this handover sends the three starter questions publicly only.
