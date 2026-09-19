import { PLC_UNIT_FX5U, plcUnitFor } from '@ojt/board-model';
import { isPlcProblem, resolvePlcIo, type PlcProblem } from '@ojt/content';
import {
  deleteNetwork,
  deleteRow,
  empty,
  insertNetwork,
  insertRow,
  LadderError,
  network,
  type LadderProgram,
  type Network,
} from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { useCallback, useMemo, type JSX } from 'react';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { errorCellKeys, runConvert } from '../session/ladder-errors.js';
import { nextNetworkId, type LadderEditorMode } from '../session/ladder.js';
import { CommentPanel } from './CommentPanel.js';
import { IoTable } from './IoTable.js';
import { LadderEditor } from './LadderEditor.js';
import { OutputWindow } from './OutputWindow.js';
import { ProjectTree } from './ProjectTree.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import styles from './ladder.module.css';

/**
 * GX Works3“風”のワークスペース。設計仕様 §10.6。
 *
 * 画面の構成（ナビゲーションウィンドウ・ラダーエディタ・出力ウィンドウ）とツールバーの項目名は
 * すべて `DialectProfile.panels` から引く。**各社のロゴ・アイコン・画面キャプチャ・図記号
 * ビットマップは一切使わない**（§17 / PLC調査資料 §6）。
 */

/** ツールバーの項目 → 押したときの意味。`profile.panels.toolbar` の並び順で引く。 */
type ToolbarAction =
  | 'convert'
  | 'convert-all'
  | 'write-mode'
  | 'read-mode'
  | 'online'
  | 'download'
  | 'monitor-start'
  | 'monitor-stop';

/** `panels.toolbar` の並び（§10.6 のスキン定義と同じ順）に対応させる。 */
const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
  'convert',
  'convert-all',
  'write-mode',
  'read-mode',
  'online',
  'download',
  'monitor-start',
  'monitor-stop',
];

/**
 * END ネットワークか。IR には印が無いので `END` セルの有無で見る（決定表#15）。
 * END は必ず最後に来る（`compile()` の `missing-end`）ので、回路ブロックの挿入位置は
 * ここより前に丸め、END そのものは削除させない。
 */
function isEndNetwork(net: Network): boolean {
  return net.cells[0]?.[0]?.kind === 'end';
}

/** 新しい回路ブロックを入れる位置（カーソルの次。ただし END の手前まで）。 */
function insertIndexFor(program: LadderProgram, networkId: string): number {
  const at = program.networks.findIndex((net) => net.id === networkId);
  const after = at < 0 ? 0 : at + 1;
  const endAt = program.networks.findIndex((net) => isEndNetwork(net));
  return endAt < 0 ? after : Math.min(after, endAt);
}

