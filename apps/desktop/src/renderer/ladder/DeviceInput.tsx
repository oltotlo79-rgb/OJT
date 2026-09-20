import { T, X, Y, type Cell } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { JA, timerRoundPrompt } from '../i18n/ja.js';
import {
  buildCell,
  counterPresetText,
  parseApplicationEntry,
  parseDirectEntry,
  roundSuggestionFor,
  timerPresetMs,
  type CellForm,
  type ContactForm,
  type OutputForm,
} from '../session/ladder-cell.js';
import styles from './ladder.module.css';

/**
 * 回路入力欄。設計仕様 §10.5 / §10.7、Phase 7 設計 §5.3（指摘 UX-02 / PR-01）。
 * 方言の読み書きは `DialectProfile` に任せるので、Phase 4 でメーカーが増えてもここは変わらない。
 *
 * 3つの入口（キー・ツールバーの記号ボタン・格子のダブルクリックと右クリック）はすべてこの欄へ
 * 合流する。欄の中身は2通りの書き方を**同時に**出す。
 *
 * - **1行直接入力**（先頭の欄）: `LD X0` のようにニーモニックとデバイスを空白で区切って書く。
 *   綴りは方言から引くので、シャープでは `STR 000000` になる。空白を含まない入力は
 *   「デバイスだけ」と読み、記号は押したキーのものを使う。
 * - **記号のドロップダウン＋デバイス欄＋設定値欄＋リセット欄**: 1行入力が分からない人の
 *   逃げ道として残す（設計 §5.3）。
 */

const CONTACTS: ReadonlyArray<{ value: ContactForm; label: string }> = [
  { value: 'NO', label: JA.ladder.contactNo },
  { value: 'NC', label: JA.ladder.contactNc },
  { value: 'P', label: JA.ladder.contactRise },
  { value: 'F', label: JA.ladder.contactFall },
];

const OUTPUTS: ReadonlyArray<{ value: OutputForm; label: string }> = [
  { value: 'OUT', label: JA.ladder.coilOut },
  { value: 'SET', label: JA.ladder.coilSet },
  { value: 'RST', label: JA.ladder.coilRst },
  { value: 'TON', label: JA.ladder.timer },
  { value: 'CTU', label: JA.ladder.counter },
  { value: 'MC', label: JA.ladder.mc },
  { value: 'MCR', label: JA.ladder.mcr },
];

/** 確定したセルに添える情報（`LadderEditor` が置き方を決めるのに使う）。 */
export interface DeviceInputExtra {
  /** `OR X1` のように並列の命令で書かれた（OR接点として置く）。 */
  branch?: boolean;
  /** 続けて開いたコメント欄に書かれたデバイスコメント（CX-Programmer 風。設計 §5.2 の S4）。 */
  comment?: string;
}

