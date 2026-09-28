/**
 * Goals, CarePlans, Interventions, Outcomes — Phase 6 clinical services.
 * Each op: PEP (category+purpose+action) → domain lifecycle → SQL under RLS.
 */
import {
  createCarePlan,
  createGoal,
  createIntervention,
  carePlanId,
  goalId,
  interventionId,
  outcomeId,
  recordOutcome,
  transitionCarePlan,
  transitionGoal,
  transitionIntervention,
  type CarePlan,
  type Goal,
  type Intervention,
  type Outcome,
} from '@health-os/domain';

import { authorizeClinical, runClinicalAsPrincipal } from './pep.js';
import { queueTimelineProjection } from '../timeline/outbox.js';
import {
  ClinicalError,
  requireProfessional,
  toClinicalError,
  type ClinicalActor,
  type ClinicalDeps,
} from './types.js';

function wrapDomain<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    throw toClinicalError(error);
  }
}

export interface CreateGoalInput {
  readonly personId: string;
  readonly carePlanId?: string | null;
  readonly title: string;
  readonly target?: { metric: string; targetValue: number; unit: string } | null;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function createGoalRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: CreateGoalInput,
): Promise<Goal> {
  const professionalId = requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'goal_write',
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  const domain = wrapDomain(() =>
    createGoal({
      goalId: goalId(crypto.randomUUID()),
      personId: input.personId as never,
      carePlanId: (input.carePlanId ?? null) as never,
      title: input.title,
      target: input.target ?? null,
      createdByProfessionalId: professionalId as never,
    }),
  );
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query(
        `INSERT INTO goals (
           goal_id, person_id, care_plan_id, status, title, target_metric, target_value, target_unit,
           created_by_professional_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          domain.goalId,
          domain.personId,
          domain.carePlanId,
          domain.status,
          domain.title,
          domain.target?.metric ?? null,
          domain.target?.targetValue ?? null,
          domain.target?.unit ?? null,
          domain.createdByProfessionalId,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected goal insert');
      }
      await queueTimelineProjection(client, {
        personId: domain.personId,
        sourceType: 'goal',
        sourceId: domain.goalId,
      });
      return domain;
    },
  );
}

export interface TransitionGoalInput {
  readonly personId: string;
  readonly goalId: string;
  readonly to: Goal['status'];
  readonly purpose: string;
  readonly requestId?: string;
}

export async function transitionGoalRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: TransitionGoalInput,
): Promise<Goal> {
  requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'goal_write',
    purpose: input.purpose,
    action: 'update',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const cur = await client.query<{
        goal_id: string;
        person_id: string;
        care_plan_id: string | null;
        status: string;
        title: string;
        target_metric: string | null;
        target_value: number | null;
        target_unit: string | null;
        created_by_professional_id: string;
      }>(
        `SELECT goal_id, person_id, care_plan_id, status, title, target_metric, target_value,
                target_unit, created_by_professional_id
         FROM goals WHERE goal_id = $1 AND person_id = $2`,
        [input.goalId, input.personId],
      );
      const row = cur.rows[0];
      if (row === undefined) {
        throw new ClinicalError('not_found', 'Not found');
      }
      const goal: Goal = {
        goalId: row.goal_id as never,
        personId: row.person_id as never,
        carePlanId: row.care_plan_id as never,
        status: row.status as Goal['status'],
        title: row.title,
        target:
          row.target_metric === null || row.target_value === null || row.target_unit === null
            ? null
            : {
                metric: row.target_metric,
                targetValue: row.target_value,
                unit: row.target_unit,
              },
        createdByProfessionalId: row.created_by_professional_id as never,
      };
      const next = wrapDomain(() => transitionGoal(goal, input.to));
      const res = await client.query(
        `UPDATE goals SET status = $1, updated_at = now() WHERE goal_id = $2 AND person_id = $3`,
        [next.status, input.goalId, input.personId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('invalid_state', 'Goal transition rejected');
      }
      await queueTimelineProjection(client, {
        personId: input.personId,
        sourceType: 'goal',
        sourceId: input.goalId,
      });
      return next;
    },
  );
}

export interface CreateCarePlanInput {
  readonly personId: string;
  readonly title: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function createCarePlanRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: CreateCarePlanInput,
): Promise<CarePlan> {
  const professionalId = requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'care_plan_write',
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  const domain = wrapDomain(() =>
    createCarePlan({
      carePlanId: carePlanId(crypto.randomUUID()),
      personId: input.personId as never,
      title: input.title,
      createdByProfessionalId: professionalId as never,
    }),
  );
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query(
        `INSERT INTO care_plans (care_plan_id, person_id, status, title, created_by_professional_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          domain.carePlanId,
          domain.personId,
          domain.status,
          domain.title,
          domain.createdByProfessionalId,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected care plan insert');
      }
      await queueTimelineProjection(client, {
        personId: domain.personId,
        sourceType: 'care_plan',
        sourceId: domain.carePlanId,
      });
      return domain;
    },
  );
}

export interface TransitionCarePlanInput {
  readonly personId: string;
  readonly carePlanId: string;
  readonly to: CarePlan['status'];
  readonly purpose: string;
  readonly requestId?: string;
}

