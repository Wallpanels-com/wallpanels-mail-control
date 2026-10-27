# Architecture

`Core.js` provides deterministic business-time calculation, routing, reply detection, AI validation and Gmail links. `Api.js` implements keyless delegated Gmail access, bounded Groq calls and the Telegram API. `Store.js` owns named sheet schemas and sequential writes. `App.js` coordinates synchronization, expectation state, delivery reservations, callbacks and trigger setup.

`TestCampaign.js` isolates the approved elapsed-time test from the production calendar. `Messages.js` renders bounded, escaped Telegram HTML. `Audit.js` reconciles operational evidence without exposing mail text, addresses or recipient IDs; a one-time acceptance operation stores its report in Sync_State without changing monitoring or delivery state.

## Persistence

| Sheet | Purpose |
| --- | --- |
| Employees | Configured mailbox owners; shared email occurs twice with distinct owners |
| Emails | One mailbox/message key, metadata, AI result and closure audit |
| Reminders | One expectation/stage/recipient/mode reservation and delivery outcome |
| Sync_State | Per-mailbox cursor/baseline, callback receipts, offset and health |
| Settings | Mode and documented operating schedule |
| Errors | Sanitized failure codes, timestamp and reference |

Each incoming message transitions from `awaiting` to `replied`, `no_reply_needed`, `not_required` or `unavailable`. Closure does not disable the thread. `aiStatus=pending` is independent of response status, so a Groq outage never hides a waiting message.

History pages are checkpointed only after their threads are processed. Replaying a page is safe because mailbox/message keys are unique under the script lock. On expired history, the current history snapshot is captured before a paginated overlap scan; subsequent history synchronization covers changes during the scan. The initial baseline remains the lower bound throughout recovery.

## Delivery semantics

Notifications follow `pending → sending → sent`. Explicit rate limits return to `pending` with backoff. Permanent rejection is `failed`; network ambiguity, server failure or a stale `sending` reservation becomes `unknown`. These states are visible for operator review. Exactly-once delivery cannot be guaranteed across a crash between an external API action and a Sheets write. The default favours avoiding duplicate messages; it does not claim guaranteed delivery for ambiguous sends.

Callback mutations are durable before acknowledgement. A repeated No Reply Needed callback cannot reopen or close another message. Manual reminders have callback-specific delivery keys and a five-minute cooldown. Expired callback acknowledgements are ignored to keep the update offset moving. Telegram offsets advance only after successful handling of that update.

Production PM mail has separate per-recipient dismissal state in Sync_State, keyed by expectation ID and Telegram ID. Its No Reply Needed callback leaves the shared Emails status untouched and cancels only the clicking owner's unsent reservations. Both queue creation and dispatch consult that durable state, so retries, manual reminders and Start cannot bypass it. Shared-Gmail SENT reply detection still closes the expectation globally. Each new incoming has a new expectation ID; it does not inherit earlier dismissals. Other mailboxes and test mode keep the global button semantics.

## Existing infrastructure boundary

The deployment helper refuses a script ID other than the explicitly approved existing project. Existing source files are retained and backed up privately. No cloud provisioning, new database or mailbox access outside the configured allowlist is used. Production is gated by a separate Script Property and operating mode; test routing always resolves to one administrator.
