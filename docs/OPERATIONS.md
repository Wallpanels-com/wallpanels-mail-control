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

## Production onboarding and cutover

The owner explicitly authorized production on 24 October 2026, retaining the former test owner's Gmail permanently. The two approved administrators receive all mailbox notices; an employee receives only owned mailboxes, including both configured owners of the shared PM inbox. The owner-administrator receives one combined card for owned mail, not the two test-only role cards.

The one-off `ProductionRequest.js` is staged with `prepare --production` and removed after a confirmed receipt. It runs fresh health checks and requires exactly the two expected triggers. `productionRollout:<operation>` preserves prior cursors, campaign and the cutover instant. New cursors are captured before a shared new baseline, existing waiting test/pre-cutover rows are archived without deleting history, pending test jobs are cancelled, the 24/7 flag is cleared and the optional owner role becomes `admin_employee`. MODE becomes production only after preparation; the immutable cutoff prevents old inbox/test notifications. Retries retain that cutoff and recover partial writes.

Do not reset production cursors to repeat onboarding. Monitoring begins with new mail from cutover, not a bulk historic import. Weekends do not consume the 30/60/120-business-minute SLA; production remains Mon–Fri 09:00–19:00 America/New_York.

An allowlisted user must press Start in a private bot chat. The signed update marks `telegramReady:<id>` active and confirms owned mail or administrator scope; unknown IDs get no mailbox information. The previously delivered test-owner chat is seeded from its delivery audit. Other recipients wait for their own Start, so a working administrator route does not depend on every employee being ready. Missing/unavailable chats retain jobs as `waiting_start`; a Telegram 403 disables that recipient until another Start, while ambiguous sends remain `unknown` and are never automatically repeated. Start releases only that recipient's latest held SLA stage per letter; earlier unsent stages are `superseded`, preventing a burst of obsolete reminders. Closed/replied mail is rechecked before dispatch. Readiness is not proof of real delivery until a send succeeds.

## Telegram actions

Open Gmail selects the mailbox using `authuser` and opens the thread. Employees can close one incoming message with No Reply Needed. Both owners of a shared mailbox can act on its expectations. Admin messages link to each owner separately and offer Send Reminder; delivery rechecks Gmail before notifying owners. In test mode every route is redirected to the test administrator.

Send Reminder creates one additional employee notification without resetting or consuming SLA stages. The same letter has a five-minute request cooldown. Acknowledgements distinguish queued requests, cooldown and replay; successful delivery is recorded only after Telegram confirms it.

In test mode only, the approved test admin can send `/preview` in the private bot chat. It previews the newest live waiting message in that admin's explicitly approved test mailbox, once per message. This lets the owner check real Gmail links and buttons outside the work window without changing or marking the 30/60/120-minute SLA stages. Other staff mailboxes cannot be previewed with this command.

Notification cards use Telegram HTML with bold labels, emoji landmarks and blank lines separating ownership, sender/subject, timing and AI analysis. Untrusted mail and model values are length-bounded before HTML escaping; final markup is never sliced. Employee and Admin cards retain their separate button sets.

The owner-authorized `cards-v1` refresh takes a one-time snapshot of already-sent cards in the active test campaign and edits them in place, only in the approved test administrator's chat. Results are retained in `Sync_State/messageFormat:<version>:<campaign>`. It preserves original send-time waiting values, buttons, delivery records, closure state and activation epoch. Failed edits never trigger a replacement send. The refresh does not run in production; newly sent cards already use the current formatter.

## Temporary 24/7 test campaign

A private, single-use activation request identifies one exact pre-existing Gmail message. It is deployed briefly as `TestRequest.js` and removed after acknowledgement. The existing minute polling trigger activates it and continues checking the test mailbox every minute; no additional trigger or OAuth grant is needed.

`Sync_State/test247` stores the immutable activation epoch, selected message, allowed client, scope and status. Only that message is imported retrospectively. Subsequent incoming messages from that client after activation get independent cycles. Other mailbox synchronization is suspended during the active campaign. Gmail is read-only throughout.

Initial Employee and Admin cards are sent separately, followed by separate cards at cumulative 30, 60 and 120 elapsed minutes. Role and campaign identifiers are part of each durable delivery key. Re-executions cannot reset the epoch or create duplicate reservations. Each send rechecks Gmail for a real reply. The selected historical message retains its original received time; the test timer uses the separate activation epoch. Future messages start at their own receipt time.

Read observations and reply checks are recorded under `testEvidence:<email-row-id>`; deliveries and closure outcomes remain in Reminders and Emails. The owner must actually open Gmail, close an expectation or send a reply to validate those live interactions. A simulated clock test does not prove future real-time deliveries.

Send `/testoff` to the bot as the test administrator to disable the 24/7 clock, cancel its pending deliveries and restore the standard calendar. This does **not** enable production or employee notifications. The campaign epoch and delivery audit are retained. Keep the selected letter unanswered and do not press No Reply Needed until after the last stage if you want to observe all three intervals; use a subsequent incoming message to verify closure separately.

An explicit owner request may restore a test expectation closed with No Reply Needed. The one-off private `TestResume.js` request is applied only after Telegram polling has processed pending callbacks. It checks the exact campaign and original epoch, rechecks Gmail for a reply, archives previous closure fields under `testResume:<operation-id>` and reopens that single row. Already sent deliveries and callback receipts are retained. Fresh Employee/Admin cards use a separate `resume` stage without consuming or resetting 30/60/120-minute stages. The private request is removed after acknowledgement; retries cannot reopen the row again.

Bots cannot start private chats with users who have not pressed Start. Each employee and administrator must start the bot before their own deliveries can proceed. In production, unavailable chats and Telegram 403 responses retain jobs as `waiting_start`; the latter also records an error and disables readiness until a new Start. Other permanent rejections remain `failed`. Do not treat a successful test-admin delivery as proof of other recipients' availability.

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

`runtime-status.cjs` defaults to the last hour. Use `--since=<ISO> --until=<ISO> --max=1000` for a historical test window, or `--hours=24 --max=3000`. Output is counters-only, includes sanitized execution-failure flags and never dumps raw exceptions. `invalid_rapt` on local clasp needs corporate reauthentication; it is not evidence that independent Apps Script triggers stopped.

An owner-authorized acceptance operation can briefly include `AcceptanceRequest.js` with `deploy.cjs prepare --acceptance`. The existing minute trigger runs a fresh health check and persists one idempotent, privacy-safe report under `Sync_State/acceptanceAudit:<operation-id>`. It never changes mode, recipients, delivery reservations, closures, campaign epochs or trigger definitions. Remove the request file after acknowledgement and verify remote HEAD.
