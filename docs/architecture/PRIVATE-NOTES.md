# Private Professional Notes — Phase 6

**Normative references:** ADR-0005 (private professional notes), SECURITY-INVARIANTS I-4, I-5, I-11, CONTRACT-v0.2 (PROFESSIONAL_PRIVATE data class).

## Rules (ADR-0005, frozen)

1. Private notes are **author-only**. No person read, no co-professional read, no org-admin read.
2. Private notes are **never** ordinary-granted via consent (`private_note_read` is not a consent category; compiler skips it).
3. Private notes are **excluded** from shared timeline, handoff manifests, AI context, and ordinary consent flows.
4. A note may be **promoted** by its author into a shared assessment draft; the original remains `PROFESSIONAL_PRIVATE`.

## Enforcement layers (three, independent)

| Layer   | Mechanism                                                                                                | Failure behavior                                                    |
| ------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| PEP     | `authorizeClinical` for `private_note_read` returns `PRIVATE_NOTE` immediately after category validation | throws `ClinicalError('denied', …, { denyReason: 'PRIVATE_NOTE' })` |
| RLS     | `can_access_private_note(note_id, professional_id)` — author row only                                    | UPDATE/SELECT → 0 rows                                              |
| Service | `assertAuthorOnly` / explicit author check on every read/update/void/promote                             | throws `not_found` (no existence leak)                              |

A person actor attempting any private-note operation fails at PEP (`ROLE_NOT_PERMITTED` or `PRIVATE_NOTE`). Another professional with a full grant fails at PEP `PRIVATE_NOTE` and again at service author check.

## Never ordinary grant

- `packages/domain` `compileAccessGrants` never emits `private_note_read`.
- Consent scope taxonomy does not include `private_note_read` for ordinary grants.
- Phase 5 compiler tests assert structural exclusion (I-4).

## Promotion flow

```text
Author professional
  → PEP (author-only read of private note)
  → create shared assessment draft
       title: "Promoted private note"
       provenance: promotion_from_private_note = <note_id>
  → original note remains PROFESSIONAL_PRIVATE (status unchanged, body unchanged)
  → audit event without note body
```

Promotion creates a **draft** assessment — it does not sign, does not share, does not bypass assessment rules. Subsequent share/sign follows ordinary Phase 6 assessment flow.

## Handoff structural exclusion (I-5)

- `handoff_items.ref_kind` CHECK allows `'document'` but **not** private-note reference kinds.
- Domain handoff assembly never iterates private notes.
- Timeline projection (Phase 7) will exclude by `data_class = 'PROFESSIONAL_PRIVATE'`.

## Evidence (Phase 6)

- Service matrix tests: author read/write OK; non-author → `not_found`; person → deny.
- RLS tests: non-author SELECT/UPDATE → 0 rows.
- Promotion test: shared draft created; original note byte-identical; no body in audit.
- Phase 5 regression: compiler never emits `private_note_read`.

See `apps/api/src/clinical/private-notes.integration.test.ts`.
