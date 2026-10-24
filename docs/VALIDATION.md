# Validation record

Date: 24 October 2026 (Europe/Kyiv). Rollout: **administrator-only test**, not a production acceptance sign-off.

## Confirmed

| Check | Evidence |
| --- | --- |
| Local critical logic | 60 Node tests pass; syntax/manifest check passes, including schedules, routing, action-specific authorization/cooldown, safe HTML, bounded AI context, late spam/trash exclusion and acceptance reconciliation |
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

## Still requires live acceptance

Open Gmail, Send Reminder, No Reply Needed and all three real elapsed-time stages have now been observed. Sent-reply closure and a subsequent incoming message in the same thread must still be observed before reporting those as live-passed. Unit tests do not substitute for live evidence.

Update: the existing live test message was found and the separate 24/7 campaign activated on 24 October at 01:56:23 Europe/Kyiv. Gmail → Groq → Sheets processing succeeded. The cumulative stages were due at 02:26:23, 02:56:23 and 03:56:23 Europe/Kyiv. Both role deliveries at every stage are now confirmed in Telegram, Cloud Logging and the Reminders ledger. Production weekdays and timezone rules are unchanged.

Live button update: the owner confirmed Open Gmail navigated to the correct letter; read-only Gmail metadata subsequently confirmed that it was read. Send Reminder delivered an extra Employee card at 02:04:25 Europe/Kyiv. No Reply Needed then closed the expectation at 02:04:28; subsequent monitoring observed the closed status. At the owner's explicit request, the expectation was restored at 02:07:25, preserving the original activation epoch and closure audit. Fresh Employee/Admin cards were both delivered by 02:07:32. Scheduled 30/60/120 stages were not consumed or shifted by the restoration. A real sent reply and a subsequent incoming cycle still require live observation.

Card presentation update: at 02:15:32 Europe/Kyiv, the runtime confirmed five successful `editMessageText` operations and zero edit failures for the active test campaign (`cards-v1`). These updated the existing initial, manual and restored role cards in place, preserving their keyboards and historical send-time waiting values. The next monitor still recorded the expectation as `awaiting` with the original activation epoch and no numeric SLA stages consumed. All future reminders use the same structured HTML formatter. Downloaded Apps Script HEAD matches the updated sources.

No employee or second-administrator notification has been sent as part of testing. Those routes are covered by synthetic routing tests only and intentionally await separate owner permission. Production remains disabled.

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

Final live checks before separately approved production:

1. Reply from monitored Gmail to the current test letter. Confirm `replied`, then send a new question from the same personal sender in the same thread. Confirm a distinct incoming row and fresh 30-minute Employee/Admin pair, then close it with No Reply Needed.
2. Send a non-actionable newsletter/thank-you and an actionable client request as separate messages. Confirm the first is `not_required` with an AI reason and no SLA notifications, while the second remains controlled. Do not shorten production SLA intervals to simulate acceptance.

Before production, intended recipients must start the bot. Disable the temporary campaign, retain the standard business calendar and ordinary deduplication, inspect pending/ambiguous jobs and the roster, and obtain explicit owner permission. Employee and second-admin delivery is not yet live-verified.

## Operational limits

Polling adds up to five minutes for Gmail detection and approximately one minute for Telegram actions, plus Apps Script scheduling variability. Free API quotas can defer analysis; unclassified expectations remain visible and eligible for reminders. Telegram cannot provide exactly-once send semantics across an interrupted API request: ambiguous deliveries are flagged for review rather than automatically repeated.

The deployed Apps Script has no npm runtime dependencies. The local official clasp 3.4.1 tool currently has npm audit findings through its Zod 3 dependency (oversized-validation memory exhaustion); no forced major-version dependency override was applied. Keep development tooling local and revisit the vendor update when available.

Use `node scripts/runtime-status.cjs --save` for counters-only Cloud Logging evidence. Detailed private evidence remains under ignored `.local/`; no mail bodies or credentials are included in the report.
