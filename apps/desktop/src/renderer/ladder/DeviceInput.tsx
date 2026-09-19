import { T } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { JA, timerRoundPrompt } from '../i18n/ja.js';
import {
  buildCell,
  roundSuggestionFor,
  timerPresetMs,
  type CellForm,
  type ContactForm,
  type OutputForm,
} from '../session/ladder-cell.js';
import styles from './ladder.module.css';

/**
 * デバイス入力欄。設計仕様 §10.5 / §10.7。
 * 方言の読み書きは `DialectProfile` に任せるので、Phase 4 でメーカーが増えてもここは変わらない。
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

/** デバイス入力欄。確定できたら `onCommit(cell)`。 */
export function DeviceInput({
  initial,
  profile,
  onCommit,
  onCancel,
}: {
  initial: CellForm;
  profile: DialectProfile;
  onCommit: (cell: ReturnType<typeof buildCell>) => void;
  onCancel: () => void;
}): JSX.Element {
  const [form, setForm] = useState<CellForm>(initial);
  const [error, setError] = useState<string | undefined>(undefined);
  const [round, setRound] = useState<{ rounded: number; baseMs: number } | undefined>(undefined);
  const firstRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  /*
   * 入力例（placeholder）も**方言から引く**（レビュー Minor）。`'X0'` や `'K30'` を直書きすると、
   * Phase 4 でメーカーが増えたときにここだけ三菱の綴りのまま取り残される。
   */
  const hints = useMemo(() => {
    const preset = profile.timerPreset(3_000, T(0));
    return {
      device: `${profile.deviceRanges.input.prefix}0`,
      reset: `${profile.deviceRanges.input.prefix}2`,
      timer: preset instanceof Error ? '3000' : preset.text,
      counter: '5',
    };
  }, [profile]);

  const commit = (presetOverrideMs?: number): void => {
    const next =
      presetOverrideMs === undefined ? form : { ...form, presetText: String(presetOverrideMs) };
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
            setRound({ rounded: suggestion.rounded, baseMs: suggestion.baseMs });
            setError(
              timerRoundPrompt(suggestion.ms, profile.formatDevice(device), suggestion.baseMs),
            );
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
    onCommit(cell);
  };

  return (
    <div
      className={styles.inputBox}
      data-testid="device-input"
      role="dialog"
      aria-label={JA.ladder.inputTitle}
    >
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
          ref={firstRef}
          data-testid="device-text"
          aria-label={JA.ladder.device}
          value={form.deviceText}
          placeholder={hints.device}
          onChange={(event) => {
            setForm({ ...form, deviceText: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') onCancel();
          }}
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
      {error === undefined ? null : (
        <p className={styles.inputError} data-testid="device-error">
          {error}
        </p>
      )}
      {round === undefined ? null : (
        <p className={styles.inputRound} data-testid="round-prompt">
          {error}
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
              setRound(undefined);
            }}
          >
            {JA.ladder.roundNo}
          </button>
        </p>
      )}
    </div>
  );
}
