import type { WireColor } from '@ojt/circuit-sim';
import { useState, type JSX } from 'react';
import { HelpButton } from '../help/HelpButton.js';
import { JA } from '../i18n/ja.js';
import { useStore, type CameraPreset } from '../app/store.js';
import type { HintStage } from '../session/hints.js';
import type { ToolMode } from '../session/interaction.js';
import styles from './panels.module.css';

/**
 * 上部ツールバー。設計仕様 §8.1。
 * 線色／削除モード／元に戻す・やり直し／視点プリセット／作業の保存読込／回路図ヒントの開閉／判定を並べる。
 * 電源（ブレーカ・スイッチ）は `PowerControls` が描く。
 *
 * Phase 7 Task 25（指摘 PR-02）: 「ヒント」を置き、押すたびに1段ずつ開く。
 * 段の中身は `session/hints.ts` の純関数が作り、開いた段数はストア（`hintStage`）が持つ。
 * 何段まで開いたかは結果画面に「ヒントを使った回数」として出る。
 */

/** 視点プリセットのボタン定義。§12.2 */
const VIEWS: ReadonlyArray<{ preset: CameraPreset; label: string; key: string }> = [
  { preset: 'front', label: JA.session.viewFront, key: '1' },
  { preset: 'top', label: JA.session.viewTop, key: '2' },
  { preset: 'socket', label: JA.session.viewSocket, key: '3' },
];

