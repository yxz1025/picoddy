# Model Switch Consistency Design

> Status: approved
> Date: 2026-08-27

## Goal

Ensure the model shown in the composer is the model persisted on the
conversation and used for every provider request, including the first message
of a new task and later model changes in an existing conversation.

## Root cause

The renderer sends `modelProvider` and `modelId` to `/api/prompt`, but
`mapPromptRequestToSessionContinue` removes both fields. The Electron
`session.continue` adapter also omits them when forwarding to the backend.
Consequently `provider.prompt` receives no requested model and reuses the
conversation runtime's previous model.

Separately, `ModelPicker` displays the first available model when the stored
selection is absent from the current model list without updating the store.
This permits the UI to display model A while the request carries model B.

## Design

1. Treat `modelProvider` and `modelId` as a required pair at the prompt
   transport boundary. Preserve them through renderer mapping and Electron IPC.
2. Let the existing backend and `LocalPiProvider` remain authoritative for
   model registration, harness switching, and conversation persistence.
3. Derive the picker selection through a pure resolver. If the stored model is
   available, use it. Otherwise select the first available model and synchronize
   that exact pair into the store before the user can send a message.
4. Never render a fallback model name while retaining a different hidden model
   value.
5. Keep new-task creation unchanged: it persists the current store model, and
   the first prompt carries the same pair again for end-to-end consistency.

## Error handling

- An unavailable requested model continues to fail through the backend's
  existing `模型 provider/model 未注册` error instead of silently falling back.
- An empty model list displays an unavailable state and opens Settings when the
  user attempts to configure a model.
- Model fields are forwarded together; partial pairs are normalized to
  `undefined` at the renderer transport boundary.

## Verification policy

Regression cases cover prompt mapping, IPC forwarding, valid picker selection,
and stale-selection fallback. Per the user's instruction, automated tests are
authored but not executed. Verification is limited to frontend/backend
TypeScript checks and `git diff --check`.
