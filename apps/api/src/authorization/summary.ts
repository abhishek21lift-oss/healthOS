/**
 * Person-facing access summary (Phase 5): who has access, categories, purposes, basis.
 * Does not expose internal deny reason catalogs or policy internals.
 */
import { runInSystemContext } from '@health-os/database';

import { AuthorizationError, type AuthorizationActor, type AuthorizationDeps } from './types.js';

export interface AccessSummaryEntry {
  readonly granteeProfessionalId: string;
  readonly displayName: string | null;
  readonly status: string;
  readonly category: string;
  readonly purpose: string;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date | null;
  readonly consentRevisionId: string | null;
  readonly consentRevisionNumber: number | null;
  readonly consentStatus: string | null;
}

export async function getAccessSummary(
  deps: AuthorizationDeps,
  actor: AuthorizationActor,
  input: { readonly personId: string },
): Promise<AccessSummaryEntry[]> {
  if (actor.personId === null || actor.personId !== input.personId) {
    throw new AuthorizationError('forbidden', 'Person may only view own access summary');
  }
  const rows = await runInSystemContext(deps.pool, 'authz:access_summary', async (client) => {
    const res = await client.query<{
      grantee_professional_id: string;
      display_name: string | null;
      status: string;
      category: string;
      purpose: string;
      effective_from: Date;
      effective_until: Date | null;
      consent_revision_id: string | null;
      revision_number: number | null;
      consent_status: string | null;
    }>(
      `SELECT ag.grantee_professional_id,
              p.display_name,
              ag.status,
              ag.category,
              ag.purpose,
              ag.effective_from,
              ag.effective_until,
              ag.consent_revision_id,
              cr.revision_number,
              c.status AS consent_status
       FROM access_grants ag
       LEFT JOIN professionals p ON p.professional_id = ag.grantee_professional_id
       LEFT JOIN consent_revisions cr ON cr.consent_revision_id = ag.consent_revision_id
       LEFT JOIN consents c ON c.consent_id = cr.consent_id
       WHERE ag.person_id = $1
       ORDER BY ag.status, ag.category, ag.purpose`,
      [input.personId],
    );
    return res.rows;
  });
  return rows.map((r) => ({
    granteeProfessionalId: r.grantee_professional_id,
    displayName: r.display_name,
    status: r.status,
    category: r.category,
    purpose: r.purpose,
    effectiveFrom: r.effective_from,
    effectiveUntil: r.effective_until,
    consentRevisionId: r.consent_revision_id,
    consentRevisionNumber: r.revision_number,
    consentStatus: r.consent_status,
  }));
}
