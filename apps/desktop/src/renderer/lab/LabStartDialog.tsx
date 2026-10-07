import { findLabTemplate, labTemplatesFor, type LabMode } from '@ojt/content';
import { useState, type JSX } from 'react';
import { ConfirmDialog } from '../app/ConfirmDialog.js';
import navigation from '../app/problem-navigation.module.css';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { resumeCurrentProblem } from '../session/problem-navigation.js';
import { plcUnitForVendor } from '../session/plc-skin.js';
import { startLab } from '../session/lab.js';
import styles from './lab.module.css';

/**
 * 回路実験・PLC実験を始める窓（2026-10-08）。設計 §6.1
 *
 * 例題（空のタイムチャートか、内蔵課題から作った4題）を選び、PLC実験は配線済みの盤で始めるか
 * 自分で配線するかを選ぶ（利用者の決定 D3）。いま同じ実験をしていれば「いまの実験を続ける」も出す。
 * PLC実験のメーカーは設定の既定メーカーで始め、練習の画面で切り替えられる。
 */
export function LabStartDialog({
  mode,
  onClose,
}: {
  mode: LabMode;
  onClose: () => void;
}): JSX.Element {
  const resumable = useStore(
    (s) => s.problem !== undefined && s.problem.mode === mode && s.session !== undefined,
  );
  const vendor = useStore((s) => s.defaultVendor);
  const [templateId, setTemplateId] = useState('');
  const [prewired, setPrewired] = useState(true);
  const template = templateId === '' ? undefined : findLabTemplate(mode, templateId);
  const model = plcUnitForVendor(vendor)?.displayName ?? vendor;
  return (
    <ConfirmDialog testId="lab-start" titleId="lab-start-title" onCancel={onClose}>
      <h2 id="lab-start-title">
        {mode === 'assemble-lab' ? JA.lab.startAssembleTitle : JA.lab.startPlcTitle}
      </h2>
      <p>{mode === 'assemble-lab' ? JA.lab.startAssembleBody : JA.lab.startPlcBody(model)}</p>
      <label className={styles.field}>
        {JA.lab.startTemplate}
        <select
          data-testid="lab-start-template"
          value={templateId}
          onChange={(event) => {
            setTemplateId(event.target.value);
          }}
        >
          <option value="">{JA.lab.blankChart}</option>
          {labTemplatesFor(mode).map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.title}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.choiceNote} data-testid="lab-start-template-note">
        {template === undefined ? JA.lab.blankChartNote : template.description}
      </p>
      {mode === 'plc-lab' ? (
        <fieldset className={styles.choices}>
          <legend>{JA.lab.wiringLegend}</legend>
          <label className={styles.choice}>
            <input
              type="radio"
              name="lab-start-wiring"
              data-testid="lab-start-prewired"
              checked={prewired}
              onChange={() => {
                setPrewired(true);
              }}
            />
            <span>
              {JA.lab.prewired}
              <span className={styles.choiceNote}>{JA.lab.prewiredNote}</span>
            </span>
          </label>
          <label className={styles.choice}>
            <input
              type="radio"
              name="lab-start-wiring"
              data-testid="lab-start-self-wire"
              checked={!prewired}
              onChange={() => {
                setPrewired(false);
              }}
            />
            <span>
              {JA.lab.selfWire}
              <span className={styles.choiceNote}>{JA.lab.selfWireNote}</span>
            </span>
          </label>
        </fieldset>
      ) : null}
      <div className={navigation.actions}>
        <button
          type="button"
          data-testid="lab-start-go"
          data-dialog-autofocus
          onClick={() => {
            onClose();
            startLab(mode, {
              vendor,
              prewired,
              ...(templateId === '' ? {} : { templateId }),
            });
          }}
        >
          {JA.lab.startGo}
        </button>
        {resumable ? (
          <button
            type="button"
            data-testid="lab-start-resume"
            onClick={() => {
              onClose();
              resumeCurrentProblem();
            }}
          >
            {JA.lab.resume}
          </button>
        ) : null}
        <button type="button" data-testid="lab-start-cancel" onClick={onClose}>
          {JA.lab.cancel}
        </button>
      </div>
    </ConfirmDialog>
  );
}
