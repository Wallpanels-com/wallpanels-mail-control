# WallPanels Mail Control

Google Apps Script backend for Gmail response monitoring, Groq classification and Telegram reminders. Uses the existing Workspace service account with Domain-Wide Delegation and IAM `signJwt`; no service-account JSON key or additional hosting.

## Current rollout

Owner-authorized **production** has been active since 24 October 2026. Employees receive only their owned mailboxes; both administrators receive all connected mailboxes. Each approved Telegram account must press Start before its deliveries proceed. Production requires `WP_PRODUCTION_APPROVED=yes` and `Settings → MODE=production`; a routine deployment never changes either setting.

An explicitly activated temporary 24/7 test campaign can scope synchronization to the approved test mailbox and client. It maintains its own durable activation time and sends distinct Employee/Admin cards to the same test administrator. This deliberate two-card exception never changes production deduplication or the production calendar. See operations for `/testoff`.

Runtime settings and staff details live in private Script Properties (`WP_CONFIG_JSON`) and the existing Google Sheet. `TELEGRAM_BOT_TOKEN` and `GROQ_API_KEY` remain in Script Properties. No employee roster, tokens or mail content belongs in this repository.

The explicitly approved optional `testEmployee` is retained in production with role `admin_employee`. Its mailbox is an additional allowlisted address, and recipient IDs are deduplicated across roles. All other administrator mailboxes remain excluded.

## Behaviour

- One synchronization cursor per distinct mailbox; shared mailbox owners receive separate employee notifications and admins receive one each.
- Each inbound Gmail message has its own durable expectation. Reading mail and drafting replies do not close it. A sent reply after that message closes it; later incoming messages are independent.
- Work schedule: weekdays, 09:00–19:00 America/New_York, including DST. Default stages: 30, 60 and 120 business minutes; the approved shared-mailbox override is 5, 10 and 15. Its durable activation cutoff applies only to new incoming mail; existing expectations retain their saved stages. Production monitoring runs every minute during work hours (with trigger/execution latency), and catches up through unchanged Gmail history cursors next work window. After downtime, one new overdue stage is queued per run.
- Groq `openai/gpt-oss-20b` classifies only the current incoming message, once, without the thread history. The complete request is capped at 4,500 UTF-8 bytes and completion at 600 tokens. Failed analyses retry with backoff. Unclassified or conservatively shortened messages retain human-review reminders.
- Reviewed `WP_CONFIG_JSON.mailExclusions` match an exact sender **and** an anchored subject template across monitored mailboxes; optional `mailbox` and `messageId` narrow a rule to one reviewed incoming without blocking future replies. CRM assignments, authentication codes, confirmed unsolicited campaigns and completed-payment receipts can be excluded before Groq. Existing pending/Start-held reminders are cancelled, not deleted; sent receipts and a reversible `Sync_State/mailFilter:<emailId>` audit remain. An `info@`/`noreply@` address alone is never grounds for exclusion. Client document-access requests, payment problems, quotes, complaints and project actions remain eligible.
- Provider-generated lead/call assignments additionally require a recognized transport address **and** the literal assignment subject template, so campaign/sending-domain variants do not leak into reminders. A truncated email remains protected unless AI says no reply is needed, classifies it as non-customer marketing, **and** native mailing-list headers corroborate that classification. Sender name, a no-reply address or Gmail category alone never suppress a client request. Only a boolean mailing-list signal reaches AI; unsubscribe URLs and list identifiers do not. Final AI decisions are auditable in `Sync_State/aiDecision:<emailId>`.
- Roster expansion uses explicit `employeeCount` and `employeeMailboxCount` guards. New owners begin at a fresh Gmail history baseline, without importing old inbox mail. Start is still required for their Telegram deliveries.
- An employee may own one primary `email` plus explicitly allowed `additionalMailboxes`. Each private Telegram ID remains unique. Membership activation timestamps prevent old shared-mailbox expectations from being replayed to newly added recipients. Both administrators still receive every mailbox once. A sent reply from the monitored Gmail closes the incoming for everyone. In production `pm@wallpanels.com`, No Reply Needed suppresses only the clicking owner's reminders for that incoming; other owners and administrators remain subscribed. Other mailboxes retain global button closure.
- PM dismissals are durable per incoming/recipient, cancel only that recipient's unsent jobs and apply to scheduled stages, manual Send Reminder and jobs released by Start. A new incoming, including in the same thread, has no inherited dismissals. Existing globally closed mail is not reopened during rollout.
- Callback actions require an authorized private Telegram chat and proof of a matching delivered notification. Callback IDs and polling offsets are persisted.
- A script lock serializes monitoring, callback handling and database writes. Remote delivery is reserved before sending. An interrupted or ambiguous Telegram send becomes `unknown` and is not blindly retried, because Telegram has no send-message idempotency key.
- Monitoring and dispatch reconcile pending/Start-held jobs with current expectation status. Closed or missing expectations retire those jobs with a durable `closedOutbox:<jobId>` audit; sent and ambiguous receipts remain intact.
- On initial setup, current Gmail history IDs establish the baseline. Older mail is not imported. Expired history is recovered using a paginated scan bounded by that original baseline.

## Local development

Node.js 20+:

```sh
npm ci --ignore-scripts
npm test
npm run check
```

`src/` contains Apps Script V8 code; pure logic also executes in Node. `tests/` uses synthetic addresses and messages only. See [operations](docs/OPERATIONS.md) and [architecture](docs/ARCHITECTURE.md).

## Existing-project deployment

`clasp login` requires the corporate project owner and Apps Script API enabled in that account. Local `.clasp.json`, downloaded originals, OAuth credentials and the bootstrap roster are ignored by Git.

Before the first update, download the existing project into `.local/remote-original`. Do not create a new Apps Script project. Review its source, scopes, triggers and existing deployments before changing it.

```sh
# A private .clasp.json must already point to the approved existing script.
node scripts/deploy.cjs prepare
npm test
npm run check
node scripts/deploy.cjs push
node scripts/deploy.cjs verify
```

On first initialization only, `prepare --bootstrap` includes the private `.local/Bootstrap.js`; run `wpBootstrap` once in the editor, then prepare and push without that flag to remove bootstrap code from Apps Script HEAD. This never prints the saved API keys. The original downloaded files are preserved in the upload. The manifest retains the IAM, external-request and Sheets scopes and adds trigger-management permission.

For a fresh maintenance checkout, download the current project into `.local/remote-original` and review differences first. The helper recognizes this project's eight `Wp` modules so they can be updated; unknown name collisions fail instead of overwriting another file. Keep the original snapshot available for recovery.

Do not use `clasp create`, publish a public web app, or change cloud projects. Time-driven triggers execute Apps Script HEAD, so a separate public web deployment is unnecessary. Keep a version snapshot and verify downloaded source against the Git commit after each update.

## Security and limits

Gmail uses `gmail.readonly`; no code sends or modifies email. Full email text is transient for AI analysis and is not stored in Sheets. Errors contain sanitized codes and internal references only. Sheets cells escape formula prefixes. Limit spreadsheet and script editor access to authorized administrators: project editors can access Script Properties.

The classifier sends a bounded excerpt to Groq as required by the project; attachments and remote HTML are excluded. Quotas and polling mean this is not a hard real-time system. Monitor `Errors`, delivery states, cursor freshness and trigger execution history. A mail removed from Gmail is marked unavailable rather than treated as replied.
