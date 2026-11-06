# Attachment Response Error Fix Design

## Goal

Fix two independent attachment failures: PDF extraction failing before `/api/prompt`,
and existing conversations silently producing no visible response after an Excel
attachment is sent.

## Root Causes

1. `pdfjs-dist` does not infer its fake-worker module in Deno, while the reader
   explicitly sets `GlobalWorkerOptions.workerSrc` to an empty string.
2. Persisted assistant messages are replayed into the Agent with only `role`,
   `content`, and `timestamp`. The SDK expects assistant metadata including
   `usage`, and crashes while reading `usage.totalTokens`.
3. The SDK represents this failure as an assistant `message_end` with empty
   content plus `errorMessage`. Both persistence and the frontend currently
   ignore that shape, making the failure invisible.

## Design

- Configure the PDF worker with the package-relative `./pdf.worker.mjs`.
- Add a focused Agent history adapter that reconstructs valid SDK user and
  assistant messages from stored conversation messages. Replayed assistant
  messages receive zero usage, the active provider/model identifiers, and a
  normal stop reason.
- Centralize assistant event text extraction on the backend. Prefer textual
  content; when an assistant message ends in error with no content, return a
  localized `出错了：...` fallback. Persist that fallback and mark the
  conversation failed.
- Add the equivalent pure frontend event formatter so SSE errors are rendered
  immediately instead of disappearing.

## Error Handling

PDF parsing continues returning `ReadResult { kind: "error" }` at the document
boundary. Agent error events remain protocol-compatible; only their previously
ignored `errorMessage` becomes visible and persistent.

## Testing

- Generate a minimal PDF in a temporary directory and assert text extraction.
- Assert replayed assistant messages include a complete zero-usage object and
  can be classified without dereferencing undefined usage.
- Assert an empty-content assistant error event becomes visible error text.
- Re-run attachment, model, type-check, frontend build, and lint verification.

