import { invalidTransition, DomainError } from './errors.js';
import { requireNonEmpty, requirePositiveNumber } from './primitives.js';
import type {
  CarePlanId,
  GoalId,
  InterventionId,
  OutcomeId,
  PersonId,
  ProfessionalId,
} from './ids.js';

const GOAL_TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  proposed: ['active', 'abandoned'],
  active: ['achieved', 'abandoned'],
  achieved: [],
  abandoned: [],
};
const CARE_PLAN_TRANSITIONS: Record<CarePlanStatus, readonly CarePlanStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};
const INTERVENTION_TRANSITIONS: Record<InterventionStatus, readonly InterventionStatus[]> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export type GoalStatus = 'proposed' | 'active' | 'achieved' | 'abandoned';

export interface GoalTarget {
  readonly metric: string;
  readonly targetValue: number;
  readonly unit: string;
}

export interface Goal {
  readonly goalId: GoalId;
  readonly personId: PersonId;
  readonly carePlanId: CarePlanId | null;
  readonly status: GoalStatus;
  readonly title: string;
  readonly target: GoalTarget | null;
  readonly createdByProfessionalId: ProfessionalId;
}

export function createGoal(input: {
  goalId: GoalId;
  personId: PersonId;
  carePlanId: CarePlanId | null;
  title: string;
  target: GoalTarget | null;
  createdByProfessionalId: ProfessionalId;
}): Goal {
  const target =
    input.target === null
      ? null
      : {
          metric: requireNonEmpty('Goal', 'target.metric', input.target.metric),
          targetValue: requirePositiveNumber(
            'Goal',
            'target.targetValue',
            input.target.targetValue,
          ),
          unit: requireNonEmpty('Goal', 'target.unit', input.target.unit),
        };
  return {
    goalId: input.goalId,
    personId: input.personId,
    carePlanId: input.carePlanId,
    status: 'proposed',
    title: requireNonEmpty('Goal', 'title', input.title),
    target,
    createdByProfessionalId: input.createdByProfessionalId,
  };
}

export function transitionGoal(goal: Goal, to: GoalStatus): Goal {
  const allowed = GOAL_TRANSITIONS[goal.status];
  if (!allowed.includes(to)) {
    throw invalidTransition('Goal', 'INVALID_GOAL_TRANSITION', goal.status, to);
  }
  return { ...goal, status: to };
}

export type CarePlanStatus = 'draft' | 'active' | 'completed' | 'cancelled';

export interface CarePlan {
  readonly carePlanId: CarePlanId;
  readonly personId: PersonId;
  readonly status: CarePlanStatus;
  readonly title: string;
  readonly createdByProfessionalId: ProfessionalId;
}

export function createCarePlan(input: {
  carePlanId: CarePlanId;
  personId: PersonId;
  title: string;
  createdByProfessionalId: ProfessionalId;
}): CarePlan {
  return {
    carePlanId: input.carePlanId,
    personId: input.personId,
    status: 'draft',
    title: requireNonEmpty('CarePlan', 'title', input.title),
    createdByProfessionalId: input.createdByProfessionalId,
  };
}

export function transitionCarePlan(plan: CarePlan, to: CarePlanStatus): CarePlan {
  const allowed = CARE_PLAN_TRANSITIONS[plan.status];
  if (!allowed.includes(to)) {
    throw invalidTransition('CarePlan', 'INVALID_CARE_PLAN_TRANSITION', plan.status, to);
  }
  return { ...plan, status: to };
}

export type InterventionStatus = 'planned' | 'in_progress' | 'completed' | 'cancelled';

export interface Intervention {
  readonly interventionId: InterventionId;
  readonly carePlanId: CarePlanId;
  readonly personId: PersonId;
  readonly status: InterventionStatus;
  readonly title: string;
}

export function createIntervention(input: {
  interventionId: InterventionId;
  carePlanId: CarePlanId;
  personId: PersonId;
  title: string;
}): Intervention {
  return {
    interventionId: input.interventionId,
    carePlanId: input.carePlanId,
    personId: input.personId,
    status: 'planned',
    title: requireNonEmpty('Intervention', 'title', input.title),
  };
}

export function transitionIntervention(
  intervention: Intervention,
  to: InterventionStatus,
): Intervention {
  const allowed = INTERVENTION_TRANSITIONS[intervention.status];
  if (!allowed.includes(to)) {
    throw invalidTransition(
      'Intervention',
      'INVALID_INTERVENTION_TRANSITION',
      intervention.status,
      to,
    );
  }
  return { ...intervention, status: to };
}

export type OutcomeStatus = 'recorded';

export interface Outcome {
  readonly outcomeId: OutcomeId;
  readonly personId: PersonId;
  readonly interventionId: InterventionId | null;
  readonly goalId: GoalId | null;
  readonly status: OutcomeStatus;
  readonly summary: string;
  readonly recordedAt: number;
}

export function recordOutcome(input: {
  outcomeId: OutcomeId;
  personId: PersonId;
  interventionId: InterventionId | null;
  goalId: GoalId | null;
  summary: string;
  recordedAt: number;
}): Outcome {
  if (input.interventionId === null && input.goalId === null) {
    throw new DomainError('INVALID_DOMAIN_VALUE', 'Outcome requires intervention or goal link', {
      entity: 'Outcome',
      reason: 'no_link',
    });
  }
  return {
    outcomeId: input.outcomeId,
    personId: input.personId,
    interventionId: input.interventionId,
    goalId: input.goalId,
    status: 'recorded',
    summary: requireNonEmpty('Outcome', 'summary', input.summary),
    recordedAt: input.recordedAt,
  };
}
