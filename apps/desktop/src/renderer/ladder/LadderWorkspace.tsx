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
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { PlcCommandAction } from '../../worker/protocol.js';
import { useHelpStore } from '../help/help-store.js';
import { loadWorkFileAndApply, saveCurrentWork } from '../session/work-file.js';
import { NativeMenuBar, type NativeMenuItem } from './NativeMenuBar.js';
import { NATIVE_MENU_ORDER, documentName, type NativeMenuId } from './native-layout.js';
import { ojtApi } from '../app/ojt-api.js';
import { useStore } from '../app/store.js';
import { useElementWidth } from '../app/use-element-size.js';
import { JA } from '../i18n/ja.js';
import { isModalOpen } from '../session/interaction.js';
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
import { PlcDebugPanel } from './PlcDebugPanel.js';
import { ENTRY_ITEMS, LadderEditor, SymbolIcon, type LadderEntryHandle } from './LadderEditor.js';
import { fitGridCols } from './LadderGrid.js';
import { MonitorPanel } from './MonitorPanel.js';
import { NotationDialog } from './NotationDialog.js';
import { OutputWindow } from './OutputWindow.js';
import { ProjectTree } from './ProjectTree.js';
import { ShortcutHelp } from './ShortcutHelp.js';
import { ShortcutOverlay } from './ShortcutOverlay.js';
import { SkinStatusBar, SkinTitleBar } from './SkinFrame.js';
import { WatchPanel } from './WatchPanel.js';
import { skinCssVars, skinThemeOf } from './skins/index.js';
import { friendlyLadderErrorMessage } from './ladder-errors.js';
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
  const [treeVisible, setTreeVisible] = useState(true);
  const [outputOpenKey, setOutputOpenKey] = useState(0);
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
  /*
   * 指摘 LE-18: 幅の実測が `window.resize` だけだったので、表示切替（ラダー／分割／盤）や
   * 右の欄の `<details>` の開閉のように**窓の大きさが変わらない**変化に追従できず、接点の
   * 列数が古いままコイル列が画面の外へ出ていた。`ResizeObserver` で欄そのものを見る
   * （共有の `app/use-element-size.ts`）。
   */
  const paneWidth = useElementWidth(workspaceMainRef);
  const effectiveGridCols = fitGridCols(gridCols, paneWidth, theme.cell);
  /** キーの早見表の覆い（`Shift + ?`。指摘 PR-05）。 */
  const [overlayOpen, setOverlayOpen] = useState(false);
  const closeOverlay = useCallback((): void => {
    setOverlayOpen(false);
  }, []);
  /** ツールバーの「ウォッチ」を押すたびに増やす。畳んでいる監視欄を開かせる合図。 */
  const [watchOpenKey, setWatchOpenKey] = useState(0);
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

  /*
   * 指摘 PR-05: キー割当は右の欄（既定は畳んだ状態）にしか無く、格子を見ながら引けなかった。
   * `Shift + ?` で全キーを覆いで出す。モーダルが開いているあいだは通さない（§8.2）。
   * 打ち込んでいる最中の `?` を奪わないよう、入力欄・IME 変換中は素通しする。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '?' || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.isComposing || isModalOpen()) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      setOverlayOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

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
        store.toast(friendlyLadderErrorMessage(error.message), 'error');
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

  const editCommand = (command: string): void => {
    const state = useStore.getState();
    const source = state.ladder;
    if (source === undefined) return;
    const at = state.ladderCursor;
    if (command === 'undo' || command === 'redo') {
      if (state.ladderMode !== 'write') {
        state.toast(JA.ladder.readOnly(writeModeLabel(profile)), 'error');
        return;
      }
      if (command === 'undo') state.undoLadderEdit();
      else state.redoLadderEdit();
    } else if (command === 'insert-network' || command === 'insert-network-above') {
      const id = nextNetworkId(source);
      const index =
        command === 'insert-network-above'
          ? Math.max(
              0,
              source.networks.findIndex((net) => net.id === at.networkId),
            )
          : insertIndexFor(source, at.networkId);
      if (edit(() => insertNetwork(source, index, network(id, [[empty()]]))))
        state.setLadderCursor({ networkId: id, row: 0, col: 0 });
    } else if (command === 'delete-network') {
      if (
        isEndNetwork(
          source.networks.find((net) => net.id === at.networkId) ?? source.networks[0]!,
        ) ||
        source.networks.length <= 2
      )
        return;
      const next = source.networks.find((net) => net.id !== at.networkId);
      if (next && edit(() => deleteNetwork(source, at.networkId)))
        state.setLadderCursor({ networkId: next.id, row: 0, col: 0 });
    } else if (command === 'insert-row') edit(() => insertRow(source, at.networkId, at.row + 1));
    else if (command === 'delete-row') {
      if (edit(() => deleteRow(source, at.networkId, at.row)))
        state.setLadderCursor({ ...at, row: Math.max(0, at.row - 1) });
    }
  };
  const operation = (
    id: string,
    label: string,
    run: () => void,
    key?: string,
    disabled?: boolean,
  ): NativeMenuItem => ({ id, label, run, key, disabled });
  const files = [
    operation(
      'save-work',
      JA.session.save,
      () => {
        const session = useStore.getState().session;
        if (session) saveCurrentWork(problem.id, session);
      },
      'Ctrl+S',
    ),
    operation('open-work', JA.session.load, loadWorkFileAndApply),
    operation('export-il', JA.ladder.exportIl, exportIl),
  ];
  const edits = [
    operation(
      'undo',
      JA.session.undo,
      () => {
        editCommand('undo');
      },
      'Ctrl+Z',
      ladderMode !== 'write',
    ),
    operation(
      'redo',
      JA.session.redo,
      () => {
        editCommand('redo');
      },
      'Ctrl+Y',
      ladderMode !== 'write',
    ),
    operation(
      'write-mode',
      JA.ladder.nativeEdit,
      () => changeMode('write'),
      shortcutKeyOf(profile, 'write-mode'),
    ),
    operation(
      'read-mode',
      JA.ladder.nativeRead,
      () => changeMode('read'),
      shortcutKeyOf(profile, 'read-mode'),
    ),
    ...[
      ['insert-network', JA.ladder.insertNetwork],
      ['delete-network', JA.ladder.deleteNetwork],
      ['insert-row', JA.ladder.insertRow],
      ['delete-row', JA.ladder.deleteRow],
    ].map(([id, label]) =>
      operation(
        id!,
        label!,
        () => editCommand(id!),
        shortcutKeyOf(profile, id!),
        ladderMode !== 'write' ||
          (id === 'delete-network' &&
            (program.networks.length <= 2 ||
              currentNetwork === undefined ||
              isEndNetwork(currentNetwork))),
      ),
    ),
  ];
  const check = operation(
    'convert',
    profile.convertStep ? profile.panels.toolbar[0]! : JA.ladder.nativeCheck,
    () => convert(),
    shortcutKeyOf(profile, 'convert'),
  );
  const online = items
    .filter((item) => !['convert', 'convert-all', 'write-mode', 'read-mode'].includes(item.action))
    .map((item) =>
      operation(
        item.action,
        item.action === 'plc-run' ? (plcRunning ? JA.ladder.stop : JA.ladder.run) : item.label,
        () => onToolbar(item.action),
        shortcutKeyOf(profile, item.action === 'monitor-start' ? 'monitor' : item.action),
      ),
    );
  const views = [
    {
      ...operation('tree', profile.panels.tree, () => setTreeVisible((visible) => !visible)),
      checked: treeVisible,
    },
    operation('output', profile.panels.output, () => setOutputOpenKey((value) => value + 1)),
    ...(profile.panels.watch
      ? [operation('watch', profile.panels.watch, () => setWatchOpenKey((value) => value + 1))]
      : []),
  ];
  const symbols = ENTRY_ITEMS.map((item) =>
    operation(
      `symbol-${item.kind}`,
      item.label,
      () => entryRef.current?.place(item.kind),
      item.actions.map((action) => shortcutKeyOf(profile, action)).find(Boolean),
      ladderMode !== 'write',
    ),
  );
  const menus = NATIVE_MENU_ORDER[profile.id].map((id) => {
    const groups: Partial<Record<NativeMenuId, readonly NativeMenuItem[]>> = {
      file: files,
      project: files,
      edit: [
        ...edits,
        ...(profile.id === 'omron' ? [] : symbols),
        ...(profile.id === 'sharp' ? [check] : []),
      ],
      insert: symbols,
      convert: [check],
      plc: [check, ...online],
      program: [check],
      online,
      cpu: online,
      monitor: online.filter((item) => item.id.startsWith('monitor')),
      view: views,
      window: views,
      tools: [
        operation('notation', JA.ladder.notationTitle, () => setNotationOpen(true)),
        operation('keys', JA.ladder.nativeKeys, () => setOverlayOpen(true)),
      ],
      help: [operation('help', JA.help.title, () => useHelpStore.getState().openHelp('plc'), 'F1')],
    };
    return { id, label: JA.ladder.nativeMenus[id], items: groups[id] ?? [] };
  });
  const quickItems = items.filter((item) =>
    ['convert', 'download', 'monitor-start', 'monitor-stop', 'plc-run'].includes(item.action),
  );

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
      <NativeMenuBar menus={menus} />
      <div className={styles.toolbar} role="group" aria-label={JA.ladder.title}>
        {quickItems.map((item) => (
          <button
            key={item.action}
            type="button"
            data-testid={`toolbar-${item.action}`}
            data-action={item.action}
            aria-pressed={item.action === 'plc-run' ? plcRunning : undefined}
            onClick={() => onToolbar(item.action)}
          >
            <span className={styles.commandMark} aria-hidden="true">
              {item.action === 'convert'
                ? '✓'
                : item.action === 'download'
                  ? '↓'
                  : item.action === 'plc-run'
                    ? plcRunning
                      ? '■'
                      : '▶'
                    : item.action === 'monitor-start'
                      ? '◉'
                      : '□'}
            </span>
            {item.action === 'plc-run' ? (plcRunning ? JA.ladder.stop : JA.ladder.run) : item.label}
          </button>
        ))}
        <span className={styles.toolbarGap} />
        <button type="button" data-testid="toolbar-notation" onClick={() => setNotationOpen(true)}>
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
              title={key === undefined ? item.label : JA.ladder.entry.withKey(item.label, key)}
              aria-label={key === undefined ? item.label : JA.ladder.entry.withKey(item.label, key)}
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
              <span className={styles.symbolCaption}>
                {key === undefined ? item.label : JA.ladder.entry.withKey(item.label, key)}
              </span>
            </button>
          );
        })}
        {theme.dragPlace === true ? (
          <span className={styles.symbolHint}>{JA.ladder.entry.dragHint}</span>
        ) : null}
      </div>

      <div className={styles.workspaceBody} data-tree={treeVisible}>
        <div className={styles.treeContainer} hidden={!treeVisible}>
          <ProjectTree
            program={program}
            profile={profile}
            currentNetworkId={cursor.networkId}
            onPick={(networkId) => {
              useStore.getState().setLadderCursor({ networkId, row: 0, col: 0 });
            }}
          />
        </div>
        <div className={styles.workspaceMain} ref={workspaceMainRef} data-testid="workspace-main">
          <div className={styles.documentBar} data-testid="native-document">
            <span>{documentName(profile.id)}</span>
          </div>
          <LadderEditor
            onCommand={(command) => {
              if (
                ['insert-network', 'insert-network-above', 'insert-row', 'delete-row'].includes(
                  command,
                )
              )
                editCommand(command);
              else if (command === 'plc-run') {
                onPlc({ kind: 'run', on: true });
                useStore.getState().setPlcRunning(true);
              } else if (command === 'plc-stop' || command === 'download') onToolbar(command);
            }}
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
              openKey={outputOpenKey}
              issues={issues}
              converted={converted}
              convertKey={profile.convertStep ? shortcutKeyOf(profile, 'convert') : undefined}
              // PCwin風（`status-bar`）は畳んだまま。ほかは開いたまま（レビュー B2）
              open={theme.layout.outputPane === 'window'}
              onJump={(next) => {
                useStore.getState().setLadderCursor(next);
              }}
              onExport={exportIl}
              exportIssues={exportIssues}
              // 欄の呼び名はメーカーの言葉（PCwin風は「ステータスバー」。設計 §5.5）
              title={profile.panels.output}
            />
          </div>
        </div>
        <div className={styles.workspaceSide}>
          {/* 表記切替ダイアログ（画面中央に出る。Task 8） */}
          {notationOpen ? <NotationDialog profile={profile} onClose={closeNotation} /> : null}
          {/* MERGE 注意 #12: モニタ一覧は `workspaceSide` の先頭（`IoTable` の前）。Task 9 */}
          <MonitorPanel profile={profile} unit={unit} onPlc={onPlc} />
          <PlcDebugPanel profile={profile} unit={unit} onPlc={onPlc} />
          {/*
            監視（ウォッチ）欄。「デバイス一覧」（全部）と分けた片割れで、利用者が選んだ
            デバイスだけを並べる（Phase 7 設計 §5.5）。名乗らないメーカーでは出ない。
          */}
          <WatchPanel profile={profile} openKey={watchOpenKey} />
          <IoTable io={io} profile={profile} unit={unit} />
          {/* デバイスコメント欄も方言が名乗ったときだけ出す（呼び名も方言から引く） */}
          {profile.panels.comment === undefined ? null : (
            <CommentPanel
              program={program}
              profile={profile}
              comments={comments}
              // `setDeviceComment` は上限（200件）で弾くと `false` を返すが、`CommentPanel` は
              // 戻り値を見ない。上限に達したことは同パネルの常時表示の注記（`commentCapText()`）
              // と `disabled` 済み入力欄の `aria-describedby` で伝わる（LE-16）
              onChange={(device, text) => useStore.getState().setDeviceComment(device, text)}
            />
          )}
          <ShortcutHelp profile={profile} />
        </div>
      </div>

      <SkinStatusBar profile={profile} />
      {/* キーの早見表（`Shift + ?`。指摘 PR-05）。`Esc` で閉じ、押していた場所へ戻る */}
      {overlayOpen ? <ShortcutOverlay profile={profile} onClose={closeOverlay} /> : null}
    </div>
  );
}
