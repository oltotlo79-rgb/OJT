import type { WireColor } from '@ojt/circuit-sim';
import { useState, type JSX } from 'react';
import { JA } from '../i18n/ja.js';
import type { CameraPreset } from '../app/store.js';
import type { ToolMode } from '../session/interaction.js';
import styles from './panels.module.css';

/**
 * 上部ツールバー。設計仕様 §8.1。
 * 線色／削除モード／元に戻す・やり直し／視点プリセット／作業の保存読込／回路図ヒントの開閉／判定を並べる。
 * 電源（ブレーカ・スイッチ）は `PowerControls` が描く。
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
          <button
            type="button"
            disabled={!canUndo}
            title={canUndo ? undefined : JA.disabledReason.undo}
            onClick={onUndo}
          >
            {JA.session.undo}
          </button>
          <button
            type="button"
            disabled={!canRedo}
            title={canRedo ? undefined : JA.disabledReason.redo}
            onClick={onRedo}
          >
            {JA.session.redo}
          </button>
          {/*
            UXレビュー #5: 押せない理由を `title` のツールチップだけに頼らず、
            パネル内にも一行で出す。
          */}
          {!canUndo || !canRedo ? (
            <span className={styles.disabledReason} data-testid="undo-redo-reason">
              {!canUndo ? JA.disabledReason.undo : null}
              {!canUndo && !canRedo ? ' ／ ' : null}
              {!canRedo ? JA.disabledReason.redo : null}
            </span>
          ) : null}
        </div>
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
        {children}
      </div>
      <button
        type="button"
        className={styles.judgeButton}
        data-testid="judge-button"
        disabled={judging || judgeDisabled}
        {...(judgeTitle === undefined ? {} : { title: judgeTitle })}
        onClick={onJudge}
      >
        {judging ? JA.session.judging : JA.session.judge}
      </button>
    </div>
  );
}
