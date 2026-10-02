/**
 * Synthetic fixture seed — runs as superuser (bypasses RLS for setup only).
 * No real health data.
 */

import type pg from 'pg';

export interface FixtureIds {
  readonly aliceId: string;
  readonly bobId: string;
  readonly doctorId: string;
  readonly nurseId: string;
  readonly adminId: string;
  readonly bobDoctorId: string;
  readonly orgId: string;
  readonly aliceCareTeamId: string;
  readonly aliceDoctorMembershipId: string;
  readonly aliceNurseMembershipId: string;
  readonly doctorGrantTimelineId: string;
  readonly doctorAssessmentId: string;
  readonly doctorPrivateNoteId: string;
  readonly nursePrivateNoteId: string;
}

export async function seedFixture(client: pg.PoolClient): Promise<FixtureIds> {
  // Immutable history tables: DELETE blocked by triggers — clear with TRUNCATE CASCADE.
  await client.query(`TRUNCATE person_access_logs, audit_logs, consent_revisions,
               organization_membership_history, collaboration_security_events CASCADE`);
  // Phase 3 identity tables (superuser seed only).
  await client.query('DELETE FROM auth_security_events');
  await client.query('DELETE FROM sessions');
  await client.query('DELETE FROM email_verification_tokens');
  await client.query('DELETE FROM contact_points');
  await client.query('DELETE FROM accounts');
  await client.query('DELETE FROM handoff_items');
  await client.query('DELETE FROM handoffs');
  await client.query('DELETE FROM outbox_events');
  await client.query('DELETE FROM timeline_entries');
  await client.query('DELETE FROM break_glass_records');
  await client.query('DELETE FROM private_professional_notes');
  await client.query('DELETE FROM documents');
  await client.query('DELETE FROM tasks');
  await client.query('DELETE FROM outcomes');
  await client.query('DELETE FROM interventions');
  await client.query('DELETE FROM goals');
  await client.query('DELETE FROM care_plans');
  await client.query('DELETE FROM assessments');
  await client.query('DELETE FROM observations');
  await client.query('DELETE FROM access_grants');
  await client.query('DELETE FROM access_requests');
  await client.query('DELETE FROM consents');
  await client.query('DELETE FROM person_professional_relationships');
  await client.query('DELETE FROM invitations');
  await client.query('DELETE FROM care_team_memberships');
  await client.query('DELETE FROM care_teams');
  await client.query('DELETE FROM organization_memberships');
  await client.query('DELETE FROM organizations');
  await client.query('DELETE FROM professionals');
  await client.query('DELETE FROM persons');
  const alice = await client.query<{ person_id: string }>(
    `INSERT INTO persons (display_name, is_adult) VALUES ('Alice Synthetic', true) RETURNING person_id`,
  );
  const bob = await client.query<{ person_id: string }>(
    `INSERT INTO persons (display_name, is_adult) VALUES ('Bob Synthetic', true) RETURNING person_id`,
  );
  const doctor = await client.query<{ professional_id: string }>(
    `INSERT INTO professionals (display_name) VALUES ('Dr Doctor') RETURNING professional_id`,
  );
  const nurse = await client.query<{ professional_id: string }>(
    `INSERT INTO professionals (display_name) VALUES ('N Nurse') RETURNING professional_id`,
  );
  const admin = await client.query<{ professional_id: string }>(
    `INSERT INTO professionals (display_name) VALUES ('A Admin') RETURNING professional_id`,
  );
  const bobDoctor = await client.query<{ professional_id: string }>(
    `INSERT INTO professionals (display_name) VALUES ('Dr Bob') RETURNING professional_id`,
  );
  const org = await client.query<{ organization_id: string }>(
    `INSERT INTO organizations (name) VALUES ('Synthetic Clinic') RETURNING organization_id`,
  );
  const aliceId = alice.rows[0]?.person_id ?? '';
  const bobId = bob.rows[0]?.person_id ?? '';
  const doctorId = doctor.rows[0]?.professional_id ?? '';
  const nurseId = nurse.rows[0]?.professional_id ?? '';
  const adminId = admin.rows[0]?.professional_id ?? '';
  const bobDoctorId = bobDoctor.rows[0]?.professional_id ?? '';
  const orgId = org.rows[0]?.organization_id ?? '';
  // Admin is org member only — never a health-read predicate by itself (I-3).
  await client.query(
    `INSERT INTO organization_memberships (organization_id, professional_id, status, role)
     VALUES ($1, $2, 'active', 'admin')`,
    [orgId, adminId],
  );
  await client.query(
    `INSERT INTO organization_memberships (organization_id, professional_id, status, role)
     VALUES ($1, $2, 'active', 'staff')`,
    [orgId, doctorId],
  );
  const careTeam = await client.query<{ care_team_id: string }>(
    `INSERT INTO care_teams (person_id, status) VALUES ($1, 'open') RETURNING care_team_id`,
    [aliceId],
  );
  const aliceCareTeamId = careTeam.rows[0]?.care_team_id ?? '';
  const doctorM = await client.query<{ membership_id: string }>(
    `INSERT INTO care_team_memberships (care_team_id, person_id, professional_id, status)
     VALUES ($1, $2, $3, 'active') RETURNING membership_id`,
    [aliceCareTeamId, aliceId, doctorId],
  );
  const nurseM = await client.query<{ membership_id: string }>(
    `INSERT INTO care_team_memberships (care_team_id, person_id, professional_id, status)
     VALUES ($1, $2, $3, 'active') RETURNING membership_id`,
    [aliceCareTeamId, aliceId, nurseId],
  );
  const aliceDoctorMembershipId = doctorM.rows[0]?.membership_id ?? '';
  const aliceNurseMembershipId = nurseM.rows[0]?.membership_id ?? '';
  const bobTeam = await client.query<{ care_team_id: string }>(
    `INSERT INTO care_teams (person_id, status) VALUES ($1, 'open') RETURNING care_team_id`,
    [bobId],
  );
  const bobCareTeamId = bobTeam.rows[0]?.care_team_id ?? '';
  await client.query(
    `INSERT INTO care_team_memberships (care_team_id, person_id, professional_id, status)
     VALUES ($1, $2, $3, 'active')`,
    [bobCareTeamId, bobId, bobDoctorId],
  );
  const consent = await client.query<{ consent_id: string }>(
    `INSERT INTO consents (person_id, grantee_professional_id, status)
     VALUES ($1, $2, 'active') RETURNING consent_id`,
    [aliceId, doctorId],
  );
  const consentId = consent.rows[0]?.consent_id ?? '';
  const revision = await client.query<{ consent_revision_id: string }>(
    `INSERT INTO consent_revisions (
       consent_id, revision_number, person_id, grantee_professional_id,
       categories, purposes, status, effective_from, issued_by_person_id
     ) VALUES ($1, 1, $2, $3, ARRAY['timeline_read','assessment_read','assessment_write']::text[],
       ARRAY['treatment']::text[], 'active', now(), $2)
     RETURNING consent_revision_id`,
    [consentId, aliceId, doctorId],
  );
  const revisionId = revision.rows[0]?.consent_revision_id ?? '';
  const grant = await client.query<{ access_grant_id: string }>(
    `INSERT INTO access_grants (
       person_id, grantee_professional_id, category, purpose, status,
       relationship_class, membership_id, consent_revision_id
     ) VALUES ($1, $2, 'timeline_read', 'treatment', 'active', 'care_team_member', $3, $4)
     RETURNING access_grant_id`,
    [aliceId, doctorId, aliceDoctorMembershipId, revisionId],
  );
  await client.query(
    `INSERT INTO access_grants (
       person_id, grantee_professional_id, category, purpose, status,
       relationship_class, membership_id, consent_revision_id
     ) VALUES ($1, $2, 'assessment_read', 'treatment', 'active', 'care_team_member', $3, $4)`,
    [aliceId, doctorId, aliceDoctorMembershipId, revisionId],
  );
  await client.query(
    `INSERT INTO access_grants (
       person_id, grantee_professional_id, category, purpose, status,
       relationship_class, membership_id, consent_revision_id
     ) VALUES ($1, $2, 'assessment_write', 'treatment', 'active', 'care_team_member', $3, $4)`,
    [aliceId, doctorId, aliceDoctorMembershipId, revisionId],
  );
  // Nurse: care team membership WITHOUT AccessGrant (I-1: deny).
  // Bob doctor: care team for bob, no alice grant.
  await client.query(
    `INSERT INTO observations (person_id, code, value_numeric, unit, data_class)
     VALUES ($1, 'heart_rate', 72, 'bpm', 'SHARED_HEALTH')`,
    [aliceId],
  );
  await client.query(
    `INSERT INTO observations (person_id, code, value_numeric, unit, data_class)
     VALUES ($1, 'heart_rate', 80, 'bpm', 'SHARED_HEALTH')`,
    [bobId],
  );
  const assessment = await client.query<{ assessment_id: string }>(
    `INSERT INTO assessments (person_id, author_professional_id, status, title, body, version)
     VALUES ($1, $2, 'draft', 'Synthetic assessment', 'body', 1)
     RETURNING assessment_id`,
    [aliceId, doctorId],
  );
  const doctorAssessmentId = assessment.rows[0]?.assessment_id ?? '';
  const doctorNote = await client.query<{ note_id: string }>(
    `INSERT INTO private_professional_notes (
       person_id, author_professional_id, status, data_class, body
     ) VALUES ($1, $2, 'active', 'PROFESSIONAL_PRIVATE', 'doctor-only note')
     RETURNING note_id`,
    [aliceId, doctorId],
  );
  const nurseNote = await client.query<{ note_id: string }>(
    `INSERT INTO private_professional_notes (
       person_id, author_professional_id, status, data_class, body
     ) VALUES ($1, $2, 'active', 'PROFESSIONAL_PRIVATE', 'nurse-only note')
     RETURNING note_id`,
    [aliceId, nurseId],
  );
  return {
    aliceId,
    bobId,
    doctorId,
    nurseId,
    adminId,
    bobDoctorId,
    orgId,
    aliceCareTeamId,
    aliceDoctorMembershipId,
    aliceNurseMembershipId,
    doctorGrantTimelineId: grant.rows[0]?.access_grant_id ?? '',
    doctorAssessmentId,
    doctorPrivateNoteId: doctorNote.rows[0]?.note_id ?? '',
    nursePrivateNoteId: nurseNote.rows[0]?.note_id ?? '',
  };
}