export async function transitionCarePlanRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: TransitionCarePlanInput,
): Promise<CarePlan> {
  requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'care_plan_write',
    purpose: input.purpose,
    action: 'update',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const cur = await client.query<{
        care_plan_id: string;
        person_id: string;
        status: string;
        title: string;
        created_by_professional_id: string;
      }>(
        `SELECT care_plan_id, person_id, status, title, created_by_professional_id
         FROM care_plans WHERE care_plan_id = $1 AND person_id = $2`,
        [input.carePlanId, input.personId],
      );
      const row = cur.rows[0];
      if (row === undefined) {
        throw new ClinicalError('not_found', 'Not found');
      }
      const plan: CarePlan = {
        carePlanId: row.care_plan_id as never,
        personId: row.person_id as never,
        status: row.status as CarePlan['status'],
        title: row.title,
        createdByProfessionalId: row.created_by_professional_id as never,
      };
      const next = wrapDomain(() => transitionCarePlan(plan, input.to));
      const res = await client.query(
        `UPDATE care_plans SET status = $1, updated_at = now()
         WHERE care_plan_id = $2 AND person_id = $3`,
        [next.status, input.carePlanId, input.personId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('invalid_state', 'Care plan transition rejected');
      }
      await queueTimelineProjection(client, {
        personId: input.personId,
        sourceType: 'care_plan',
        sourceId: input.carePlanId,
      });
      return next;
    },
  );
}

export interface CreateInterventionInput {
  readonly personId: string;
  readonly carePlanId: string;
  readonly title: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function createInterventionRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: CreateInterventionInput,
): Promise<Intervention> {
  requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'care_plan_write',
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  const domain = wrapDomain(() =>
    createIntervention({
      interventionId: interventionId(crypto.randomUUID()),
      carePlanId: input.carePlanId as never,
      personId: input.personId as never,
      title: input.title,
    }),
  );
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query(
        `INSERT INTO interventions (intervention_id, care_plan_id, person_id, status, title)
         VALUES ($1, $2, $3, $4, $5)`,
        [domain.interventionId, domain.carePlanId, domain.personId, domain.status, domain.title],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected intervention insert');
      }
      await queueTimelineProjection(client, {
        personId: domain.personId,
        sourceType: 'intervention',
        sourceId: domain.interventionId,
      });
      return domain;
    },
  );
}

export interface TransitionInterventionInput {
  readonly personId: string;
  readonly interventionId: string;
  readonly to: Intervention['status'];
  readonly purpose: string;
  readonly requestId?: string;
}

export async function transitionInterventionRecord(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: TransitionInterventionInput,
): Promise<Intervention> {
  requireProfessional(actor);
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category: 'care_plan_write',
    purpose: input.purpose,
    action: 'update',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const cur = await client.query<{
        intervention_id: string;
        care_plan_id: string;
        person_id: string;
        status: string;
        title: string;
      }>(
        `SELECT intervention_id, care_plan_id, person_id, status, title
         FROM interventions WHERE intervention_id = $1 AND person_id = $2`,
        [input.interventionId, input.personId],
      );
      const row = cur.rows[0];
      if (row === undefined) {
        throw new ClinicalError('not_found', 'Not found');
      }
      const domain: Intervention = {
        interventionId: row.intervention_id as never,
        carePlanId: row.care_plan_id as never,
        personId: row.person_id as never,
        status: row.status as Intervention['status'],
        title: row.title,
      };
      const next = wrapDomain(() => transitionIntervention(domain, input.to));
      const res = await client.query(
        `UPDATE interventions SET status = $1, updated_at = now()
         WHERE intervention_id = $2 AND person_id = $3`,
        [next.status, input.interventionId, input.personId],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('invalid_state', 'Intervention transition rejected');
      }
      await queueTimelineProjection(client, {
        personId: input.personId,
        sourceType: 'intervention',
        sourceId: input.interventionId,
      });
      return next;
    },
  );
}

export interface RecordOutcomeInput {
  readonly personId: string;
  readonly interventionId?: string | null;
  readonly goalId?: string | null;
  readonly summary: string;
  readonly purpose: string;
  readonly requestId?: string;
}

export async function recordOutcomeEntry(
  deps: ClinicalDeps,
  actor: ClinicalActor,
  input: RecordOutcomeInput,
): Promise<Outcome> {
  requireProfessional(actor);
  const category =
    input.goalId != null && input.interventionId == null ? 'goal_write' : 'care_plan_write';
  await authorizeClinical(deps, actor, {
    personId: input.personId,
    category,
    purpose: input.purpose,
    action: 'create',
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  });
  const now = Date.now();
  const domain = wrapDomain(() =>
    recordOutcome({
      outcomeId: outcomeId(crypto.randomUUID()),
      personId: input.personId as never,
      interventionId: (input.interventionId ?? null) as never,
      goalId: (input.goalId ?? null) as never,
      summary: input.summary,
      recordedAt: now,
    }),
  );
  return runClinicalAsPrincipal(
    deps,
    actor,
    {
      purpose: input.purpose,
      ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
    },
    async (client) => {
      const res = await client.query(
        `INSERT INTO outcomes (outcome_id, person_id, intervention_id, goal_id, status, summary, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0))`,
        [
          domain.outcomeId,
          domain.personId,
          domain.interventionId,
          domain.goalId,
          domain.status,
          domain.summary,
          domain.recordedAt,
        ],
      );
      if ((res.rowCount ?? 0) === 0) {
        throw new ClinicalError('denied', 'RLS rejected outcome insert');
      }
      await queueTimelineProjection(client, {
        personId: domain.personId,
        sourceType: 'outcome',
        sourceId: domain.outcomeId,
      });
      return domain;
    },
  );
}
