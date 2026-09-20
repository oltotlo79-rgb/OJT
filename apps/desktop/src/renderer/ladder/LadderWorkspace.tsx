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
import { instructionList, INSTRUCTION_LIST_MESSAGES, type DialectProfile } from '@ojt/plc-dialects';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { errorCellKeys, runConvert } from '../session/ladder-errors.js';
import { nextNetworkId, shortcutKeyOf, type LadderEditorMode } from '../session/ladder.js';
import {
  autoConvert,
  toolbarItems,
  writeModeLabel,
  type ToolbarAction,
  type ToolbarItem,
} from '../session/plc-skin.js';
import { CommentPanel } from './CommentPanel.js';
import { IoTable } from './IoTable.js';
import { ENTRY_ITEMS, LadderEditor, SymbolIcon, type LadderEntryHandle } from './LadderEditor.js';
import { fitGridCols } from './LadderGrid.js';
import { MonitorPanel } from './MonitorPanel.js';
import { NotationDialog } from './NotationDialog.js';
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
  /** 表記切替ダイアログ（§10.7 / Task 8）。 */
  const [notationOpen, setNotationOpen] = useState(false);
  const closeNotation = useCallback((): void => {
    setNotationOpen(false);
  }, []);
  /** 命令語リストにできなかった理由（§10.7 / Task 9）。出力ウィンドウに出す。 */
  const [exportIssues, setExportIssues] = useState<readonly string[]>([]);
  /** 見た目（配色・セル寸法・枠の並び）はスキンが決める。決定表#5 */
  const theme = useMemo(() => skinThemeOf(profile), [profile]);
  const cssVars = useMemo(
    () => skinCssVars(profile, theme, monitorColor),
    [profile, theme, monitorColor],
  );
  /*
   * UI監査 2026-09-20 Blocking #6 / B6: 1440px 幅では格子が横スクロールになり、置いた
   * コイルが画面外に出ていた。`.workspaceMain`（`.gridScroll` と同じ内寸を持つ、水平方向に
   * 余白の無い祖先）の実測幅から、コイル列を含めて画面に収まる接点列数を出す。
   * ウィンドウの大きさが変わるたびに測り直す（測れない・変わらないときは何もしない）。
   */
  /** 記号ボタン列（入口B）→ 回路入力欄。欄の状態は `LadderEditor` が持つ（設計 §5.3）。 */
  const entryRef = useRef<LadderEntryHandle | null>(null);
  const workspaceMainRef = useRef<HTMLDivElement>(null);
  const [paneWidth, setPaneWidth] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = (): void => {
      const width = workspaceMainRef.current?.getBoundingClientRect().width;
      setPaneWidth(width !== undefined && width > 0 ? width : undefined);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
    };
  }, []);
  const effectiveGridCols = fitGridCols(gridCols, paneWidth, theme.cell);
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
   *
   * 成功したときのトーストは出さない（UI監査 2026-09-20 Important #9 / I2）。出力ウィンドウの
   * 見出し（`OutputWindow` の `convert-state`）が同じ「変換に成功しました」を常に出しており、
   * 同じ文言が画面に2か所同時に出ていた。失敗は出力ウィンドウの行が「どこが」までは教えるが
   * 「押した操作が失敗した」こと自体はトーストでも知らせる価値があるので、失敗側は残す。
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
    // ラダーが変わったら、古い命令語リストの説明は意味を失うので消す（レビュー #5）
    setExportIssues([]);
    if (!auto || program === undefined) return;
    convert({ silent: true });
  }, [auto, program, convert]);

  /**
   * 命令語リストを書き出す。§10.7 / 受入基準⑥
   * 文言は 4A の `INSTRUCTION_LIST_MESSAGES` を使い、訓練者が直せない言い回し
   * （`coil-unconnected` / `not-series-parallel`）だけ**平易な直し方**に置き換える。
   * `instructionList()` の生の `message` は回路ブロックの内部ID（`n1`）を含むので画面には出さない。
   *
   * `preset-unavailable`（設定値が機種で表せず `?` で書き出される）は行自体は書けているので
   * **保存を止めない**。それ以外（`compile-failed` / `coil-unconnected` /
   * `not-series-parallel`）は書けた行に意味が無いので保存しない（レビュー #3）。
   */
  const exportIl = useCallback((): void => {
    const store = useStore.getState();
    const current = store.ladder;
    if (current === undefined) return;
    const list = instructionList(current, profile);
    /*
     * `INSTRUCTION_LIST_MESSAGES` / `JA.ladder.ilIssueAdvice` は `Readonly<Record<string, string>>`
     * で決まったキーしか入っていない（landed `instruction-list.ts` L45-50）。`issue.code` はただの
     * `string` なので、**必ず `??` で受ける**（`noUncheckedIndexedAccess` の下で `string | undefined`
     * になる。無い鍵を引いたら `issue.message` に倒す。レビュー I9）。
     * 同じ理由の指摘が出力の数だけ並ぶので、同じ文は1つに畳む。
     */
    const adviceOf = (issue: (typeof list.errors)[number]): string =>
      JA.ladder.ilIssueAdvice[issue.code] ?? INSTRUCTION_LIST_MESSAGES[issue.code] ?? issue.message;
    const blocked = list.errors.some((issue) => issue.code !== 'preset-unavailable');
    if (blocked) {
      const texts = [...new Set(list.errors.map(adviceOf))];
      setExportIssues(texts);
      // 出力ウィンドウを畳んでいるスキンでも押した直後に気付けるように（レビュー #1）
      const [first] = texts;
      if (first !== undefined) store.toast(first, 'error');
      return;
    }
    const warnings = [...new Set(list.errors.map(adviceOf))];
    setExportIssues(warnings);
    const [firstWarning] = warnings;
    if (firstWarning !== undefined) store.toast(firstWarning, 'warn');
    try {
      void ojtApi()
        .saveTextFile({ defaultFileName: `${problem.id}_命令語リスト.txt`, text: list.text })
        .then((result) => {
          const next = useStore.getState();
          if (result.ok) next.toast(JA.ladder.ilSaved(result.path));
          else if (!result.canceled) next.toast(result.message, 'error');
        })
        .catch((error: unknown) => {
          // main への IPC 自体が失敗したとき（`.then` の中は main が正常に応答した場合だけ通る）
          useStore
            .getState()
            .toast(error instanceof Error ? error.message : String(error), 'error');
        });
    } catch (error) {
      store.toast(error instanceof Error ? error.message : String(error), 'error');
    }
  }, [problem, profile]);

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
        /*
         * モニタ停止のあとは書込みモードへ戻す（UI監査 2026-09-20:
         * `modeD-jtekt/sharp-output-error` に到達できない）。以前は `read` へ落としていたが、
         * PCwin風（JTEKT）・JW-300SP風（SHARP）のツールバーには `write-mode` 行が無い
         * （`TOOLBAR_ACTIONS_BY_DIALECT`）ため、モニタを一度でも開始すると編集へ戻す手段が
         * 画面から消えていた（`edit()` は `ladderMode !== 'write'` を読出し専用として断る）。
         * 三菱・OMRONは `write-mode` ボタンで手動でも戻せたが、4スキンとも自動で戻すほうが
         * 実機の「モニタ終了で編集状態に戻る」動きに近く、一貫する。
         */
        changeMode('write');
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

  /*
   * ツールバーの項目はスキン（方言IDの対応表）から引く。位置で対応させない（決定表#2）。
   * `vendor-only`（実機にはあるが本アプリでは動かない項目。決定表#4）は**出さない**
   * （UI監査 2026-09-20 Important #9: PCwin風の JP1／DGR／MOB／RDY は押しても何も起きない
   * 飾りボタンで、押せない理由をトーストで説明するより出さないほうが良いという利用者の
   * 判断）。`toolbarItems()` 自体は全項目を返したまま（`writeModeLabel()` など、意味の対応
   * だけが要る呼び出し元がある）にして、ここでは**表示するものだけ**に絞る。
   */
  const shown = toolbarItems(profile).filter((item) => item.action !== 'vendor-only');
  /*
   * RUN/STOP を1つも持たないスキン（GX Works3 風）には、ツールバーの最後に足す。
   * UI監査バッチD（`340b2d9`）が `PlcSession` と `MonitorPanel` の RUN/STOP を外して
   * 「画面に1つだけ・ツールバーに置く」と決めたが、三菱のツールバー
   * （`session/plc-skin.ts` の `TOOLBAR_ACTIONS_BY_DIALECT`）には `plc-run` が無く、
   * **運転にする手段が画面から消えていた**（Batch E の E2E で `plc.spec.ts` ①②③ が時間切れ。
   * 実機の GX Works3 では RUN/STOP は「リモート操作」にあたる）。「画面に1つ」は守ったまま、
   * 足りないスキンにだけ補う。ラベルは押すたびに RUN⇄STOP と入れ替わる。
   */
  const items: ToolbarItem[] = shown.some((item) => item.action === 'plc-run')
    ? shown
    : [
        ...shown,
        {
          action: 'plc-run',
          label: plcRunning ? JA.ladder.stop : JA.ladder.run,
          index: profile.panels.toolbar.length,
        },
      ];

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
        {items.map((item, index) => {
          // `map` 自身の添字で「最初の1件」を決める（レビュー M10。`item.index` は
          // `panels.toolbar` 側の位置で、`toolbarItems()` が意味の無い項目を落とすと配列の
          // 添字とずれうる）
          const first = items.findIndex((other) => other.action === item.action) === index;
          return (
            <button
              key={`${item.action}-${String(item.index)}`}
              type="button"
              // その action の**最初の1つ**は位置なし（既存テストと E2E がこの名前で引く）、
              // 2つ目以降は位置つき（jtekt は `plc-reset` と別に `RES` のような重複があり得る）
              data-testid={
                first ? `toolbar-${item.action}` : `toolbar-${item.action}-${String(item.index)}`
              }
              data-action={item.action}
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
        {/*
          表記切替（§10.7 / Task 8）。メーカーごとの操作表（`TOOLBAR_ACTIONS_BY_DIALECT`）は
          実機のツールバーの写しなので、本アプリだけの操作はその後ろに並べる（決定表#2）。
          読出し・モニタ中でも押せる（プログラムは書き換わらないため。4A H-2）。
        */}
        <button
          type="button"
          data-testid="toolbar-notation"
          onClick={() => {
            setNotationOpen(true);
          }}
        >
          {JA.ladder.notationTitle}
        </button>
      </div>

      {/*
        入口B: 記号ボタン列（Phase 7 設計 §5.3 / 指摘 UX-02）。純正のツールバーと同じ並びで、
        **ボタン名にはキーを併記する**（「a接点 (F5)」）。キーは方言表から引くので、
        メーカーを切り替えると併記も変わる（OMRON は「a接点 (C)」）。アイコンは本アプリが
        描く線画で、各社の図記号ビットマップ・アイコンは使わない（§17）。
        JW-300SP 風だけは**格子へドラッグしても置ける**（設計 §5.2 の S8）。
      */}
      <div className={styles.symbolBar} role="group" aria-label={JA.ladder.entry.symbols}>
        {ENTRY_ITEMS.map((item) => {
          const key = item.actions
            .map((action) => shortcutKeyOf(profile, action))
            .find((found) => found !== undefined);
          return (
            <button
              key={item.kind}
              type="button"
              data-testid={`symbol-${item.kind}`}
              // キー操作・格子の入口と同じく、書込みモード以外は押させない（決定表#11）
              disabled={ladderMode !== 'write'}
              draggable={theme.dragPlace === true}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', item.kind);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => {
                entryRef.current?.place(item.kind);
              }}
            >
              <SymbolIcon kind={item.kind} />
              {key === undefined ? item.label : JA.ladder.entry.withKey(item.label, key)}
            </button>
          );
        })}
        {theme.dragPlace === true ? (
          <span className={styles.symbolHint}>{JA.ladder.entry.dragHint}</span>
        ) : null}
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
        <div className={styles.workspaceMain} ref={workspaceMainRef} data-testid="workspace-main">
          <LadderEditor
            ref={entryRef}
            profile={profile}
            gridCols={effectiveGridCols}
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
              onExport={exportIl}
              exportIssues={exportIssues}
            />
          </div>
        </div>
        <div className={styles.workspaceSide}>
          {/* 表記切替ダイアログ（画面中央に出る。Task 8） */}
          {notationOpen ? <NotationDialog profile={profile} onClose={closeNotation} /> : null}
          {/* MERGE 注意 #12: モニタ一覧は `workspaceSide` の先頭（`IoTable` の前）。Task 9 */}
          <MonitorPanel profile={profile} unit={unit} onPlc={onPlc} />
          <IoTable io={io} profile={profile} unit={unit} />
          <CommentPanel
            program={program}
            profile={profile}
            comments={comments}
            // `setDeviceComment` は上限（200件）で弾くと `false` を返すが、`CommentPanel` は
            // 戻り値を見ない。上限に達したことは同パネルの常時表示の注記（`commentCapText()`）
            // と `disabled` 済み入力欄の `aria-describedby` で伝わる（LE-16）
            onChange={(device, text) => useStore.getState().setDeviceComment(device, text)}
          />
          <ShortcutHelp profile={profile} />
        </div>
      </div>

      <SkinStatusBar theme={theme} />
    </div>
  );
}
