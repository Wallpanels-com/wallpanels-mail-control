# Validation record

Date: 24 October 2026 (Europe/Kyiv). Rollout: **administrator-only test**, not a production acceptance sign-off.

## Confirmed

| Check | Evidence |
| --- | --- |
| Local critical logic | 31 Node tests pass; syntax/manifest check passes |
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

The test administrator is checking Send Reminder and No Reply Needed and preparing a new test email. Actual callback completion, real Gmail link navigation, sent-reply closure and a subsequent incoming message in the same thread must be observed before reporting these as live-passed. Unit tests cover these state rules but do not substitute for that evidence.

No employee or second-administrator notification has been sent as part of testing. Those routes are covered by synthetic routing tests only and intentionally await separate owner permission. Production remains disabled.

The `/preview` command is available only to the test administrator in a private chat and previews only that administrator's approved test mailbox. It does not consume or change SLA stages. A real test email arriving after 18:30 Friday Miami time reaches its first 30-business-minute stage on Monday after 09:00; this pause is expected.

## Operational limits

Polling adds up to five minutes for Gmail detection and approximately one minute for Telegram actions, plus Apps Script scheduling variability. Free API quotas can defer analysis; unclassified expectations remain visible and eligible for reminders. Telegram cannot provide exactly-once send semantics across an interrupted API request: ambiguous deliveries are flagged for review rather than automatically repeated.

The deployed Apps Script has no npm runtime dependencies. The local official clasp 3.4.1 tool currently has npm audit findings through its Zod 3 dependency (oversized-validation memory exhaustion); no forced major-version dependency override was applied. Keep development tooling local and revisit the vendor update when available.

Use `node scripts/runtime-status.cjs --save` for counters-only Cloud Logging evidence. Detailed private evidence remains under ignored `.local/`; no mail bodies or credentials are included in the report.
