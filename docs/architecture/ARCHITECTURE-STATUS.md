# Architecture Status

| Artifact                                  | Status                                                  | Location                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Architecture & Domain Contract v0.2       | **FROZEN**                                              | `docs/architecture/CONTRACT-v0.2.md`                                                                                            |
| ADR-0001 … ADR-0014                       | **Accepted / Frozen**                                   | `docs/adr/`                                                                                                                     |
| Security invariants                       | Active (enforced where implementable in Phase 0)        | `docs/security/SECURITY-INVARIANTS.md`                                                                                          |
| Threat model                              | Baseline                                                | `docs/security/THREAT-MODEL.md`                                                                                                 |
| Implementation phases                     | Phase 7 DONE (Phase 8 not authorized until explicit go) | `docs/architecture/IMPLEMENTATION-PHASES.md`                                                                                    |
| Domain kernel                             | **Phase 1 implemented**                                 | `packages/domain`, `DOMAIN-KERNEL.md`                                                                                           |
| Phase 0 audit                             | PASS                                                    | `docs/architecture/PHASE-0-AUDIT.md`                                                                                            |
| Phase 1 audit                             | PASS                                                    | `docs/architecture/PHASE-1-AUDIT.md`                                                                                            |
| Phase 2 audit                             | PASS                                                    | `docs/architecture/PHASE-2-AUDIT.md`                                                                                            |
| Phase 3 audit                             | PASS                                                    | `docs/architecture/PHASE-3-AUDIT.md`                                                                                            |
| Phase 4 audit                             | PASS                                                    | `docs/architecture/PHASE-4-AUDIT.md`                                                                                            |
| Phase 5 audit                             | PASS                                                    | `docs/architecture/PHASE-5-AUDIT.md`                                                                                            |
| Phase 6 audit                             | PASS                                                    | `docs/architecture/PHASE-6-AUDIT.md`                                                                                            |
| Phase 7 audit                             | PASS                                                    | `docs/architecture/PHASE-7-AUDIT.md`                                                                                            |
| Collaboration graph                       | **Phase 4 implemented**                                 | `apps/api/src/collaboration`, `COLLABORATION-GRAPH.md`, `COLLABORATION-SECURITY.md`                                             |
| Auth package                              | **Phase 3 implemented** (`AUTH_READY`)                  | `packages/auth`, `AUTHENTICATION-ARCHITECTURE.md`, `IDENTITY-SECURITY.md`                                                       |
| Consent + policy engine                   | **Phase 5 implemented**                                 | `apps/api/src/consent`, `apps/api/src/authorization`, `CONSENT-POLICY.md`, `AUTHORIZATION-MODEL.md`, `ACCESSGRANT-COMPILER.md`  |
| Clinical core + private notes + documents | **Phase 6 implemented**                                 | `apps/api/src/clinical`, `CLINICAL-CORE.md`, `PRIVATE-NOTES.md`, `DOCUMENT-SECURITY.md`, `CLINICAL-DATA-SECURITY.md`            |
| Timeline projection                       | **Phase 7 implemented**                                 | `apps/api/src/timeline`, `TIMELINE-ARCHITECTURE.md`, `TIMELINE-SECURITY.md`, `TIMELINE-PROJECTION.md`, `TIMELINE-PAGINATION.md` |

## Freeze rules

- v0.2 is not revised by PR convenience.
- Contradictions discovered during implementation go through ADR change control (`docs/adr/README.md`).
- Phase 8 begins only after Phase 7 audit **PASS** and explicit authorization.

## Known intentional gaps (by design, not defects)

- HTTP route layer not yet (clinical/timeline services exist without routes).
- Auth is identity only — not the authorization engine (Phase 5 PEP lives in permissions + apps/api).
- Domain kernel has pure state machines only — no persistence of those aggregates.
- No AI provider integration yet (Phases 9–10).
- Compliance validation not claimed (legal track separate).
- Rate limiter in-memory until Redis (Phase 11 hardening).
- Git init still open (Phase 0 F-1).
