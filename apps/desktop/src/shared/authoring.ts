import type { DefinitionValidation } from '@ojt/content';

export type AuthoringRequest =
  | { action: 'choose-directory' | 'open-directory' | 'open' | 'draft-load' }
  | { action: 'template'; id: string }
  | { action: 'validate' | 'save'; text: string }
  | { action: 'draft-save'; draft: AuthoringDraft };
export type AuthoringResult =
  | {
      ok: true;
      directory?: string;
      text?: string;
      path?: string;
      validation?: DefinitionValidation;
      draft?: AuthoringDraft;
      warning?: string;
    }
  | { ok: false; canceled?: boolean; message: string; validation?: DefinitionValidation };

export const MAX_DEFINITION_BYTES = 5 * 1024 * 1024;

/** 配布用の課題JSONとは別の下書き。構文が未完成でも保存できる。 */
export interface AuthoringDraft {
  formatVersion: 1;
  text: string;
  savedText: string;
  templateId: string;
  savedDirectory: string;
  savedAt: string;
}
