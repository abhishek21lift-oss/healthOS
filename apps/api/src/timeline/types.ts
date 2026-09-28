/**
 * Phase 7 timeline types + deterministic entry identity.
 * Projection is a read model (ADR-0010); never a source of truth or authz DB.
 */
import { createHash } from 'node:crypto';

import type { Pool } from '@health-os/database';
import {
  TIMELINE_EVENT_KINDS,
  TIMELINE_SOURCE_TYPES,
  type TimelineEventKind,
  type TimelineSourceType,
} from '@health-os/domain';

import type { AuthorizationActor, AuthorizationDeps } from '../authorization/types.js';

export type TimelineActor = AuthorizationActor;
export type TimelineDeps = AuthorizationDeps & { readonly pool: Pool };

export type { TimelineEventKind, TimelineSourceType };

export class TimelineError extends Error {
  readonly code: 'forbidden' | 'not_found' | 'validation' | 'denied' | 'conflict';
  readonly externalMessage: string;
  readonly denyReason?: string;

  constructor(
    code: TimelineError['code'],
    externalMessage: string,
    options?: { cause?: unknown; denyReason?: string },
  ) {
    super(externalMessage, options);
    this.name = 'TimelineError';
    this.code = code;
    this.externalMessage = externalMessage;
    if (options?.denyReason !== undefined) {
      this.denyReason = options.denyReason;
    }
  }
}

export function isTimelineEventKind(value: string): value is TimelineEventKind {
  return (TIMELINE_EVENT_KINDS as readonly string[]).includes(value);
}

export function isTimelineSourceType(value: string): value is TimelineSourceType {
  return (TIMELINE_SOURCE_TYPES as readonly string[]).includes(value);
}

export interface TimelineEntry {
  readonly timelineEntryId: string;
  readonly personId: string;
  readonly eventType: TimelineEventKind;
  readonly sourceType: TimelineSourceType;
  readonly sourceId: string;
  readonly eventAt: number;
  readonly createdAt: number;
  readonly predecessorSourceId: string | null;
  readonly rootSourceId: string | null;
  readonly displayTitle: string | null;
  readonly displayStatus: string | null;
  readonly projectionVersion: number;
}

export interface TimelineFilters {
  readonly eventTypes?: readonly TimelineEventKind[];
  readonly sourceTypes?: readonly TimelineSourceType[];
  readonly from?: number;
  readonly to?: number;
}

export interface TimelinePage {
  readonly entries: readonly TimelineEntry[];
  readonly nextCursor: string | null;
}

/**
 * Deterministic identity: same (person, sourceType, sourceId) ⇒ same UUID.
 * Enables idempotent upsert and rebuild parity without random ids.
 */
export function timelineEntryId(
  personId: string,
  sourceType: TimelineSourceType,
  sourceId: string,
): string {
  const digest = createHash('sha256')
    .update(`timeline_entry:v1:${personId}:${sourceType}:${sourceId}`)
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export interface ProjectableEntry {
  readonly personId: string;
  readonly sourceType: TimelineSourceType;
  readonly sourceId: string;
  readonly eventType: TimelineEventKind;
  readonly eventAt: number;
  readonly predecessorSourceId?: string | null;
  readonly rootSourceId?: string | null;
  readonly displayTitle?: string | null;
  readonly displayStatus?: string | null;
}

export function assertProjectable(entry: ProjectableEntry): void {
  if (!isTimelineSourceType(entry.sourceType)) {
    throw new TimelineError('validation', 'Invalid source type');
  }
  if (!isTimelineEventKind(entry.eventType)) {
    throw new TimelineError('validation', 'Invalid event type');
  }
  if (entry.personId.length === 0 || entry.sourceId.length === 0) {
    throw new TimelineError('validation', 'Invalid timeline identity');
  }
}
