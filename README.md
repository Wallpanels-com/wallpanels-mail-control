# WallPanels Mail Control

Google Apps Script backend for Gmail response monitoring, Groq classification and Telegram reminders. Uses the existing Workspace service account with Domain-Wide Delegation and IAM `signJwt`; no service-account JSON key or additional hosting.

## Current rollout

The initial rollout is **test mode**. All notifications are routed to the configured test administrator. Production requires separate owner approval and the `WP_PRODUCTION_APPROVED=yes` Script Property, in addition to `Settings → MODE=production`. Never set these as part of a routine deployment.

An explicitly activated temporary 24/7 test campaign can scope synchronization to the approved test mailbox and client. It maintains its own durable activation time and sends distinct Employee/Admin cards to the same test administrator. This deliberate two-card exception never changes production deduplication or the production calendar. See operations for `/testoff`.

Runtime settings and staff details live in private Script Properties (`WP_CONFIG_JSON`) and the existing Google Sheet. `TELEGRAM_BOT_TOKEN` and `GROQ_API_KEY` remain in Script Properties. No employee roster, tokens or mail content belongs in this repository.

An explicitly approved optional `testEmployee` can combine the test-admin and mailbox-owner roles. Its mailbox is an additional allowlisted address, and recipient IDs are deduplicated across roles. All other administrator mailboxes remain excluded.

## Behaviour

- One synchronization cursor per distinct mailbox; shared mailbox owners receive separate employee notifications and admins receive one each.
- Each inbound Gmail message has its own durable expectation. Reading mail and drafting replies do not close it. A sent reply after that message closes it; later incoming messages are independent.
- Work schedule: weekdays, 09:00–19:00 America/New_York, including DST. Stages: 30, 60 and 120 business minutes. Monitoring every five minutes introduces scheduling latency. After downtime, one new overdue stage is queued per run.
- Groq `openai/gpt-oss-20b` classifies a bounded context once per incoming message. Failed analyses retry with backoff. Unclassified messages stay awaiting human review and retain reminders.
- Callback actions require an authorized private Telegram chat and proof of a matching delivered notification. Callback IDs and polling offsets are persisted.
- A script lock serializes monitoring, callback handling and database writes. Remote delivery is reserved before sending. An interrupted or ambiguous Telegram send becomes `unknown` and is not blindly retried, because Telegram has no send-message idempotency key.
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

For a fresh maintenance checkout, download the current project into `.local/remote-original` and review differences first. The helper recognizes this project's seven `Wp` modules so they can be updated; unknown name collisions fail instead of overwriting another file. Keep the original snapshot available for recovery.

Do not use `clasp create`, publish a public web app, or change cloud projects. Time-driven triggers execute Apps Script HEAD, so a separate public web deployment is unnecessary. Keep a version snapshot and verify downloaded source against the Git commit after each update.

## Security and limits

Gmail uses `gmail.readonly`; no code sends or modifies email. Full email text is transient for AI analysis and is not stored in Sheets. Errors contain sanitized codes and internal references only. Sheets cells escape formula prefixes. Limit spreadsheet and script editor access to authorized administrators: project editors can access Script Properties.

The classifier sends a bounded excerpt to Groq as required by the project; attachments and remote HTML are excluded. Quotas and polling mean this is not a hard real-time system. Monitor `Errors`, delivery states, cursor freshness and trigger execution history. A mail removed from Gmail is marked unavailable rather than treated as replied.
