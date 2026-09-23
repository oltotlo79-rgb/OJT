import { useState, type JSX } from 'react';
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
          <legend>診断の根拠を残す</legend>
          <label className={styles.formField}>
            対象の線・端子・部品
            <input
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
            disabled={!target.trim() || !conclusion.trim() || notes.length >= MEASUREMENT_LIMIT}
            onClick={() => {
              useStore.getState().setDiagnosisNotes([
                ...notes,
                {
                  id: crypto.randomUUID(),
                  target,
                  prediction,
                  conclusion,
                  measurementIds: chosen.filter((id) => records.some((record) => record.id === id)),
                },
              ]);
              setTarget('');
              setPrediction('');
              setConclusion('');
              setChosen([]);
            }}
          >
            選んだ測定記録とメモを保存
          </button>
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
        </p>
      ))}
    </CollapsiblePanel>
  );
}