/** 回路入力欄。確定できたら `onCommit(cell)`。 */
export function DeviceInput({
  initial,
  profile,
  title = JA.ladder.inputTitle,
  application = false,
  commentStep = false,
  onCommit,
  onCancel,
}: {
  initial: CellForm;
  profile: DialectProfile;
  /** 欄の見出し（メーカーの言葉。`SkinTheme.entryTitle`）。省略時は既定の呼び名。 */
  title?: string;
  /** 応用命令欄（三菱 `F8` ／ OMRON `I`）として開く。設計 §5.2 */
  application?: boolean;
  /** デバイス確定のあとコメント欄を続けて開く（CX-Programmer 風。設計 §5.2 の S4）。 */
  commentStep?: boolean;
  /**
   * `buildCell()` は `Cell | Error` を返すが、`commit()` はエラーを `error` に入れて表示するだけで、
   * `onCommit` にはセルが組み立てられたときしか渡さない。呼び出し側で `instanceof Error` を
   * 確かめる必要は無い（Batch 3 レビュー D3）。
   */
  onCommit: (cell: Cell, extra: DeviceInputExtra) => void;
  onCancel: () => void;
}): JSX.Element {
  const [form, setForm] = useState<CellForm>(initial);
  /** 1行直接入力の中身（空なら下の欄をそのまま使う）。設計 §5.3 */
  const [direct, setDirect] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  /*
   * §10.5 の丸め確認の文面は `error` とは別の状態に持つ（レビュー Minor）。以前は `setError()`
   * で入れていたため、`round` が立っているあいだ `device-error` と `round-prompt` の両方に
   * 同じ文が出てしまい、かつ「いいえ」が `round` しか消さないので `error` の方が残っていた。
   */
  const [round, setRound] = useState<
    { rounded: number; baseMs: number; prompt: string } | undefined
  >(undefined);
  /**
   * デバイスが決まったあとのコメント欄（CX-Programmer 風の2段目。設計 §5.2 の S4）。
   * ここに来た時点でセルは組み立て済みで、`Enter` でコメントごと確定する。
   */
  const [placed, setPlaced] = useState<{ cell: Cell; branch?: boolean } | undefined>(undefined);
  const [comment, setComment] = useState('');
  const firstRef = useRef<HTMLInputElement | null>(null);
  const commentRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    if (placed !== undefined) commentRef.current?.focus();
  }, [placed]);

  /*
   * 入力例（placeholder）は**方言の綴りそのもの**から作る（前提#23）。
   * `deviceRanges.input.prefix` だけを使うと、接頭辞を持たない OMRON（`0.00`）と
   * シャープ（`000000`）で入力例が `0` になり、何を入れる欄か分からない。
   */
  const hints = useMemo(() => {
    const preset = profile.timerPreset(3_000, T(0));
    const names = profile.instructionNames;
    return {
      device: profile.formatDevice(X(0)),
      reset: profile.formatDevice(X(2)),
      timer: preset instanceof Error ? '3000' : preset.text,
      // カウンタは Step 3 の `counterPresetText()`（申し送り F-2 のフォールバック込み）
      counter: counterPresetText(5, profile),
      // 1行入力の例も方言の綴りから作る（`LD X0` / `STR 000000` / `SET 100.00`）
      direct: application
        ? `${names.set} ${profile.formatDevice(Y(0))}`
        : `${names.ld} ${profile.formatDevice(X(0))}`,
    };
  }, [profile, application]);

  /** 確定するときの入力欄の形（1行入力があればそちらが勝つ）。 */
  const readForm = (): { form: CellForm; branch?: boolean } | Error => {
    // 1行入力が空なら、下のドロップダウンとデバイス欄をそのまま使う（応用命令欄も同じ）
    if (direct.trim().length === 0) return { form };
    return application
      ? parseApplicationEntry(direct, form, profile)
      : parseDirectEntry(direct, form, profile);
  };

  /** 組み立てたセルを返す（コメント欄を続けて開くスキンでは、その手前で止める）。 */
  const finish = (cell: Cell, branch: boolean | undefined): void => {
    if (commentStep && 'device' in cell) {
      setError(undefined);
      setPlaced(branch === undefined ? { cell } : { cell, branch });
      return;
    }
    onCommit(cell, branch === true ? { branch: true } : {});
  };

  const commit = (presetOverrideMs?: number): void => {
    const read = readForm();
    if (read instanceof Error) {
      setError(read.message);
      setRound(undefined);
      return;
    }
    const next =
      presetOverrideMs === undefined
        ? read.form
        : { ...read.form, presetText: String(presetOverrideMs) };
    /*
     * タイマは「この機種では表せない ms」のときだけ §10.5 の丸め確認を出す。
     * 丸めに「はい」と答えられたら `roundTimerPreset()` の結果で作り直す。
     */
    if (next.target === 'output' && next.output === 'TON' && presetOverrideMs === undefined) {
      const device = profile.parseDevice(next.deviceText);
      if (!(device instanceof Error)) {
        const ms = timerPresetMs(next.presetText, device, profile);
        if (!(ms instanceof Error)) {
          const suggestion = roundSuggestionFor(ms, device, profile);
          if (suggestion !== undefined) {
            setRound({
              rounded: suggestion.rounded,
              baseMs: suggestion.baseMs,
              prompt: timerRoundPrompt(
                suggestion.ms,
                profile.formatDevice(device),
                suggestion.baseMs,
              ),
            });
            setError(undefined);
            return;
          }
        }
      }
    }
    const cell = buildCell(next, profile);
    if (cell instanceof Error) {
      setError(cell.message);
      setRound(undefined);
      return;
    }
    finish(cell, read.branch);
  };

  /** コメント欄（2段目）の確定。 */
  const commitComment = (text: string): void => {
    if (placed === undefined) return;
    const trimmed = text.trim();
    onCommit(placed.cell, {
      ...(placed.branch === true ? { branch: true } : {}),
      ...(trimmed.length === 0 ? {} : { comment: trimmed }),
    });
  };

  /**
   * 入力欄共通のキー操作。指摘 LE-12
   *
   * IME変換中の `Enter`（変換候補の確定）を編集の確定と取り違え、未確定の文字列のまま
   * `parseDevice()` に渡って失敗していた。`isComposing` の間は何もしない。デバイス欄だけに
   * あったこの対処を、1行入力・設定値欄・リセット欄にも同じハンドラとして共有させる。
   */
  const onFieldKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') onCancel();
  };

  return (
    <div className={styles.inputBox} data-testid="device-input" role="dialog" aria-label={title}>
      {placed === undefined ? (
        <>
          <div className={styles.inputRow}>
            {/*
              1行直接入力（設計 §5.3）。`LD X0` のように命令とデバイスを空白で区切って書ける。
              空白を含まない入力は「デバイスだけ」と読むので、いきなりデバイスを打ってもよい。
            */}
            <input
              ref={firstRef}
              className={styles.directInput}
              data-testid="direct-text"
              aria-label={application ? JA.ladder.entry.application : JA.ladder.entry.direct}
              value={direct}
              placeholder={hints.direct}
              onChange={(event) => {
                setDirect(event.target.value);
              }}
              onKeyDown={onFieldKeyDown}
            />
            <span className={styles.inputHint}>
              {application ? JA.ladder.entry.applicationHelp : JA.ladder.entry.directHelp}
            </span>
          </div>
          <div className={styles.inputRow}>
            {form.target === 'contact' ? (
              <select
                data-testid="contact-kind"
                aria-label={JA.ladder.contactKind}
                value={form.contact}
                onChange={(event) => {
                  setForm({ ...form, contact: event.target.value as ContactForm });
                }}
              >
                {CONTACTS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            ) : (
              <select
                data-testid="output-kind"
                aria-label={JA.ladder.outputKind}
                value={form.output}
                onChange={(event) => {
                  setForm({ ...form, output: event.target.value as OutputForm });
                }}
              >
                {OUTPUTS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            )}
            <input
              data-testid="device-text"
              aria-label={JA.ladder.device}
              value={form.deviceText}
              placeholder={hints.device}
              onChange={(event) => {
                setForm({ ...form, deviceText: event.target.value });
              }}
              onKeyDown={onFieldKeyDown}
            />
            {form.target === 'output' && (form.output === 'TON' || form.output === 'CTU') ? (
              <input
                data-testid="preset-text"
                aria-label={JA.ladder.preset}
                value={form.presetText}
                placeholder={form.output === 'TON' ? hints.timer : hints.counter}
                onChange={(event) => {
                  setForm({ ...form, presetText: event.target.value });
                }}
                onKeyDown={onFieldKeyDown}
              />
            ) : null}
            {form.target === 'output' && form.output === 'CTU' ? (
              <input
                data-testid="reset-text"
                aria-label={JA.ladder.resetDevice}
                value={form.resetText}
                placeholder={hints.reset}
                onChange={(event) => {
                  setForm({ ...form, resetText: event.target.value });
                }}
                onKeyDown={onFieldKeyDown}
              />
            ) : null}
            <button
              type="button"
              data-testid="device-commit"
              onClick={() => {
                commit();
              }}
            >
              {JA.ladder.commit}
            </button>
            <button type="button" data-testid="device-cancel" onClick={onCancel}>
              {JA.inspectRepair.cancel}
            </button>
          </div>
        </>
      ) : (
        /*
         * CX-Programmer 風の2段目（設計 §5.2 の S4）。デバイスを確定すると続けてコメント欄が
         * 開き、もう一度 `Enter` で確定する。「取消」はコメントだけをやめてセルは置く
         * （デバイスはもう確定しているので、ここで置かないと打ち直しになる）。
         */
        <div className={styles.inputRow}>
          <input
            ref={commentRef}
            className={styles.directInput}
            data-testid="entry-comment"
            aria-label={JA.ladder.entry.comment}
            value={comment}
            placeholder={JA.ladder.entry.commentHelp}
            onChange={(event) => {
              setComment(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Enter') commitComment(comment);
              if (event.key === 'Escape') commitComment('');
            }}
          />
          <button
            type="button"
            data-testid="device-commit"
            onClick={() => {
              commitComment(comment);
            }}
          >
            {JA.ladder.commit}
          </button>
          <button
            type="button"
            data-testid="device-cancel"
            onClick={() => {
              commitComment('');
            }}
          >
            {JA.inspectRepair.cancel}
          </button>
        </div>
      )}
      {error === undefined ? null : (
        <p className={styles.inputError} data-testid="device-error">
          {error}
        </p>
      )}
      {round === undefined ? null : (
        <p className={styles.inputRound} data-testid="round-prompt">
          {round.prompt}
          <button
            type="button"
            data-testid="round-yes"
            onClick={() => {
              const rounded = round.rounded;
              setRound(undefined);
              setError(undefined);
              setForm({ ...form, presetText: String(rounded) });
              commit(rounded);
            }}
          >
            {JA.ladder.roundYes}
          </button>
          <button
            type="button"
            data-testid="round-no"
            onClick={() => {
              // §10.5: 「いいえ」は確認そのものを引っ込める。`error` も残さない（レビュー Minor）
              setRound(undefined);
              setError(undefined);
            }}
          >
            {JA.ladder.roundNo}
          </button>
        </p>
      )}
    </div>
  );
}
