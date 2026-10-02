/**
 * packages/ui — pure presentation primitives (CONTRACT-v0.2).
 * No authorization decisions, no database access, no clinical policy, no AI logic.
 * Phase 0: token/shell placeholders only — no product UI.
 */
export const UI_CONTRACT_VERSION = '0.2' as const;

export interface UiTheme {
  readonly name: string;
  readonly radiusPx: number;
}

export const defaultTheme: UiTheme = {
  name: 'default',
  radiusPx: 6,
};