/** ラダーのワークスペース。 */
export function LadderWorkspace({
  problem,
  profile,
  gridCols,
  onPlc,
}: {
  problem: PlcProblem;
  profile: DialectProfile;
  gridCols: number;
  /** Worker への `plc` コマンド（親がブリッジへ流す）。§10.4 */
  onPlc: (action: PlcCommandAction) => void;
}): JSX.Element {
  const program = useStore((s) => s.ladder);
  const cursor = useStore((s) => s.ladderCursor);
  const comments = useStore((s) => s.ladderComments);
  const issues = useStore((s) => s.convertIssues);
  const converted = useStore((s) => s.converted);
  const io = useMemo(() => resolvePlcIo(problem.io), [problem]);
  /** 機種の端子名はここから引く（決定表#16）。課題の機種が未対応なら FX5U に倒す。 */
  const unit = useMemo(() => plcUnitFor(problem.plc.model) ?? PLC_UNIT_FX5U, [problem]);
  const errorCells = useMemo(() => errorCellKeys(issues.errors), [issues]);

  /** 「変換」。成功したときだけ Worker へ載せる（H-1）。§10.6 */
  const convert = useCallback((): void => {
    const store = useStore.getState();
    const current = store.ladder;
    if (current === undefined) return;
    const run = runConvert(current, profile);
    store.setConverted(run.ok, run.issues);
    if (!run.ok) {
      store.toast(JA.ladder.convertFailed, 'error');
      return;
    }
    onPlc({ kind: 'load', program: current });
    store.toast(JA.ladder.convertOk);
  }, [onPlc, profile]);

  /** 書込み／読出し／モニタ。モニタの開始停止は Worker にも伝える（決定表#5）。 */
  const changeMode = useCallback(
    (mode: LadderEditorMode): void => {
      useStore.getState().setLadderMode(mode);
      onPlc({ kind: 'monitor', on: mode === 'monitor' });
    },
    [onPlc],
  );

  /**
   * 回路ブロック・行の編集。`edit.ts` の7関数は境界で `LadderError` を投げるので、
   * ここで捕まえて理由をトーストに出す（投げたままだと押した瞬間に画面が落ちる）。
   */
  const edit = useCallback((run: () => LadderProgram): boolean => {
    const store = useStore.getState();
    try {
      store.setLadder(run());
      return true;
    } catch (error) {
      if (!(error instanceof LadderError)) throw error;
      store.toast(error.message, 'error');
      return false;
    }
  }, []);

  if (program === undefined || !isPlcProblem(problem)) {
    return <div className={styles.workspace} data-testid="ladder-workspace" />;
  }

  const currentNetwork = program.networks.find((net) => net.id === cursor.networkId);

  const onToolbar = (action: ToolbarAction): void => {
    const store = useStore.getState();
    switch (action) {
      case 'convert':
      case 'convert-all':
        convert();
        break;
      case 'write-mode':
        changeMode('write');
        break;
      case 'read-mode':
        changeMode('read');
        break;
      case 'online':
      case 'download':
        // 本アプリでは「変換」がそのまま書込みに当たる（意図的な差分 #2）
        if (!store.converted) {
          store.toast(JA.ladder.notConverted, 'error');
          break;
        }
        onPlc({ kind: 'load', program });
        store.toast(JA.ladder.downloaded);
        break;
      case 'monitor-start':
        changeMode('monitor');
        break;
      case 'monitor-stop':
        changeMode('read');
        break;
    }
  };

  return (
    <div className={styles.workspace} data-testid="ladder-workspace">
      <div className={styles.toolbar} role="toolbar" aria-label={JA.ladder.title}>
        {profile.panels.toolbar.map((label, index) => {
          const action = TOOLBAR_ACTIONS[index] ?? 'convert';
          return (
            <button
              key={label}
              type="button"
              data-testid={`toolbar-${action}`}
              onClick={() => {
                onToolbar(action);
              }}
            >
              {label}
            </button>
          );
        })}
        <span className={styles.toolbarGap} />
        {/* 回路ブロック・行の操作はショートカット表に無いのでボタンで出す（決定表#12） */}
        <button
          type="button"
          data-testid="toolbar-insert-network"
          onClick={() => {
            const id = nextNetworkId(program);
            const index = insertIndexFor(program, cursor.networkId);
            if (edit(() => insertNetwork(program, index, network(id, [[empty()]])))) {
              useStore.getState().setLadderCursor({ networkId: id, row: 0, col: 0 });
            }
          }}
        >
          {JA.ladder.insertNetwork}
        </button>
        <button
          type="button"
          data-testid="toolbar-delete-network"
          // END は消させない（消すと `missing-end` になり、画面から戻す手段が無い）
          disabled={
            program.networks.length <= 2 ||
            currentNetwork === undefined ||
            isEndNetwork(currentNetwork)
          }
          onClick={() => {
            if (!edit(() => deleteNetwork(program, cursor.networkId))) return;
            const first = program.networks[0];
            if (first !== undefined) {
              useStore.getState().setLadderCursor({ networkId: first.id, row: 0, col: 0 });
            }
          }}
        >
          {JA.ladder.deleteNetwork}
        </button>
        <button
          type="button"
          data-testid="toolbar-insert-row"
          onClick={() => {
            edit(() => insertRow(program, cursor.networkId, cursor.row + 1));
          }}
        >
          {JA.ladder.insertRow}
        </button>
        <button
          type="button"
          data-testid="toolbar-delete-row"
          onClick={() => {
            if (!edit(() => deleteRow(program, cursor.networkId, cursor.row))) return;
            useStore.getState().setLadderCursor({ ...cursor, row: Math.max(0, cursor.row - 1) });
          }}
        >
          {JA.ladder.deleteRow}
        </button>
      </div>

      <div className={styles.workspaceBody}>
        <ProjectTree
          program={program}
          profile={profile}
          currentNetworkId={cursor.networkId}
          onPick={(networkId) => {
            useStore.getState().setLadderCursor({ networkId, row: 0, col: 0 });
          }}
        />
        <div className={styles.workspaceMain}>
          <LadderEditor
            profile={profile}
            gridCols={gridCols}
            errorCells={errorCells}
            onConvert={convert}
            onModeChange={changeMode}
          />
          <OutputWindow
            issues={issues}
            converted={converted}
            onJump={(next) => {
              useStore.getState().setLadderCursor(next);
            }}
          />
        </div>
        <div className={styles.workspaceSide}>
          {/* Task 9 の `<MonitorPanel …/>` はこの位置（`workspaceSide` の先頭）へ差し込む（MERGE 注意 #12） */}
          <IoTable io={io} profile={profile} unit={unit} />
          <CommentPanel
            program={program}
            profile={profile}
            comments={comments}
            // `setDeviceComment` は上限（200件）で弾くと `false` を返す。戻り値をそのまま渡すと
            // `CommentPanel` が理由をトーストに出す（Batch 1 レビュー M4 / Task 7 landed）
            onChange={(device, text) => useStore.getState().setDeviceComment(device, text)}
          />
          <ShortcutHelp profile={profile} />
        </div>
      </div>
    </div>
  );
}
