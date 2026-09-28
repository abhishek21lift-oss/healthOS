# ADR-0013 — Documentation AI with professional attestation

- Status: **Accepted (FROZEN)**
- Date: 2026-09-22
- Deciders: Product owner (D5), Principal Architect

## Context

Documentation AI is a required MVP capability; final documentation and attestation remain human.

## Decision

Workflow:

```text
structured inputs + explicitly selected context (+ optional author-selected private notes)
  → Context Broker
  → Documentation AI (schema-constrained draft in staging, not live record)
  → Validator (schema, citations, red-lines, DLP)
  → professional review/edit
  → professional SIGN/attestation
  → final record with provenance including ai_interaction_id
```

- AI drafts live in staging (`AIDraft`), never auto-merged into signed entities.
- Amendment of AI-assisted signed docs follows normal human amendment rules; AI never re-signs.
- No code path may write AI output to `status=signed` without authenticated human SIGN.

## Alternatives considered

1. AI writes directly into assessment rows — rejected: silent generation.
2. Forever-separate “AI document” type — rejected: fragments longitudinal record.
3. Unstructured rich text only — rejected: loses queryability.

## Why chosen

Meets red lines while keeping AI output in the same provenance graph.

## Consequences

Assessment lifecycle includes staging states; prompt/model/schema versions tracked on AIInteraction.

## Reversal cost

**Medium**.

## Migration path

Additional note types reuse the same staging pattern.

## Security impact

Supports I-6, I-7. Directly implements locked D5 prohibition list (no autonomous sign/attest/diagnose/prescribe/mutate/send).
