import { JIPM_BOARD, withPlcUnit, type PlcUnitDefinition } from '@ojt/board-model';
import type { ResolvedPlcIo } from '@ojt/content';
import { X, Y } from '@ojt/ladder-core';
import type { DialectProfile } from '@ojt/plc-dialects';
import { useState, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { planPlcAssignment } from '../session/plc-assignment.js';
import { commitWireEdit } from '../session/wire-edit.js';
import styles from '../panels/panels.module.css';

export function IoAssignmentEditor({
  io,
  unit,
  profile,
}: {
  io: ResolvedPlcIo;
  unit: PlcUnitDefinition;
  profile: DialectProfile;
}): JSX.Element | null {
  const session = useStore((state) => state.session);
  const disabled = useStore(
    (state) => state.snapshot.powered || state.plcRunning || state.replay !== undefined,
  );
  const [draft, setDraft] = useState<ResolvedPlcIo>();
  const [rewire, setRewire] = useState(false);
  if (io.mode !== 'free' || session === undefined) return null;
  const plan =
    draft === undefined
      ? undefined
      : planPlcAssignment(session, withPlcUnit(JIPM_BOARD, unit), io, draft, rewire);
  const removed = plan?.ok
    ? session.wires.filter(
        (wire) => !plan.value.wires.some((candidate) => candidate.id === wire.id),
      )
    : [];
  const added = plan?.ok
    ? plan.value.wires.filter(
        (wire) => !session.wires.some((candidate) => candidate.id === wire.id),
      )
    : [];
  return (
    <div data-testid="io-assignment-editor">
      {draft === undefined ? (
        <button type="button" disabled={disabled} onClick={() => setDraft(structuredClone(io))}>
          I/O割付を変更
        </button>
      ) : (
        <fieldset disabled={disabled}>
          <legend>自由割付の編集</legend>
          {draft.inputs.map((input, index) => (
            <label key={input.pb} className={styles.formField}>
              {input.pb} →{' '}
              <select
                aria-label={`${input.pb} の入力`}
                value={input.x}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    inputs: draft.inputs.map((item, n) =>
                      n === index ? { ...item, x: Number(event.target.value) } : item,
                    ),
                  })
                }
              >
                {unit.spec.inputs.map((_, x) => (
                  <option key={x} value={x}>
                    {profile.formatDevice(X(x))}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {draft.outputs.map((output, index) => (
            <label key={output.pl} className={styles.formField}>
              {output.cr} → {output.pl}
              <select
                aria-label={`${output.cr} の出力`}
                value={output.y}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    outputs: draft.outputs.map((item, n) =>
                      n === index ? { ...item, y: Number(event.target.value) } : item,
                    ),
                  })
                }
              >
                {unit.spec.outputs.map((_, y) => (
                  <option key={y} value={y}>
                    {profile.formatDevice(Y(y))}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className={styles.formField}>
            入力方式
            <select
              value={draft.wiring}
              onChange={(event) =>
                setDraft({ ...draft, wiring: event.target.value as 'sink' | 'source' })
              }
            >
              <option value="sink">シンク（入力COM=P側）</option>
              <option value="source">ソース（入力COM=N側）</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={rewire}
              onChange={(event) => setRewire(event.target.checked)}
            />
            推奨配線へ一括変更する（電源・入力・リレー・表示灯）
          </label>
          <p>
            割付表のみの変更では電線は移動しません。ラダーのX/Y番号は別途合わせてください。通電前に接続と入力方式を確認します。
          </p>
          {plan?.ok ? (
            <>
              <p>
                削除 {removed.length}本／追加 {added.length}本。確定後もUndoできます。
              </p>
              <details>
                <summary>配線の変更内容</summary>
                <ul>
                  {removed.map((wire) => (
                    <li key={`r-${wire.id}`}>
                      削除 {wire.from} → {wire.to}
                    </li>
                  ))}
                  {added.map((wire) => (
                    <li key={`a-${wire.id}`}>
                      追加 {wire.from} → {wire.to}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p role="alert">{plan?.message}</p>
          )}
          <button
            type="button"
            disabled={plan?.ok !== true}
            onClick={() => {
              if (plan !== undefined && commitWireEdit(plan)) setDraft(undefined);
            }}
          >
            確認して確定
          </button>
          <button type="button" onClick={() => setDraft(undefined)}>
            取消
          </button>
        </fieldset>
      )}
      {disabled && <p>盤電源をOFF、PLCをSTOPにすると変更できます。</p>}
    </div>
  );
}
