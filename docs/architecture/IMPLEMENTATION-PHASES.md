# Implementation Phases

Source: Architecture & Domain Contract v0.2 §16.  
Each phase requires the previous phase’s acceptance criteria and security gates.

| Phase | Objective                                                                                    | Authorized?           |
| ----- | -------------------------------------------------------------------------------------------- | --------------------- |
| **0** | Architecture freeze + monorepo foundation, boundaries, strict TS, CI, security baseline docs | **DONE (audit PASS)** |
| **1** | Pure domain kernel: entities, value objects, state machines, invariants                      | **DONE (audit PASS)** |
| **2** | Database foundation: schema, RLS, outbox, audit privileges                                   | **DONE (audit PASS)** |
| **3** | Identity/auth (sessions, invite tokens)                                                      | **DONE (audit PASS)** |
| **4** | Collaboration graph: orgs, memberships, care team, invitations                               | **DONE (audit PASS)** |
| 5     | Consent + policy engine (central enforcement point)                                          | **DONE (audit PASS)** |
| 6     | Clinical core + private notes + documents                                                    | **DONE (audit PASS)** |
| **7** | Timeline projection                                                                          | **DONE (audit PASS)** |
| 8     | Handoff closed loop (+ minimal referral)                                                     | No                    |
| 9     | Documentation AI (broker, draft staging, human sign)                                         | No                    |
| 10    | Contextual summary + handoff draft tasks                                                     | No                    |
| 11    | Security hardening, break-glass, access log, retention scaffolding                           | No                    |
| 12    | E2E vertical slice + negative security journeys                                              | No                    |

## Phase 0 explicitly excluded

Database schema · migrations · RLS · authentication · authorization logic · consent logic · clinical entities · timeline · AI calls · UI features · API health endpoints · real integrations · production secrets · LLM providers · document storage · Redis · Kafka · microservices · SHOULD HAVE / LATER / NEVER-IN-MVP features.
