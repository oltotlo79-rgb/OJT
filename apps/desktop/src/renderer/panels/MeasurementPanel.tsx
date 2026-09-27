import { useRef, useState, type JSX } from 'react';
import {
  MEASUREMENT_LIMIT,
  measurementDisplay,
  measurementSetting,
  measurementTime,
} from '../../shared/diagnosis.js';
import { useStore } from '../app/store.js';
import { CollapsiblePanel } from './CollapsiblePanel.js';
import styles from './panels.module.css';

export function MeasurementPanel({ readOnly = false }: { readOnly?: boolean }): JSX.Element {
  const records = useStore((state) => state.measurements);
  const notes = useStore((state) => state.diagnosisNotes);
  const [memo, setMemo] = useState('');
  const [prediction, setPrediction] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [target, setTarget] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [editingId, setEditingId] = useState<string>();
  const targetInput = useRef<HTMLInputElement>(null);
  const clearEditor = (): void => {
    setEditingId(undefined);
    setTarget('');
    setPrediction('');
    setConclusion('');
    setChosen([]);
  };
  return (
    <CollapsiblePanel
      title="測定記録・診断メモ"
      testId="measurement-panel"
      summary={`${records.length}件`}
    >
      {!readOnly && (
        <>
          <label className={styles.formField}>
            測定の目的・気付いたこと
            <textarea
              maxLength={1000}
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
            />
          </label>
          <button
            type="button"
            data-testid="record-measurement"
            disabled={records.length >= MEASUREMENT_LIMIT}
            onClick={() => {
              if (useStore.getState().recordMeasurement(memo)) setMemo('');
              else
                useStore
                  .getState()
                  .toast(
                    'プローブを2点に当て、DCV・Ω・導通の測定値が表示されてから記録してください。通電中の抵抗測定やACVは記録できません。',
                    'error',
                  );
            }}
          >
            今の測定値を記録
          </button>
        </>
      )}
      {records.length === 0 && (
        <p className={styles.hint}>
          測定値を記録すると、修復前後の比較や結果の書き出しに使えます。
        </p>
      )}
      <ol style={{ paddingLeft: 20 }}>
        {records.map((record) => (
          <li key={record.id} data-testid="measurement-record" style={{ marginBlock: 8 }}>
            {!readOnly && (
              <input
                type="checkbox"
                aria-label={`診断メモに関連付ける ${record.black} ${record.red}`}
                checked={chosen.includes(record.id)}
                onChange={(event) =>
                  setChosen(
                    event.target.checked
                      ? [...chosen, record.id]
                      : chosen.filter((id) => id !== record.id),
                  )
                }
              />
            )}
            <strong>
              測定 #{records.indexOf(record) + 1}：{measurementDisplay(record)}
            </strong>{' '}
            — {measurementSetting(record)}
            <br />
            黒: {record.black}／赤: {record.red}{' '}
            {record.partId === undefined ? '' : `対象部品 ${record.partId}`}
            <br />
            {measurementTime(record.at)}・{record.powered ? '通電中' : '電源OFF'}
            <br />
            {record.note}
            {!readOnly && (
              <button
                type="button"
                onClick={() => useStore.getState().removeMeasurement(record.id)}
              >
                記録を削除
              </button>
            )}
          </li>
        ))}
      </ol>
      {!readOnly && (
        <fieldset className={styles.formGroup}>
          <legend>{editingId === undefined ? '診断の根拠を残す' : '診断メモを編集'}</legend>
          <label className={styles.formField}>
            対象の線・端子・部品
            <input
              ref={targetInput}
              maxLength={100}
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          <label className={styles.formField}>
            予測
            <textarea
              maxLength={1000}
              value={prediction}
              onChange={(event) => setPrediction(event.target.value)}
            />
          </label>
          <label className={styles.formField}>
            測定から分かったこと・次に調べること
            <textarea
              maxLength={1000}
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={
              !target.trim() ||
              !conclusion.trim() ||
              (editingId === undefined && notes.length >= MEASUREMENT_LIMIT)
            }
            onClick={() => {
              const state = useStore.getState();
              const note = {
                id: editingId ?? crypto.randomUUID(),
                target,
                prediction,
                conclusion,
                measurementIds: chosen.filter((id) =>
                  state.measurements.some((record) => record.id === id),
                ),
              };
              if (
                editingId !== undefined &&
                !state.diagnosisNotes.some((item) => item.id === editingId)
              ) {
                state.toast(
                  'このメモは削除されています。新しいメモとして入力し直してください。',
                  'warn',
                );
                clearEditor();
                return;
              }
              state.setDiagnosisNotes(
                editingId === undefined
                  ? [...state.diagnosisNotes, note]
                  : state.diagnosisNotes.map((item) => (item.id === editingId ? note : item)),
              );
              clearEditor();
            }}
          >
            {editingId === undefined ? '選んだ測定記録とメモを保存' : 'メモの変更を保存'}
          </button>
          {editingId !== undefined && (
            <button type="button" onClick={clearEditor}>
              編集を取消
            </button>
          )}
        </fieldset>
      )}
      {notes.map((note) => (
        <p key={note.id}>
          <strong>{note.target}</strong>
          <br />
          予測: {note.prediction}
          <br />
          判断: {note.conclusion}
          <br />
          関連測定:{' '}
          {note.measurementIds
            .map((id) => {
              const record = records.find((value) => value.id === id);
              return record === undefined
                ? '削除済み'
                : `#${records.indexOf(record) + 1} ${record.black}→${record.red} ${measurementDisplay(record)}`;
            })
            .join(' ／ ') || 'なし'}
          {!readOnly && (
            <>
              <button
                type="button"
                aria-label={`${note.target}のメモを編集`}
                onClick={() => {
                  setEditingId(note.id);
                  setTarget(note.target);
                  setPrediction(note.prediction);
                  setConclusion(note.conclusion);
                  setChosen(note.measurementIds);
                  targetInput.current?.focus();
                }}
              >
                メモを編集
              </button>
              <button
                type="button"
                aria-label={`${note.target}のメモを削除`}
                onClick={() => {
                  const state = useStore.getState();
                  state.setDiagnosisNotes(
                    state.diagnosisNotes.filter((item) => item.id !== note.id),
                  );
                  if (editingId === note.id) clearEditor();
                }}
              >
                メモを削除
              </button>
            </>
          )}
        </p>
      ))}
    </CollapsiblePanel>
  );
}
