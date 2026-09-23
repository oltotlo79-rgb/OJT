import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthoringDraft, AuthoringRequest, AuthoringResult } from '../src/shared/authoring.js';
import type * as DraftModule from '../src/renderer/session/authoring-draft.js';

const api = vi.hoisted(() => ({
  authorContent: vi.fn<(request: AuthoringRequest) => Promise<AuthoringResult>>(),
}));
vi.mock('../src/renderer/app/ojt-api.js', () => ({ tryOjtApi: () => api }));
let state: typeof DraftModule;
let stop: (() => void) | undefined;
const draft = (text: string): AuthoringDraft => ({
  formatVersion: 1,
  text,
  savedText: '',
  templateId: 'b-001',
  savedDirectory: '',
  savedAt: '2026-09-24T01:00:00Z',
});
beforeEach(async () => {
  vi.resetModules();
  api.authorContent.mockReset().mockResolvedValue({ ok: true });
  state = await import('../src/renderer/session/authoring-draft.js');
});
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.useRealTimers();
});

describe('N02: 画面から独立した下書きの保存順序', () => {
  it('前回の不完全なJSONを復元し、検証済みとは扱わない', async () => {
    api.authorContent.mockResolvedValue({ ok: true, draft: draft('{ unfinished') });
    stop = state.startAuthoringDraft();
    await state.flushAuthoringDraft();
    expect(state.useAuthoringDraft.getState()).toMatchObject({
      text: '{ unfinished',
      savedText: '',
      validation: undefined,
    });
    expect(api.authorContent).toHaveBeenCalledTimes(1);
  });
  it('読込が遅れても先に入力した内容を古い下書きへ戻さない', async () => {
    let finish: ((value: AuthoringResult) => void) | undefined;
    api.authorContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    stop = state.startAuthoringDraft();
    state.editAuthoringText('current input');
    finish!({ ok: true, draft: draft('old disk content') });
    expect(await state.flushAuthoringDraft()).toBe(true);
    expect(state.useAuthoringDraft.getState().text).toBe('current input');
    expect(api.authorContent.mock.calls.at(-1)![0]).toMatchObject({
      action: 'draft-save',
      draft: { text: 'current input' },
    });
  });
  it('1秒の変更待ちでまとめて保存し、表示を更新する', async () => {
    vi.useFakeTimers();
    stop = state.startAuthoringDraft();
    await state.flushAuthoringDraft();
    state.editAuthoringText('one');
    await vi.advanceTimersByTimeAsync(500);
    state.editAuthoringText('two');
    await vi.advanceTimersByTimeAsync(999);
    expect(api.authorContent.mock.calls.filter(([r]) => r.action === 'draft-save')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.authorContent.mock.calls.filter(([r]) => r.action === 'draft-save')).toHaveLength(1);
    expect(state.useAuthoringDraft.getState()).toMatchObject({ text: 'two', persistence: 'saved' });
  });
  it('保存中の変更を後続保存し、全て保存されるまで終了側の待機を完了しない', async () => {
    stop = state.startAuthoringDraft();
    await state.flushAuthoringDraft();
    let finish: ((value: AuthoringResult) => void) | undefined;
    api.authorContent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    state.editAuthoringText('first');
    const saving = state.flushAuthoringDraft();
    await vi.waitFor(() => expect(finish).toBeDefined());
    state.editAuthoringText('latest');
    expect(state.flushAuthoringDraft()).toBe(saving);
    finish!({ ok: true });
    expect(await saving).toBe(true);
    const writes = api.authorContent.mock.calls
      .map(([r]) => r)
      .filter((r) => r.action === 'draft-save');
    expect(writes.map((r) => r.draft.text)).toEqual(['first', 'latest']);
    expect(state.useAuthoringDraft.getState().persistence).toBe('saved');
  });
  it('保存失敗を成功扱いせず、同じ内容で再試行する', async () => {
    stop = state.startAuthoringDraft();
    await state.flushAuthoringDraft();
    state.editAuthoringText('keep me');
    api.authorContent.mockResolvedValueOnce({ ok: false, message: '容量不足' });
    expect(await state.flushAuthoringDraft()).toBe(false);
    expect(state.useAuthoringDraft.getState()).toMatchObject({
      text: 'keep me',
      persistence: 'failed',
      persistenceMessage: '容量不足',
    });
    expect(await state.retryAuthoringDraft()).toBe(true);
    expect(api.authorContent.mock.calls.at(-1)![0]).toMatchObject({ draft: { text: 'keep me' } });
  });
  it('読込失敗の再試行で、画面の未保存内容を上書きしない', async () => {
    api.authorContent.mockResolvedValueOnce({ ok: false, message: '読めません' });
    stop = state.startAuthoringDraft();
    await state.flushAuthoringDraft();
    state.editAuthoringText('new unsaved draft');
    expect(await state.flushAuthoringDraft()).toBe(false);
    api.authorContent.mockResolvedValueOnce({ ok: true, draft: draft('old content') });
    expect(await state.retryAuthoringDraft()).toBe(true);
    expect(state.useAuthoringDraft.getState().text).toBe('new unsaved draft');
  });
});
