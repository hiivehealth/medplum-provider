---
name: medplum-bot-safety
description: "Use when designing or reviewing Medplum Bot handlers, Subscription triggers, concurrency, idempotency, retries, partial failure, or external-effect safety. Does not authorize deployment. Disabled pending security acceptance."
user-invocable: false
disable-model-invocation: true
---
# Medplum Bot Safety

## Before Acting

Read [security boundaries](../references/security-boundaries.md),
[workspace rules](../../../AGENTS.md),
[Bot safety instructions](../../instructions/medplum-bots.instructions.md), and
[Medplum instructions](../../instructions/medplum.instructions.md).
Inspect the local handlers under `src/bots/` and their neighboring tests.
This skill is design/review only; it neither initializes tooling nor deploys code.

## Procedure

1. Identify accepted event/input types, project boundary, narrow trigger criteria,
   intended FHIR effects, external effects, and the least-privilege Bot policy.
   Verify relevant approved official documentation and installed SDK/server
   support, including subscription extensions. Do not assume a tutorial Bot's
   default permissions or console logging are appropriate for this workspace.
2. Define an action key from stable source identity plus the business action,
   scoped to the project. Include source version only when each version is a new
   intended action. The key must remain stable across retries; never create a
   fresh key to bypass a duplicate or disclose it if it contains patient identity.
3. Make repeated and concurrent delivery converge. Use supported atomic
   conditional writes and version-aware updates; a search followed by an
   unconditional create is not duplicate-safe. On conflicts, re-read/recompute
   rather than overwrite unrelated state. Durable state, not an in-memory flag,
   must support any necessary deduplication/reconciliation.
4. Prevent self-trigger loops with narrow criteria, transition/state checks, and
   skipping no-op writes. Account for absent previous state on creation. Separate
   valid create/update events from irrelevant updates and malformed inputs.
5. Enumerate partial/ambiguous outcomes: write succeeded but response timed out,
   one effect succeeded and another failed, retry after a conflict, or stale
   completed-state marker. Reconcile durable effects before retrying and do not
   mark completion before all required effects succeed.
6. Classify transient, invalid-input, authorization, and stale-version failures.
   Identify the retry owner: handler-level retry, external rest-hook redelivery,
   or separately designed recovery. Medplum documents no automatic retries for
   Bot-endpoint subscriptions; `subscription-max-attempts` applies to external
   HTTP endpoints, not Bots. Verify deployed behavior rather than assuming retry
   delivery. Recommend bounded backoff only for retryable failures. External
   messages, webhooks, or payments need destination idempotency or durable
   reconciliation; do not promise exactly-once delivery or blindly repeat an
   ambiguous effect.
7. Keep secrets, event inputs, patient fields, headers, URLs and unreviewed errors
   out of console/audit output. Verify input and cross-project boundaries before
   any proposed effect; never broaden access to make a workflow succeed.
8. Specify synthetic cases for first, repeated, concurrent and self-triggered
   execution; partial failure; timeout after success; invalid input; unauthorized
   and cross-project access. Assert final state and effect counts. Use the
   provider repository's configured tests when implementation is requested; do
   not invent deployment commands or claim application tests prove live
   authorization.

## Output

Provide an event/effect contract, action-key rule, state/retry decision table,
authorization requirements, failure scenarios, and planned acceptance cases.
For reviews, lead with severity-ordered findings. Note unavailable tooling and
server evidence explicitly. Do not create files, run handlers, or contact systems.

## Example

Input: a completed QuestionnaireResponse should generate a score and notification.
Expected: separate FHIR and external-effect deduplication, timeout reconciliation,
and one effect per intended action under repeated delivery. No unsolicited
implementation or deployment.