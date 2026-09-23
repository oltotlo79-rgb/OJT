import type { DefinitionValidation } from '@ojt/content';

export type AuthoringRequest =
  | { action: 'choose-directory' | 'open-directory' | 'open' }
  | { action: 'template'; id: string }
  | { action: 'validate' | 'save'; text: string };
export type AuthoringResult =
  | {
      ok: true;
      directory?: string;
      text?: string;
      path?: string;
      validation?: DefinitionValidation;
    }
  | { ok: false; canceled?: boolean; message: string; validation?: DefinitionValidation };

export const MAX_DEFINITION_BYTES = 5 * 1024 * 1024;
