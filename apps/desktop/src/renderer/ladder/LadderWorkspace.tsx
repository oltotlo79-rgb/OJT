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
import { useCallback, useEffect, useMemo, useRef, type JSX } from 'react';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { errorCellKeys, runConvert } from '../session/ladder-errors.js';
import { nextNetworkId, shortcutKeyOf, type LadderEditorMode } from '../session/ladder.js';
import {
  autoConvert,
  toolbarItems,
  writeModeLabel,
  type ToolbarAction,
} from '../session/plc-skin.js';
import { CommentPanel } from './CommentPanel.js';
import { IoTable } from './IoTable.js';
import { LadderEditor } from './LadderEditor.js';
import { MonitorPanel } from './MonitorPanel.js';
import { OutputWindow } from './OutputWindow.js';
import { ProjectTree } from './ProjectTree.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import { SkinStatusBar, SkinTitleBar } from './SkinFrame.js';
import { skinCssVars, skinThemeOf } from './skins/index.js';
import styles from './ladder.module.css';

/**
 * GX Works3“風”のワークスペース。設計仕様 §10.6。
 *
 * 画面の構成（ナビゲーションウィンドウ・ラダーエディタ・出力ウィンドウ）とツールバーの項目名は
 * すべて `DialectProfile.panels` から引く。**各社のロゴ・アイコン・画面キャプチャ・図記号
 * ビットマップは一切使わない**（§17 / PLC調査資料 §6）。
 */

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
  const ladderMode = useStore((s) => s.ladderMode);
  const plcRunning = useStore((s) => s.plcRunning);
  const monitorColor = useStore((s) => s.monitorColor);
  /** 見た目（配色・セル寸法・枠の並び）はスキンが決める。決定表#5 */
  const theme = useMemo(() => skinThemeOf(profile), [profile]);
  const cssVars = useMemo(() => skinCssVars(theme, monitorColor), [theme, monitorColor]);
  const io = useMemo(() => resolvePlcIo(problem.io), [problem]);
  /** 機種の端子名はここから引く（決定表#16）。課題の機種が未対応なら FX5U に倒す。 */
  const unit = useMemo(() => plcUnitFor(problem.plc.model) ?? PLC_UNIT_FX5U, [problem]);
  const errorCells = useMemo(() => errorCellKeys(issues.errors), [issues]);

  /*
   * `onPlc` は呼び出し側（`PlcSession`）が作る関数である。そのまま `convert` の依存に入れると
   * `convert` も毎レンダー新しくなり、下の自動変換の `useEffect` が毎レンダー走って
   * 「変換 → setConverted → 再レンダー → 変換」のループになる（レビュー I12）。
   * ref に持ち替えて、`convert` の同一性を `profile` だけに結びつける。
   */
  const onPlcRef = useRef(onPlc);
  useEffect(() => {
    onPlcRef.current = onPlc;
  }, [onPlc]);

  /**
   * 「変換」。成功したときだけ Worker へ載せる（H-1）。§10.6
   * `silent` は自動変換（`convertStep: false` のスキン）から呼ぶとき。結果は出力ウィンドウに
   * 出るので、編集のたびにトーストを積まない（決定表#3）。
   */
  const convert = useCallback(
    (options: { silent?: boolean } = {}): void => {
      const store = useStore.getState();
      const current = store.ladder;
      if (current === undefined) return;
      const run = runConvert(current, profile);
      store.setConverted(run.ok, run.issues);
      if (!run.ok) {
        if (options.silent !== true) store.toast(JA.ladder.convertFailed, 'error');
        return;
      }
      onPlcRef.current({ kind: 'load', program: current });
      if (options.silent !== true) store.toast(JA.ladder.convertOk);
    },
    [profile],
  );

  /**
   * 「変換」のないスキンでは、ラダーが変わるたびに黙って変換し直す（決定表#3）。
   * 判定は変換済みのラダーしか受け取らない（H-1）ので、押す場所が無い以上ここで走らせる。
   *
   * 依存は実質 `[auto, program]` である（`convert` は上のとおり `profile` が変わったときしか
   * 作り直されないので、`react-hooks/exhaustive-deps` を満たしたまま余計に走らない。I12）。
   */
  const auto = autoConvert(profile);
  useEffect(() => {
    if (!auto || program === undefined) return;
    convert({ silent: true });
  }, [auto, program, convert]);

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
  const edit = useCallback(
    (run: () => LadderProgram): boolean => {
      const store = useStore.getState();
      // キー操作の編集と同じ規則で、書込みモード以外は断る（決定表#11 / Batch 3 レビュー I1）。
      // キー、無ければツールバーの項目名を方言から引く（前提#22 / レビュー I8）
      if (store.ladderMode !== 'write') {
        store.toast(JA.ladder.readOnly(writeModeLabel(profile)), 'error');
        return false;
      }
      try {
        store.setLadder(run());
        return true;
      } catch (error) {
        if (!(error instanceof LadderError)) throw error;
        store.toast(error.message, 'error');
        return false;
      }
    },
    [profile],
  );

  if (program === undefined || !isPlcProblem(problem)) {
    return <div className={styles.workspace} data-testid="ladder-workspace" />;
  }

  const currentNetwork = program.networks.find((net) => net.id === cursor.networkId);

  const onToolbar = (action: ToolbarAction): void => {
    const store = useStore.getState();
    const convertKey = shortcutKeyOf(profile, 'convert');
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
          store.toast(
            convertKey === undefined
              ? JA.ladder.notConvertedAuto
              : JA.ladder.notConverted(convertKey),
            'error',
          );
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
      case 'plc-run':
        onPlc({ kind: 'run', on: !store.plcRunning });
        store.setPlcRunning(!store.plcRunning);
        break;
      case 'plc-stop':
        onPlc({ kind: 'run', on: false });
        store.setPlcRunning(false);
        break;
      case 'plc-reset':
        onPlc({ kind: 'reset' });
        break;
      // 実機の操作パネルにあるが本アプリでは動かない項目（決定表#4）
      case 'vendor-only':
        store.toast(JA.ladder.vendorOnly);
        break;
    }
  };

  // ツールバーの項目はスキン（方言IDの対応表）から引く。位置で対応させない（決定表#2）
  const items = toolbarItems(profile);

  return (
    <div
      className={styles.workspace}
      data-testid="ladder-workspace"
      data-skin={theme.id}
      data-output-pane={theme.layout.outputPane}
      // スキンの色と寸法は**ここ１回だけ**流し込む（決定表#5。
      // `--skin-*` のカスタムプロパティは React の `style` がそのまま受ける）
      style={cssVars}
    >
      <SkinTitleBar theme={theme} profile={profile} />
      {/*
        ロービングフォーカスは実装していないので `role="toolbar"` を名乗らない
        （Batch 3 レビュー M8。ただの押しボタンの集まりとして `role="group"` にする）
      */}
      <div className={styles.toolbar} role="group" aria-label={JA.ladder.title}>
        {items.map((item) => {
          const first = items.findIndex((other) => other.action === item.action) === item.index;
          return (
            <button
              key={`${item.action}-${String(item.index)}`}
              type="button"
              // その action の**最初の1つ**は位置なし（既存テストと E2E がこの名前で引く）、
              // 2つ目以降は位置つき（PCwin風は `vendor-only` が4つ並ぶ）
              data-testid={
                first ? `toolbar-${item.action}` : `toolbar-${item.action}-${String(item.index)}`
              }
              data-action={item.action}
              className={item.action === 'vendor-only' ? styles.vendorTool : undefined}
              aria-pressed={item.action === 'plc-run' ? plcRunning : undefined}
              onClick={() => {
                onToolbar(item.action);
              }}
            >
              {item.label}
            </button>
          );
        })}
        <span className={styles.toolbarGap} />
        {/*
          回路ブロック・行の操作はショートカット表に無いのでボタンで出す（決定表#12）。
          キー入力の編集と同じく、書込みモード（F2）以外は押させない（Batch 3 レビュー I1）
        */}
        <button
          type="button"
          data-testid="toolbar-insert-network"
          disabled={ladderMode !== 'write'}
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
            ladderMode !== 'write' ||
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
          disabled={ladderMode !== 'write'}
          onClick={() => {
            edit(() => insertRow(program, cursor.networkId, cursor.row + 1));
          }}
        >
          {JA.ladder.insertRow}
        </button>
        <button
          type="button"
          data-testid="toolbar-delete-row"
          disabled={ladderMode !== 'write'}
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
          {/* PCwin風は出力を下部のステータスバーへ畳む（§10.6 / 決定表#7） */}
          <div
            className={
              theme.layout.outputPane === 'status-bar' ? styles.outputCollapsed : undefined
            }
          >
            <OutputWindow
              issues={issues}
              converted={converted}
              convertKey={shortcutKeyOf(profile, 'convert')}
              // PCwin風（`status-bar`）は畳んだまま。ほかは開いたまま（レビュー B2）
              open={theme.layout.outputPane === 'window'}
              onJump={(next) => {
                useStore.getState().setLadderCursor(next);
              }}
            />
          </div>
        </div>
        <div className={styles.workspaceSide}>
          {/* MERGE 注意 #12: モニタ一覧は `workspaceSide` の先頭（`IoTable` の前）。Task 9 */}
          <MonitorPanel profile={profile} unit={unit} onPlc={onPlc} />
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

      <SkinStatusBar theme={theme} />
    </div>
  );
}
