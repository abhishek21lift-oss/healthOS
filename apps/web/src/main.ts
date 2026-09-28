/**
 * apps/web — presentation shell.
 * Consumes API contracts/validation/UI only. Must never import packages/database.
 * Phase 0: no framework, no pages, no UI features.
 */
import { defaultTheme, UI_CONTRACT_VERSION } from '@health-os/ui';
import { VALIDATION_TARGET_CONTRACT } from '@health-os/validation';

export interface WebShellStatus {
  readonly phase: 0;
  readonly uiContract: string;
  readonly validationContract: string;
  readonly theme: string;
  readonly databaseAccess: false;
}

export function webShellStatus(): WebShellStatus {
  return {
    phase: 0,
    uiContract: UI_CONTRACT_VERSION,
    validationContract: VALIDATION_TARGET_CONTRACT,
    theme: defaultTheme.name,
    databaseAccess: false,
  };
}
