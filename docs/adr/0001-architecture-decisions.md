# ADR 0001: Core architecture of the merchant onboarding backend

- **Status:** Accepted
- **Date:** 2026-11-05
- **Context:** senior backend take-home, time-boxed to about 6–8 hours

## Context

We need an internal API where SALES users capture merchant applications, an external KYB/risk check runs asynchronously, and an assigned REVIEWER decides. The main risks are:

- **Authorization bypass:** one SALES user reaching another's application, or the wrong person deciding.
- **Invalid state changes:** for example, approving before the risk check, or editing after a decision.
- **Duplicate or lost risk checks:** retries, redelivery and concurrent submits.
- **Leaking sensitive merchant data:** through logs, audit records or API responses.

The time-box favours simple, explainable mechanisms that are enforced in more than one place.

## Decisions

### 1. Modular monolith on NestJS

One deployable, with modules `auth`, `users`, `applications`, `risk`, `audit`, `health` and `common`.
- **Why:** no network boundaries to secure or operate; transactions can span the application change and its audit row.
- **Kept separable:** the queue is the seam where the risk worker can become its own deployment.

### 2. Object-level authorization in the query, plus action checks

`ApplicationAccessPolicy` is the single place for these rules.
- **Visibility is part of the SQL `WHERE`:** SALES gets `created_by_id = :me`, REVIEWER gets `assigned_reviewer_id = :me`, ADMIN is unrestricted.
- **Every** read and write loads the application through this scope. An out-of-scope row is never loaded, and the API answers **404**, indistinguishable from a missing id.
- `assertCanModify`, `assertCanDecide` and `assertCanAssign` then check what the caller may *do* (403).
- A global `@Roles` guard adds a coarse first layer.

Rationale and consequences:
- Fetch-then-check is easy to forget on a new endpoint; a scoped loader isn't. Defense in depth means one missing check doesn't open a bypass. This was verified by disabling each layer in turn.
- **ADMIN cannot decide.** The brief reserves decisions for the assigned reviewer, and this keeps four-eyes separation.
- **Trade-off:** clients cannot tell "not found" from "not yours". That's acceptable for an internal API.

### 3. A pure state machine

All transitions live in one table: (action → allowed from-statuses → to-status), with no framework or I/O.
- Invalid transitions raise a domain error, mapped to HTTP 409 by the global exception filter.
- The table is unit-tested exhaustively (every status × action).
- The risk worker has its own action (`COMPLETE_RISK_REVIEW`: SUBMITTED → UNDER_REVIEW). It structurally **cannot** approve or reject.
- Decisions are only allowed from UNDER_REVIEW, so a decision always has a finished risk result.

### 4. PostgreSQL as the source of truth, with hand-written migrations

- Constraints are named, foreign keys use `ON DELETE RESTRICT`, enums are PostgreSQL enums, and CHECKs cover amounts.
- `UNIQUE (application_id, submission_number)` on risk assessments.
- A trigger makes `audit_logs` append-only.
- `synchronize` is off everywhere; `schema:log` verifies the entities match the migration.
- Every state change runs in a transaction with `SELECT … FOR UPDATE` on the application row. Locks are always taken in the order application → assessment to avoid deadlocks.

### 5. BullMQ for the risk check: enqueue after commit, three idempotency layers

Submit commits the transition, the new `risk_assessments` row (PENDING) and the audit entry, **then** enqueues.

| Layer | Mechanism |
|---|---|
| 1 | Deterministic job id `risk-<applicationId>-<submissionNumber>`, so duplicate adds are no-ops |
| 2 | The worker re-checks the assessment under lock and skips terminal ones, so redelivery never calls the provider twice |
| 3 | The DB unique constraint |

Retries:
- Provider errors are re-thrown, so BullMQ retries 3 times with exponential backoff.
- The final failure marks the assessment FAILED and is audited.
- An ADMIN retry endpoint re-runs a FAILED or stuck PENDING check.

The provider sits behind a DI token (`RISK_PROVIDER`). The bundled simulator is deterministic.

**Alternatives considered**

| Alternative | Why not chosen |
|---|---|
| Enqueue inside the transaction | The worker could run before the commit, or a rollback could leave a ghost job |
| Transactional outbox | Removes the "committed but not enqueued" gap, but adds a table and a relay. Deferred and documented; the gap is mitigated by the retry endpoint and logging. |
| Synchronous provider call | Couples API latency and availability to a third party |

### 6. Audit in the same transaction, masked centrally

- `AuditService.record(manager, …)` writes through the caller's transaction, so a change and its audit row commit or roll back together.
- Metadata is redacted and masked inside `record`, so callers cannot forget.
- PostgreSQL is used for audit storage, which the brief explicitly accepts. MongoDB was not needed.

### 7. Secure-by-default request pipeline

- A global JWT guard (opt-out only via `@Public()`), then `RolesGuard`.
- A whitelisting `ValidationPipe` that rejects unknown fields, which blocks mass assignment of `status` or ownership.
- One exception filter for a consistent error shape and no leaks.
- A logging interceptor that never logs bodies or headers.
- Env validation that refuses to boot with a weak JWT secret.

## Consequences

- **Positive:**
  - The authorization and state rules each live in one small, tested place.
  - Async processing is safe under retries, duplicates and concurrency.
  - The audit trail is consistent and tamper-resistant at the DB level.
- **Negative / accepted:**
  - Pessimistic locks limit write throughput per application (not globally).
  - The worker shares the API process.
  - The enqueue gap without an outbox.
  - Field-level encryption is documented, not implemented.

  These are listed with follow-ups in the README ("Trade-offs and known limitations").