/** 上部ツールバー。 */
export function Toolbar({
  mode,
  wireColor,
  allowedColors,
  showWireTools = true,
  showPlcView = false,
  extraTools,
  viewSwitch,
  camera,
  canUndo,
  canRedo,
  judging,
  judgeDisabled = false,
  judgeTitle,
  onMode,
  onWireColor,
  onCamera,
  onUndo,
  onRedo,
  onJudge,
  onBack,
  onSave,
  onLoad,
  hints,
  schematicVisible,
  onToggleSchematic,
  children,
}: {
  mode: ToolMode;
  wireColor: WireColor;
  allowedColors: readonly WireColor[];
  /**
   * 配線の道具（線色・削除モード）を出すか。§8.1 / §9.1
   * モードC1は盤に配線しないので出さない（既定は出す）。
   */
  showWireTools?: boolean;
  /**
   * 「盤＋PLC」視点のボタンを出すか。§10.1 / 決定表#6
   * 机上のPLC本体と壁コンセントを持つのはモードDの盤だけなので、既定は出さない。
   * テンキーとビューキューブの割当（盤の6面）は変えない。
   */
  showPlcView?: boolean;
  /** モード固有の道具（テスター／指摘モードの切替など）を差し込む枠。§9.2 / §9.3 */
  extraTools?: JSX.Element;
  /**
   * ビュー切替（モードBの 盤／並べて／回路図）。§11.4 / Plan 5 決定表#1
   * 「何を見るか」を選ぶ道具なので、元に戻す・やり直しの隣・判定ボタンの左へ**常に出す**
   * （「…」の中には畳まない。利用者要求 2026-09-19「切替が一目で分かること」）。
   * 渡さない画面には出ない。
   */
  viewSwitch?: JSX.Element;
  camera: CameraPreset;
  canUndo: boolean;
  canRedo: boolean;
  /** 判定を Worker へ送って結果待ちか（押し直しを止める）。§8.2 */
  judging: boolean;
  /** 判定ボタンを押させない理由がある（モードD: 未変換のラダー。3A H-1）。 */
  judgeDisabled?: boolean;
  /** 判定ボタンの `title`（押せない理由）。 */
  judgeTitle?: string;
  onMode: (mode: ToolMode) => void;
  onWireColor: (color: WireColor) => void;
  onCamera: (preset: CameraPreset) => void;
  onUndo: () => void;
  onRedo: () => void;
  onJudge: () => void;
  onBack: () => void;
  /** 作業ファイルの保存・読込。§12.3 */
  onSave: () => void;
  onLoad: () => void;
  /**
   * 段階的に開くヒント（指摘 PR-02）。`session/hints.ts` の `hintStages()` が作った並びを
   * そのまま渡す。渡さない画面には「ヒント」を出さない。
   */
  hints?: readonly HintStage[] | undefined;
  /** 回路図ヒントがいま開いているか。§8.4 */
  schematicVisible: boolean;
  /**
   * 回路図ヒントの開閉。開閉できる級（2級）だけに渡す。§8.4
   * 3級は**常時表示**、1級は**非表示**で、どちらも訓練者が切り替えられないので `undefined`。
   */
  onToggleSchematic: (() => void) | undefined;
  children?: JSX.Element;
}): JSX.Element {
  /*
   * 視点／保存・読込／回路図の開閉は「…」の中にまとめる（UXレビュー #17）。
   * 1280px幅では元は全部を並べると2行になり、判定ボタンが2行目に落ちていた
   * （レビュー指摘）。頻度の低い3群だけを畳み、線色・元に戻す・判定は常に1行目に残す。
   */
  const [overflowOpen, setOverflowOpen] = useState(false);
  /*
   * 判定ボタンが押せない理由。`judging`（往復待ち）を優先し、次に `judgeDisabled` の理由
   * （`judgeTitle`。モードDだけが渡す）。どちらも無ければ押せる状態なので `undefined`。
   */
  const judgeReason = judging ? JA.session.judging : judgeDisabled ? judgeTitle : undefined;
  /*
   * ヒント（指摘 PR-02）。開いた段数はストアが持つ（結果画面が「ヒントを使った回数」として
   * 読むのと、課題を開き直したときに 0 へ戻るのが同じ1か所で決まる）。
   */
  const hintStage = useStore((state) => state.hintStage);
  const revealHint = useStore((state) => state.revealHint);
  /*
   * 開いた段数（`hintStage`）は**減らさない**（結果画面の「ヒントを使った回数」が実際より
   * 少なく出てしまう）。畳むのは見た目だけなので、その状態は画面の中で持つ。
   */
  const [hintFolded, setHintFolded] = useState(false);
  const stages = hints ?? [];
  const allOpen = hintStage >= stages.length;
  const hintShown = hintStage > 0 && !hintFolded;
  const openStages = hintShown ? stages.slice(0, hintStage) : [];
  return (
    <div className={styles.toolbar} role="toolbar">
      {/*
        判定ボタン以外の道具はすべてここに入れる。狭い幅ではこの枠の中だけが複数行に
        折り返し、判定ボタンは `.judgeButton` の `margin-left: auto` で常に右端に留まる
        （レビュー指摘: 1280px 幅で判定ボタンが2行目に迷子になっていた）。
      */}
      <div className={styles.toolbarScroll}>
        <button type="button" data-testid="session-back" onClick={onBack}>
          {JA.session.back}
        </button>
        {/*
          ヘルプ（Plan 6 Task 9）。この1つで4つのセッション画面（モードB・C1・C2・D）
          すべてに同じ位置で出る。画面ごとに足さない（MERGE 注意#8）。
        */}
        <HelpButton />
        {showWireTools ? (
          <div className={styles.toolGroup}>
            <span className={styles.toolLabel}>{JA.session.wireColor}</span>
            {allowedColors.map((color) => (
              <button
                key={color}
                type="button"
                aria-pressed={mode === 'wire' && wireColor === color}
                onClick={() => {
                  onWireColor(color);
                  onMode('wire');
                }}
              >
                <span className={styles.wireSwatch} data-color={color} aria-hidden="true" />
                {color}
              </button>
            ))}
            <button
              type="button"
              aria-pressed={mode === 'delete'}
              onClick={() => {
                onMode(mode === 'delete' ? 'wire' : 'delete');
              }}
            >
              {JA.session.deleteMode}
            </button>
          </div>
        ) : null}
        {extraTools === undefined ? null : <div className={styles.toolGroup}>{extraTools}</div>}
        <div className={styles.toolGroup}>
          {/*
            UXレビュー #5 の「押せない理由を `title` だけに頼らない」は、`disabled` ではなく
            `aria-disabled`（I3: `TerminalListPanel` と同じ型）で満たす。`disabled` は
            Chromium が `title` のツールチップもポインタイベントも配らないため。
            以前は常時一行で理由を出していたが、幅の1/4を占めて1280pxでは
            ①ブレーカ②電源スイッチが2行目へ落ちていた（UI監査 I6）。押せる／押せないに
            関わらず幅が変わらない `title` と、隠し文字（`aria-describedby`）だけにする。
          */}
          <button
            type="button"
            aria-disabled={!canUndo}
            aria-describedby={canUndo ? undefined : 'undo-reason'}
            title={canUndo ? undefined : JA.disabledReason.undo}
            onClick={() => {
              if (!canUndo) {
                // UXレビュー #5 / UI-03・UI-06: 押しても無反応にはしない。理由をトーストでも出す
                useStore.getState().toast(JA.disabledReason.undo, 'info');
                return;
              }
              onUndo();
            }}
          >
            {JA.session.undo}
          </button>
          {canUndo ? null : (
            <span className={styles.srOnly} id="undo-reason" data-testid="undo-reason">
              {JA.disabledReason.undo}
            </span>
          )}
          <button
            type="button"
            aria-disabled={!canRedo}
            aria-describedby={canRedo ? undefined : 'redo-reason'}
            title={canRedo ? undefined : JA.disabledReason.redo}
            onClick={() => {
              if (!canRedo) {
                useStore.getState().toast(JA.disabledReason.redo, 'info');
                return;
              }
              onRedo();
            }}
          >
            {JA.session.redo}
          </button>
          {canRedo ? null : (
            <span className={styles.srOnly} id="redo-reason" data-testid="redo-reason">
              {JA.disabledReason.redo}
            </span>
          )}
        </div>
        {viewSwitch === undefined ? null : (
          <div className={`${styles.toolGroup} ${styles.viewSwitch}`} data-testid="view-switch">
            {viewSwitch}
          </div>
        )}
        {/*
          UXレビュー #17: 視点・保存読込・回路図の開閉は「…」の中に畳む。トリガーと
          パネルを `.overflowHost`（`position: relative`）でくくり、パネルはその真下に
          浮かせる（`.toolbarScroll` の折り返しの1項目に混ぜない）。
        */}
        <div className={styles.overflowHost}>
          <button
            type="button"
            className={styles.overflowToggle}
            data-testid="toolbar-overflow-toggle"
            aria-expanded={overflowOpen}
            aria-label={JA.toolbarOverflow.label}
            onClick={() => {
              setOverflowOpen((next) => !next);
            }}
          >
            ⋯
          </button>
          {overflowOpen ? (
            <div className={styles.overflowPanel} data-testid="toolbar-overflow">
              <div className={styles.toolGroup}>
                <span className={styles.toolLabel}>{JA.toolbarOverflow.view}</span>
                {VIEWS.map((view) => (
                  <button
                    key={view.preset}
                    type="button"
                    aria-pressed={camera === view.preset}
                    title={`${view.label} (${view.key})`}
                    onClick={() => {
                      onCamera(view.preset);
                    }}
                  >
                    {view.label}
                  </button>
                ))}
                {showPlcView ? (
                  <button
                    type="button"
                    data-testid="view-plc"
                    aria-pressed={camera === 'plc'}
                    title={JA.plc.viewPlc}
                    onClick={() => {
                      onCamera('plc');
                    }}
                  >
                    {JA.plc.viewPlc}
                  </button>
                ) : null}
              </div>
              <div className={styles.toolGroup}>
                <span className={styles.toolLabel}>{JA.toolbarOverflow.workFile}</span>
                <button type="button" onClick={onSave}>
                  {JA.session.save}
                </button>
                <button type="button" onClick={onLoad}>
                  {JA.session.load}
                </button>
                {onToggleSchematic === undefined ? null : (
                  <button
                    type="button"
                    aria-pressed={schematicVisible}
                    data-testid="toggle-schematic"
                    onClick={onToggleSchematic}
                  >
                    {schematicVisible ? JA.session.hideSchematic : JA.session.showSchematic}
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
        {/*
          ヒント（指摘 PR-02）。押すたびに1段ずつ開く。級で段数が変わる
          （1級形式は回路図が出ないので第3段を作らない）ので、ここは並びの長さに従うだけ。
        */}
        {stages.length === 0 ? null : (
          <div className={styles.hintHost}>
            <button
              type="button"
              className={styles.hintToggle}
              data-testid="hint-button"
              aria-expanded={hintShown}
              onClick={() => {
                // 畳んでいたら開き直すだけ（段は増やさない）
                if (hintFolded) {
                  setHintFolded(false);
                  return;
                }
                // 最後まで開いたら同じボタンで畳む（押しても何も起きない状態にしない）
                if (allOpen) {
                  setHintFolded(true);
                  return;
                }
                revealHint(stages.length);
              }}
            >
              {!hintShown ? JA.hint.label : allOpen ? JA.hint.close : JA.hint.more}
            </button>
            {openStages.length === 0 ? null : (
              <div className={styles.hintPanel} data-testid="hint-panel" role="status">
                {openStages.map((stage) => (
                  <p key={stage.stage} className={styles.hintStage}>
                    <span className={styles.hintStageTitle}>{stage.title}</span>
                    {stage.text}
                  </p>
                ))}
                {allOpen ? (
                  <p className={styles.hintDone} data-testid="hint-done">
                    {JA.hint.done}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
        {children}
      </div>
      {/*
        UXレビュー #5 / UI-03・UI-06: 判定ボタンも 元に戻す／やり直し と同じ型に揃える。
        `disabled` は Chromium が `title` もポインタイベントも配らないので使わない。
        `judging`（往復待ち）と `judgeDisabled`（押させない理由がある。モードD: 未変換など）を
        1つの `aria-disabled` にまとめ、押したときは理由をトーストでも出す。
      */}
      <button
        type="button"
        className={styles.judgeButton}
        data-testid="judge-button"
        aria-disabled={judging || judgeDisabled}
        aria-describedby={judgeReason === undefined ? undefined : 'judge-reason'}
        {...(judgeTitle === undefined ? {} : { title: judgeTitle })}
        onClick={() => {
          if (judging || judgeDisabled) {
            if (judgeReason !== undefined) useStore.getState().toast(judgeReason, 'info');
            return;
          }
          onJudge();
        }}
      >
        {judging ? JA.session.judging : JA.session.judge}
      </button>
      {judgeReason === undefined ? null : (
        <span className={styles.srOnly} id="judge-reason" data-testid="judge-reason">
          {judgeReason}
        </span>
      )}
    </div>
  );
}
