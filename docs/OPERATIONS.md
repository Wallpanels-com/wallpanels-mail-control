# Operations

## Setup and verification

1. Authorize the existing project owner through official clasp. Keep OAuth tokens outside Git.
2. Download and privately back up the existing script and manifest. Review any existing triggers or webhook before replacement; setup refuses an active webhook.
3. Supply the approved private `WP_CONFIG_JSON` roster. Keep existing bot and Groq Script Properties unchanged. Never log property values.
4. Run `wpSetup` (or first-run private `wpBootstrap`). Existing tabs with an incompatible schema cause an error rather than being overwritten. The original six-column Employees schema supports one append-only `role` migration. Empty or missing required tabs are initialized with headers, filters and frozen rows.
5. Run `wpHealth`: tests read-only access to all configured mailboxes, bot identity, webhook state and a synthetic Groq customer request. Detailed private results are stored as `Sync_State/health`.
6. Run `wpMonitor` once to establish initial history baselines, with no historic backlog. The approved optional test-admin mailbox receives its own independent baseline.
7. In test mode run `wpSyntheticTest`. This creates a synthetic expectation and sends a single interactive message only to the test admin. Check Send Reminder before No Reply Needed, then confirm the closure record and callback receipt in Sheets.
8. Run `wpInstallTriggers` after health succeeds. Confirm `wpMonitor` every five minutes and `wpTelegramUpdates` every minute in project Triggers and Executions. Existing unrelated triggers are preserved.
9. Before any production rollout, complete agreed live-message checks and obtain separate owner authorization. Until then, leave `MODE=test` and omit `WP_PRODUCTION_APPROVED`.

## Telegram actions

Open Gmail selects the mailbox using `authuser` and opens the thread. Employees can close one incoming message with No Reply Needed. Both owners of a shared mailbox can act on its expectations. Admin messages link to each owner separately and offer Send Reminder; delivery rechecks Gmail before notifying owners. In test mode every route is redirected to the test administrator.

In test mode only, the approved test admin can send `/preview` in the private bot chat. It previews the newest live waiting message in that admin's explicitly approved test mailbox, once per message. This lets the owner check real Gmail links and buttons outside the work window without changing or marking the 30/60/120-minute SLA stages. Other staff mailboxes cannot be previewed with this command.

## Temporary 24/7 test campaign

A private, single-use activation request identifies one exact pre-existing Gmail message. It is deployed briefly as `TestRequest.js` and removed after acknowledgement. The existing minute polling trigger activates it and continues checking the test mailbox every minute; no additional trigger or OAuth grant is needed.

`Sync_State/test247` stores the immutable activation epoch, selected message, allowed client, scope and status. Only that message is imported retrospectively. Subsequent incoming messages from that client after activation get independent cycles. Other mailbox synchronization is suspended during the active campaign. Gmail is read-only throughout.

Initial Employee and Admin cards are sent separately, followed by separate cards at cumulative 30, 60 and 120 elapsed minutes. Role and campaign identifiers are part of each durable delivery key. Re-executions cannot reset the epoch or create duplicate reservations. Each send rechecks Gmail for a real reply. The selected historical message retains its original received time; the test timer uses the separate activation epoch. Future messages start at their own receipt time.

Read observations and reply checks are recorded under `testEvidence:<email-row-id>`; deliveries and closure outcomes remain in Reminders and Emails. The owner must actually open Gmail, close an expectation or send a reply to validate those live interactions. A simulated clock test does not prove future real-time deliveries.

Send `/testoff` to the bot as the test administrator to disable the 24/7 clock, cancel its pending deliveries and restore the standard calendar. This does **not** enable production or employee notifications. The campaign epoch and delivery audit are retained. Keep the selected letter unanswered and do not press No Reply Needed until after the last stage if you want to observe all three intervals; use a subsequent incoming message to verify closure separately.

An explicit owner request may restore a test expectation closed with No Reply Needed. The one-off private `TestResume.js` request is applied only after Telegram polling has processed pending callbacks. It checks the exact campaign and original epoch, rechecks Gmail for a reply, archives previous closure fields under `testResume:<operation-id>` and reopens that single row. Already sent deliveries and callback receipts are retained. Fresh Employee/Admin cards use a separate `resume` stage without consuming or resetting 30/60/120-minute stages. The private request is removed after acknowledgement; retries cannot reopen the row again.

Bots cannot start private chats with users who have not pressed Start. Before a future approved production rollout, each employee and administrator must start the bot. A permanent Telegram rejection is recorded in `Reminders` and `Errors`; do not treat a successful test-admin delivery as proof of other recipients' availability.

## Pause and resume

Set `Settings/MODE` to `paused` to stop synchronization and Telegram delivery without deleting triggers. Set it back to `test` to resume administrator-only operation. Changes to `Employees` are an operational reference; the approved allowlist and routing are sourced from `WP_CONFIG_JSON`. Do not widen the allowlist by editing rows alone.

## Failure recovery

- Review recent `Errors` and trigger executions. No raw API error body is stored, to avoid token/content leaks.
- `pending` AI analyses retry with exponential backoff, capped at one hour. Up to three Groq calls are attempted per monitoring run.
- `Reminders/unknown` needs manual review of Telegram chat history; do not change it to pending until non-delivery is established. `failed` usually needs the user to press Start or restore chat permissions.
- Re-running setup or a synchronization page is safe. Never clear `Sync_State` to fix a temporary API error: doing so resets the baseline and can skip mail.
- Refresh expired OAuth credentials using the same corporate account. DWD is not an employee OAuth flow and uses no downloaded service-account key.

## Updating

Run tests, inspect the diff, prepare a private upload stage, push only to the approved existing script, and run `deploy.cjs verify`. A normal update does not call setup, reset cursors, change mode or send tests. Save a `clasp version` snapshot linked to the Git commit. Time-driven triggers execute HEAD; source verification is therefore the deployment verification for polling operation.

## Test evidence

Local unit tests cover timing, DST, routing, inbound identity, reply/draft/read semantics, callback authorization/replay, per-message closure and initial baselines. Mocks prove logic, not live API availability. Record live API results separately in the deployment report. Do not report employee or second-admin delivery until explicitly approved and observed.
