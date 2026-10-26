# Validation record

## 26 October economical AI update

Read-only preflight found 177 historical `GROQ_HTTP_413` entries and eight pending analyses, despite successful monitor executions. One unchanged real request reproduced the exact failure: 8,156 requested tokens against the organization's 8,000 limit. It sent five thread messages in a 13,802-byte request. Two additional execution failures in the prior 24 hours were generic Google server errors, followed by successful automatic runs.

The owner requested lower token consumption, not a limit or plan increase. `single-message-v2` sends only the current incoming message, removes explicitly delimited quoted history, caps the complete UTF-8 request at 4,500 bytes and completion at 600 tokens, and preserves human review for truncated messages. No routing, SLA calendar, mailbox, delivery history, or production cutover changes are made.

Pre-deployment live Groq checks: all six synthetic decisions passed with 370–420 total tokens per example. The previously failing real message succeeded with HTTP 200, one message, 3,701 request bytes and 1,901 actual total tokens. These are observed examples, not a promise of identical usage for every email. Local tests also check Unicode/escaping budgets, tail preservation, omission of earlier thread messages, conservative truncation, reuse of completed analyses, independent sent-reply detection and idempotent recovery.

Final verification: all 80 local tests and syntax/manifest checks pass, including a multi-megabyte email and inline/bottom-posted reply preservation. Downloaded Apps Script HEAD matches the final runtime sources. At 14:23 Europe/Kyiv the versioned recovery queued eight existing 413 failures. The regular 14:23, 14:28 and 14:33 production runs reported pending AI counts of 6, 3 and 0 respectively; all seven mailboxes remained monitored. Cumulative Error count stayed 181 across those three runs. Historical error rows were preserved, not erased or represented as a zero-error history. Production recipients, calendar, source receipt times and reminder keys were not reset.

Date: 24 October 2026 (Europe/Kyiv). Production was explicitly authorized by the owner and activated at 23:52. Earlier administrator-only test evidence is retained below.

## Production activation

Runtime confirmed `MODE=production`, approval enabled, test campaign and its property disabled, seven mailboxes, eight mailbox owners and two administrators. The former test Gmail remains included with role `admin_employee`. Fresh API health passed. Both triggers remain installed. The operational snapshot records zero Errors, no old live expectations in the production queue and zero production jobs at cutover, which occurred on Saturday outside the work window.

Cutover receipt: `Sync_State/productionRollout:production-20261024-01`; immutable baseline: 24 October 23:51:48 Europe/Kyiv. Historic test receipts and sent records were preserved. Start onboarding is gated by the approved numeric Telegram ID, never by an arbitrary username. The test owner's previously confirmed chat is ready. The other eight distinct recipients, including the second administrator, still need to press Start. No delivery to those recipients is claimed as live-verified.

Production coverage includes 71 passing local tests: recipient isolation/shared mailbox routing, administrator-owner deduplication, permanent owner role, API health and trigger gates, durable partial-cutover recovery, exclusion of historic/test rows, Start authorization/replay/delayed polling, held-job release and latest-stage coalescing. A live Gmail reply is now confirmed (`replied`), and a subsequent incoming cycle produced its own 30/60/120 role pairs in the test campaign. Recipient onboarding and real employee delivery will only be fully observed when staff start the bot.

## Confirmed

| Check | Evidence |
| --- | --- |
| Local critical logic | 71 Node tests pass; syntax/manifest check passes, including production cutover, onboarding, schedules, routing, action authorization, safe HTML and AI context |
| Existing Gmail delegation | Live read-only profile checks pass for all seven approved mailboxes, including the optional test owner |
| Apps Script Gmail access | Runtime health records `gmailOk=7`, `gmailTotal=7` using existing IAM/DWD |
| Groq | Synthetic customer request classified correctly by `openai/gpt-oss-20b`; runtime Script Properties verified |
| Telegram | Correct bot identity; no active webhook; real synthetic notification delivered to the approved test administrator |
| Database | Existing spreadsheet initialized successfully; roster includes eight owners/roles over seven distinct mailboxes |
| Initial synchronization | Seven current cursors established; no historic inbox imported |
| Recipient isolation | Runtime acceptance snapshot records one test delivery, zero unsafe recipients and zero errors |
| Triggers | Monitoring and polling triggers created; monitoring subsequently executed twice approximately five minutes apart |
| Source parity | Downloaded Apps Script runtime matches committed `src/`; private bootstrap removed from HEAD after setup |
| Publication | Code, tests and documentation pushed to the approved repository's `main`; private reference/configuration excluded |

## Earlier test evidence (before production authorization)

Open Gmail, Send Reminder, No Reply Needed and all three real elapsed-time stages were observed. At that snapshot, sent-reply closure and a subsequent incoming message were still outstanding; both were subsequently observed before production activation, as recorded above. Unit tests do not substitute for live evidence.

Update: the existing live test message was found and the separate 24/7 campaign activated on 24 October at 01:56:23 Europe/Kyiv. Gmail → Groq → Sheets processing succeeded. The cumulative stages were due at 02:26:23, 02:56:23 and 03:56:23 Europe/Kyiv. Both role deliveries at every stage are now confirmed in Telegram, Cloud Logging and the Reminders ledger. Production weekdays and timezone rules are unchanged.

