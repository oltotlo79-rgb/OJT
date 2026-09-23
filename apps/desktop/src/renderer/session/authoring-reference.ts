import { BoardRefSchema, LadderProgramSchema, PlcRefSchema, type BoardRef } from '@ojt/content';
import { JIPM_BOARD, withBoardProfile, type BoardDefinition } from '@ojt/board-model';
import {
  deleteNetwork,
  deleteRow,
  empty,
  insertNetwork,
  insertRow,
  network,
  type LadderProgram,
} from '@ojt/ladder-core';
import { getDialect, type DialectProfile } from '@ojt/plc-dialects';
import type { SchematicDocument } from '@ojt/schematic-core';
import { isRecord, toLadderProgram, toSchematicDoc } from '../../shared/work-file-schema.js';
import { createAppStore } from '../app/store.js';
import { nextNetworkId, clampLadderCursor } from './ladder.js';

export type AuthoringReference =
  | { kind: 'schematic'; board: BoardRef; definition: BoardDefinition; document: SchematicDocument }
  | {
      kind: 'ladder';
      profile: DialectProfile;
      program: LadderProgram;
      comments: Record<string, string>;
    };

/** Unfinished circuits must be reopenable. Publication uses the full content validator. */
export function readAuthoringReference(value: unknown): AuthoringReference | string {
  if (!isRecord(value)) return '課題定義JSONを読み込めません。JSONの書式を確認してください。';
  if (value['mode'] === 'plc') {
    const plc = PlcRefSchema.safeParse(value['plc']);
    const normalized = LadderProgramSchema.safeParse(value['referenceLadder']);
    const ladder = toLadderProgram(normalized.success ? normalized.data : value['referenceLadder']);
    if (!plc.success || ladder === undefined)
      return 'PLCの機種またはラダーのデータ形式を確認してください。詳細JSONの編集、またはテンプレートの複製から修正できます。';
    return { kind: 'ladder', profile: getDialect(plc.data.vendor), ...ladder };
  }
  if (value['mode'] === 'assemble' || value['mode'] === 'inspect-repair') {
    const board = BoardRefSchema.safeParse(value['board']);
    const document = toSchematicDoc(value['schematic']);
    if (!board.success || document === undefined || document.rungs.length === 0)
      return '盤の設定または回路図のデータ形式を確認してください。詳細JSONの編集、またはテンプレートの複製から修正できます。';
    return {
      kind: 'schematic',
      board: board.data,
      definition: withBoardProfile(JIPM_BOARD, board.data.profile),
      document,
    };
  }
  return '部品点検は「部品点検の出題部品」から編集してください。';
}

/** An independent editor store. No session or Worker is opened. */
export function createReferenceStore(
  reference: AuthoringReference,
): ReturnType<typeof createAppStore> {
  const store = createAppStore();
  if (reference.kind === 'schematic')
    store.getState().setSchematicDoc(structuredClone(reference.document));
  else {
    store.getState().restoreLadder(structuredClone(reference.program), reference.comments);
    store.setState({
      dialectId: reference.profile.id,
      ladderMode: 'write',
      ladderCursor: { networkId: reference.program.networks[0]?.id ?? '', row: 0, col: 0 },
    });
  }
  return store;
}

export function editReferenceNetwork(
  store: ReturnType<typeof createAppStore>,
  command: string,
): void {
  const state = store.getState();
  const source = state.ladder;
  if (source === undefined) return;
  const at = state.ladderCursor;
  const current = source.networks.findIndex((net) => net.id === at.networkId);
  const endAt = source.networks.findIndex((net) => net.cells[0]?.[0]?.kind === 'end');
  try {
    if (command === 'insert-network' || command === 'insert-network-above') {
      const id = nextNetworkId(source);
      const requested = command === 'insert-network-above' ? Math.max(0, current) : current + 1;
      const index = Math.min(requested, endAt < 0 ? source.networks.length : endAt);
      state.setLadder(insertNetwork(source, index, network(id, [[empty()]])));
      state.setLadderCursor({ networkId: id, row: 0, col: 0 });
    } else if (command === 'delete-network') {
      if (current === endAt || source.networks.length <= 2) {
        state.toast('ENDと最後の回路ブロックは残します。記号を選んで削除することはできます。');
        return;
      }
      const changed = deleteNetwork(source, at.networkId);
      state.setLadder(changed);
      state.setLadderCursor(clampLadderCursor(changed, at));
    } else if (command === 'insert-row' || command === 'delete-row') {
      if (current === endAt) {
        state.toast('ENDの行は変更できません。別の回路ブロックを選んでください。');
        return;
      }
      const changed =
        command === 'insert-row'
          ? insertRow(source, at.networkId, at.row + 1)
          : deleteRow(source, at.networkId, at.row);
      state.setLadder(changed);
      state.setLadderCursor(clampLadderCursor(changed, at));
    } else state.toast('動作確認は編集を終えて「検証」を押してください。');
  } catch (error) {
    state.toast(error instanceof Error ? error.message : String(error), 'error');
  }
}
