# Health Collaboration OS

AI-native, **person-centric** collaboration infrastructure for human health and fitness.

This repository is currently at **Phase 0 — Architecture Freeze + Repository Foundation**.  
It intentionally contains **no health features** yet.

---

## 1. What it is (product)

Health Collaboration OS connects a person’s doctors, physiotherapists, trainers, nutritionists, and related professionals through **one permission-controlled, longitudinal context layer**.

- The **person is the center** of the system (not the clinic or gym).
- Professionals receive **minimum-necessary** access only through **consent**.
- Important history lives on a **longitudinal timeline** with provenance.
- **AI assists professionals** inside strict authorization and human-approval boundaries — it does not diagnose, prescribe, sign, or act autonomously.

**India-first** product posture; hybrid **B2B + B2C**; MVP **18+**; invite/code-based discovery (no public directory).

> **Not a compliance claim.** This project does **not** claim DPDP compliance, HIPAA compliance, medical-device compliance, or regulatory approval. Those require separate legal/product validation before production (see `docs/adr/0003-india-first-regulatory-posture.md`).

---

## 2. Architectural principles

Authoritative source: [`docs/architecture/CONTRACT-v0.2.md`](docs/architecture/CONTRACT-v0.2.md) (**FROZEN**).

| Area          | Decision                                                                |
| ------------- | ----------------------------------------------------------------------- |
| Shape         | Modular monolith + separate worker (not microservices)                  |
| Data root     | `person_id`; organizations never own health data                        |
| Access        | RBAC ∧ care relationship ∧ consent ∧ ABAC ∧ purpose — fail-closed       |
| Database      | PostgreSQL + RLS defense-in-depth (Phase 2+)                            |
| Async         | Transactional outbox (Phase 2+)                                         |
| Timeline      | Typed aggregates + derived projection                                   |
| Private notes | Separate `PROFESSIONAL_PRIVATE` class — not UI-hiding                   |
| AI            | `Task Registry → Context Broker → AI Provider → Validator → Human Gate` |
| Language      | Strict TypeScript everywhere                                            |

---

## 3. Repository structure

```text
health-collaboration-os/
├── apps/
│   ├── web/          # presentation shell
│   ├── api/          # API composition shell (no HTTP server in Phase 0)
│   └── worker/       # background shell (no queue in Phase 0)
├── packages/
│   ├── domain/       # pure domain (no I/O)
│   ├── database/     # persistence boundary (empty until Phase 2)
│   ├── auth/         # identity/session (empty until Phase 3)
│   ├── permissions/  # authorization primitives (fail-closed shell)
│   ├── validation/   # shared validation primitives
│   └── ui/           # pure presentation primitives
├── tooling/          # shared tsconfig + eslint config package
├── docs/
│   ├── architecture/ # frozen contract, status, phases, audit
│   ├── adr/          # ADR-0001…0014 + change control
│   ├── security/     # invariants + threat model
│   ├── api/          # API notes (no endpoints yet)
│   └── runbooks/     # placeholder (not production-ready)
├── tests/
│   └── architecture/ # boundary + phase-0 freeze tests
├── .github/workflows/ci.yml
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── eslint.config.mjs
├── .dependency-cruiser.cjs
├── .env.example
└── README.md
```

---

## 4. Development setup

### Requirements

| Tool    | Version                                                    |
| ------- | ---------------------------------------------------------- |
| Node.js | **22.18+** (see `.nvmrc`; engines `<27`)                   |
| pnpm    | **12.4.2** (pinned via `packageManager` in `package.json`) |

```bash
corepack enable
# or: npm install -g pnpm@12.4.2

pnpm install --frozen-lockfile
```

Copy environment template (no secrets):

```bash
cp .env.example .env
```

`.env` is gitignored. **Never commit real secrets.**

---

## 5. Commands (quality gates)

| Command                  | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `pnpm lint`              | ESLint across workspace                                                   |
| `pnpm typecheck`         | Strict TypeScript project checks                                          |
| `pnpm test`              | Unit tests + architecture tests (Vitest)                                  |
| `pnpm test:unit`         | Unit tests only                                                           |
| `pnpm test:architecture` | Boundary / freeze tests only                                              |
| `pnpm boundaries`        | dependency-cruiser forbidden-edge check                                   |
| `pnpm build`             | Compile all packages/apps                                                 |
| `pnpm format:check`      | Prettier check                                                            |
| `pnpm deps:audit`        | Dependency vulnerability audit                                            |
| **`pnpm verify`**        | **Canonical gate:** format + lint + typecheck + test + boundaries + build |

Local and CI run the same gates. CI does **not** use `continue-on-error` on quality steps.

---

## 6. Security principles (Phase 0 baseline)

Enforced or established now:

- No secrets in the repository; `.env.example` only
- Lockfile committed; CI uses `pnpm install --frozen-lockfile`
- Node + pnpm versions pinned
- Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …)
- No `any` (ESLint error)
- Package **dependency boundaries** enforced by dependency-cruiser + architecture tests
- No wildcard CORS (no HTTP server exists yet; rule recorded for API phase)
- Dependency audit gate in CI

**Not yet provided** (later phases): runtime authorization, RLS, session security, encryption key management, penetration testing, regulatory validation.  
Full invariants: [`docs/security/SECURITY-INVARIANTS.md`](docs/security/SECURITY-INVARIANTS.md).

---

## 7. Phase 0 scope

**In scope:** monorepo structure, package boundaries, strict TS, lint/format, boundary enforcement, CI, env skeleton, documentation freeze, ADR locking, security defaults, test infrastructure.

**Explicitly excluded:** database schema · migrations · RLS · authentication · authorization logic · consent logic · clinical entities · timeline · AI calls · UI features · API health endpoints · real integrations · production secrets · LLM providers · document storage · Redis · Kafka · microservices · SHOULD HAVE / LATER / NEVER-IN-MVP features.

Phases: [`docs/architecture/IMPLEMENTATION-PHASES.md`](docs/architecture/IMPLEMENTATION-PHASES.md).  
Phase 1+ requires **explicit authorization** after the Phase 0 audit.

---

## 8. How architecture changes are governed

Core ADRs are frozen. Changing them requires:

1. Identified contradiction / security flaw / impossible constraint
2. ADR amendment
3. Impact analysis
4. Security impact review
5. Dependency/data migration impact
6. Explicit architecture approval

**Implementation convenience is not sufficient.**  
See [`docs/adr/README.md`](docs/adr/README.md).

---

## 9. License / status

Private, unpublished engineering foundation. Product marketing and compliance statements are out of scope for this repository’s Phase 0 documentation.
