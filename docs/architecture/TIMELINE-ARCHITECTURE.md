# Timeline Architecture — Phase 7

**Status:** Phase 7 implemented  
**Contract:** `docs/architecture/CONTRACT-v0.2.md` (FROZEN) · ADR-0010, ADR-0014  
**Scope:** Timeline projection (read model), permission-aware reads, rebuild, keyset pagination, security proof.

## Principle

Timeline is a **derived projection**, never a source of truth and never an authorization database. Projection membership does **not** grant access. Every read re-authorizes at request time (PEP + RLS).

```text
Canonical sources          Outbox              Projection              Read path
─────────────────          ──────              ──────────              ─────────
observations        ──┐                  ┌──► timeline_entries ◄── listTimeline
assessments          ├──► outbox_events ─┤         ▲                    │
goals / care_plans   │   (timeline.project)│        │ rebuild/sync       │
interventions        │                    │   runInSystemContext        │
outcomes / documents ┤                    │                             ▼
handoffs             ┘                    └── syncPersonTimeline   PEP + RLS keyset
```

## Components

| Component      | Location                                                    | Role                                                          |
| -------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| Migration 0017 | `packages/database/migrations/0017_timeline_projection.sql` | `timeline_entries` + indexes + RLS + outbox insert relax      |
| Migration 0018 | `0018_timeline_system_read.sql`                             | System SELECT on projection sources (not private notes)       |
| Migration 0019 | `0019_timeline_system_select.sql`                           | System SELECT on `timeline_entries` (sync/orphan/ON CONFLICT) |
| Migration 0020 | `0020_assessments_amend_update.sql`                         | Author UPDATE `status IN (draft, signed)` for amend           |
| Projection     | `apps/api/src/timeline/project.ts`                          | Collect + upsert + rebuild/sync (system context)              |
| Outbox hooks   | `outbox.ts` + clinical services                             | Queue `timeline.project` same-tx as clinical write            |
| Query          | `query.ts`                                                  | PEP → sync → RLS keyset → cursor                              |
| Cursor         | `cursor.ts`                                                 | Opaque HMAC-signed person+filter-scoped keyset                |
| Types          | `types.ts`                                                  | Deterministic `timelineEntryId`, `assertProjectable`          |

## Projection sources (contract §11 / ADR-0010)

| Source                     | Include rule                                | Event types                                                                |
| -------------------------- | ------------------------------------------- | -------------------------------------------------------------------------- |
| observations               | all                                         | `observation_recorded`                                                     |
| assessments                | `status IN (signed, amended)` — never draft | `assessment_signed`, `assessment_amended`                                  |
| goals                      | all timeline-worthy statuses                | `goal_proposed`, `goal_activated`, `goal_achieved`, `goal_abandoned`       |
| care_plans                 | `status <> draft`                           | `care_plan_activated`, `care_plan_completed`, `care_plan_cancelled`        |
| interventions              | `status <> planned`                         | `intervention_started`, `intervention_completed`, `intervention_cancelled` |
| outcomes                   | all                                         | `outcome_recorded`                                                         |
| documents                  | `status = available`                        | `document_available`                                                       |
| handoffs                   | `status IN (sent, acknowledged, closed)`    | `handoff_sent`, `handoff_acknowledged`, `handoff_closed`                   |
| private_professional_notes | **never**                                   | —                                                                          |

Structural exclusion: `source_type` CHECK has no `private_note`; `isPrivateNoteSourceType` guard in projection (I-4).

## Identity & determinism

- One row per `(person_id, source_type, source_id)`.
- `timeline_entry_id` = UUIDv5-style from `sha256("timeline_entry:v1:{person}:{sourceType}:{sourceId}")`.
- Rebuild is delete-then-insert; sync is upsert + orphan delete. Both idempotent under system context.

## Outbox (ADR-0014)

Clinical writes enqueue `outbox_events` with `event_type = 'timeline.project'` in the **same transaction**. `processTimelineOutbox` drains pending rows as system, then `syncPersonTimeline` per distinct person. `listTimeline` default `sync: true` performs read-your-writes drain + sync before the keyset query.

## System context

Projection maintenance uses `runInSystemContext` (`principal_type = 'system'`). System may:

- SELECT projection sources (0018) — **except** private notes.
- INSERT/UPDATE/DELETE `timeline_entries` (0017).
- SELECT `timeline_entries` (0019) for orphan detection and conflict upsert.

System is only set by trusted server paths. End-user reads always run as person/professional via `runClinicalAsPrincipal` after PEP.

## Explicit non-goals (Phase 7)

No AI, no Redis/Kafka, no HTTP routes, no new authz model, no architecture drift beyond the four Phase 7 migrations above.