Live button update: the owner confirmed Open Gmail navigated to the correct letter; read-only Gmail metadata subsequently confirmed that it was read. Send Reminder delivered an extra Employee card at 02:04:25 Europe/Kyiv. No Reply Needed then closed the expectation at 02:04:28; subsequent monitoring observed the closed status. At the owner's explicit request, the expectation was restored at 02:07:25, preserving the original activation epoch and closure audit. Fresh Employee/Admin cards were both delivered by 02:07:32. Scheduled 30/60/120 stages were not consumed or shifted by the restoration. A real sent reply and a subsequent incoming cycle still require live observation.

Card presentation update: at 02:15:32 Europe/Kyiv, the runtime confirmed five successful `editMessageText` operations and zero edit failures for the active test campaign (`cards-v1`). These updated the existing initial, manual and restored role cards in place, preserving their keyboards and historical send-time waiting values. The next monitor still recorded the expectation as `awaiting` with the original activation epoch and no numeric SLA stages consumed. All future reminders use the same structured HTML formatter. Downloaded Apps Script HEAD matches the updated sources.

No employee or second-administrator notification was sent as part of testing. Those routes were covered by synthetic routing tests only. Production was disabled at that snapshot; the later owner-authorized activation is recorded above.

The `/preview` command is available only to the test administrator in a private chat and previews only that administrator's approved test mailbox. It does not consume or change SLA stages. A real test email arriving after 18:30 Friday Miami time reaches its first 30-business-minute stage on Monday after 09:00; this pause is expected.

## 24 October acceptance review

The 19:42 Europe/Kyiv snapshot is stored in the existing database under `Sync_State/acceptanceAudit:audit-20261024-01`. It leaves delivery records, closures and campaign timing unchanged. The short-lived audit request is removed after acknowledgement.

| Observation | Result |
| --- | --- |
| 30-minute pair | Employee 02:26:27, Admin 02:26:28 Europe/Kyiv |
| 60-minute pair | Employee 02:56:28, Admin 02:56:30 Europe/Kyiv |
| 120-minute pair | Employee 03:56:28, Admin 03:56:30 Europe/Kyiv |
| Timing | All six deliveries 3–7 seconds after the cumulative due instant |
| Ledger | 12 sent test deliveries: synthetic card, initial pair, manual reminder, restored pair and six SLA cards. Zero pending, failed or unknown |
| Isolation / duplicates | Zero unsafe test recipients, duplicate keys or duplicate SLA-role deliveries |
| Errors | Errors table empty; no execution failures found in the reviewed night window and recent runtime logs |
| Health | Fresh runtime check: Gmail 7/7, Telegram and Groq work, no webhook, two expected triggers |
| State | Original epoch retained; real message read, unanswered and awaiting; production not approved |
| Synthetic Groq acceptance | Six of six expected reply decisions: quotation, newsletter, thanks, auto-reply, action-required notice, untrusted email instructions. Refined prompt produced Russian summary and reason in all six responses |

Review fixes: bound AI context without truncating JSON or dropping the target message; exclude plain-text attachments; stop reminders when the source moves to Spam/Trash; reinforce Russian summary/reason; accurately acknowledge manual-reminder cooldown and callback replay. Historical AI summaries remain as originally recorded; the language refinement applies to new analyses.

Remaining acceptance checklist at the 19:42 snapshot:

1. Reply from monitored Gmail to the current test letter. Confirm `replied`, then send a new question from the same personal sender in the same thread. Confirm a distinct incoming row and fresh 30-minute Employee/Admin pair, then close it with No Reply Needed.
2. Send a non-actionable newsletter/thank-you and an actionable client request as separate messages. Confirm the first is `not_required` with an AI reason and no SLA notifications, while the second remains controlled. Do not shorten production SLA intervals to simulate acceptance.

Activation update: the first item was subsequently observed through reply closure and a fresh incoming cycle. The second item's real non-actionable-versus-actionable email comparison remains an optional follow-up; six synthetic AI cases passed. The owner authorized production, the temporary campaign was disabled and normal calendar/deduplication restored. Staff can start on Monday; their jobs wait until onboarding. Employee and second-admin delivery is not yet live-verified.

## Operational limits

Polling adds up to five minutes for Gmail detection and approximately one minute for Telegram actions, plus Apps Script scheduling variability. Free API quotas can defer analysis; unclassified expectations remain visible and eligible for reminders. Telegram cannot provide exactly-once send semantics across an interrupted API request: ambiguous deliveries are flagged for review rather than automatically repeated.

The deployed Apps Script has no npm runtime dependencies. The local official clasp 3.4.1 tool currently has npm audit findings through its Zod 3 dependency (oversized-validation memory exhaustion); no forced major-version dependency override was applied. Keep development tooling local and revisit the vendor update when available.

Use `node scripts/runtime-status.cjs --save` for counters-only Cloud Logging evidence. Detailed private evidence remains under ignored `.local/`; no mail bodies or credentials are included in the report.
