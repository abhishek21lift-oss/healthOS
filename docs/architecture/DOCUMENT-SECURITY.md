# Document Security — Phase 6

**Normative references:** CONTRACT-v0.2 (documents), ADR-0008 (RLS second gate), SECURITY-INVARIANTS I-1, I-10, I-11, I-16, I-19.

## Lifecycle states

```text
initialized → pending_scan → available
                       ↘ quarantined   (terminal)
                       ↘ failed → pending_scan (retry)
```

| State          | Scan status allowed | Readable | Notes                                           |
| -------------- | ------------------- | -------- | ----------------------------------------------- |
| `initialized`  | `pending`           | no       | metadata only                                   |
| `pending_scan` | `pending`           | no       | awaiting scan                                   |
| `available`    | `clean`             | yes      | **requires** `scan_status = 'clean'` (DB CHECK) |
| `quarantined`  | `malicious`         | no       | **terminal** — no transition out                |
| `failed`       | `pending`/`failed`  | no       | may retry to `pending_scan`                     |

Domain: `packages/domain/src/document.ts` (`DOCUMENT_TRANSITIONS`, `transitionDocument`, `assertDocumentReadable`).
DB: `0016_phase6_clinical.sql` CHECKs:

- `status <> 'available' OR scan_status = 'clean'`
- `status <> 'quarantined' OR scan_status = 'malicious'`

Quarantine is **terminal**: no transition to `available` even with a later clean scan.

## Scan pipeline

```text
uploadDocument (checksum + storage put)
  → status initialized
  → advanceDocumentScan(scan_status: clean | malicious | failed)
  → available | quarantined | failed
```

Scan is a separate privileged step; upload does not mark available.

## HIGH_SENSITIVITY handling

- `data_class = 'HIGH_SENSITIVITY'` documents: download is **server-mediated only**.
- Response returns bytes from storage under PEP + RLS + checksum verify.
- No storage key, URL, or presigned link is ever returned to the client.
- `isHighSensitivity(document)` drives the flag in service responses.

## DocumentStorage port

```text
DocumentStorage
  put(key, bytes): Promise<void>
  get(key): Promise<Uint8Array>
```

- `MemoryDocumentStorage` — tests and local dev only (not production).
- Production implementations (S3/GCS/etc.) land in later hardening; port is frozen now so services depend on the abstraction.
- Storage keys: `persons/{personId}/documents/{documentId}` — person-scoped, no shared prefixes across persons.

## No destructive delete

- **No RLS DELETE policy** on `documents` — application role cannot DELETE.
- Service exposes no `deleteDocument`.
- Lifecycle ends at `quarantined` or remains `available`; retention/soft-delete is Phase 11.

## Integrity (checksum)

- Upload computes `sha256(bytes)` → `checksum_sha256` (64 hex).
- Download re-hashes stored bytes; mismatch → `conflict` (Checksum mismatch), no bytes returned.
- Domain `createDocument` rejects non-64-hex checksums.

## Access control

- **PEP:** `authorizeClinical` with category `document_read`, action `read`/`create`/`update`.
- **RLS:** `can_read_health(person_id, 'document_read', NULL)` for SELECT; INSERT/UPDATE require professional principal + same category.
- Cross-person: `PERSON_MISMATCH` at PEP; 0 rows at RLS → service `not_found`.
- `not_found` used for all existence-hide paths (no 403 vs 404 oracle).

## Tests

- Domain: `packages/domain/src/document.test.ts`
- Integration: `apps/api/src/clinical/documents.integration.test.ts`
  - upload → scan → available → download
  - quarantine blocks download
  - checksum mismatch rejected
  - cross-person deny
  - HIGH_SENSITIVITY no key leak
  - no DELETE (RLS)
- RLS matrix: `apps/api/src/clinical/clinical-rls.integration.test.ts`
