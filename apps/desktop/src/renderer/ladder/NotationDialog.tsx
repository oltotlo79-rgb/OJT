import { isPlcProblem } from '@ojt/content';
import {
  availableDialects,
  switchNotation,
  type DialectId,
  type DialectProfile,
  type NotationSwitchResult,
} from '@ojt/plc-dialects';
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useStore } from '../app/store.js';
import { JA } from '../i18n/ja.js';
import { pushModalLayer, topModalLayer } from '../session/interaction.js';
import { plcForVendor, plcUnitForVendor } from '../session/plc-skin.js';
import styles from './ladder.module.css';

/** 切替先の候補1つ。 */
interface NotationChoice {
  profile: DialectProfile;
  /** この課題の入出力の割付がこのメーカーの機種に収まるか（決定表#10）。 */
  fits: boolean;
  /** 収まらないときの理由（`title` だけに頼らず画面にも出す）。 */
  reason: string | undefined;
}

/**
 * 表記切替ダイアログ。設計仕様 §10.7 / §16 Phase 4 受入基準②。決定表#11・#12
 *
 * **IRは書き換えない**（4A H-2）。切り替えるのは「どの方言で表示するか」だけで、
 * プログラムも取り消しスタックもそのまま残る。ただし機種（3Dの本体と端子名）も一緒に
 * 変わるため、**盤の配線はやり直しになる**。それを先に伝えてから確定する。
 *
 * 画面に出す名前はすべてメーカーの表記（`formatDevice()` の結果）と日本語の文で、
 * 内部のID（方言ID・デバイスのキー・回路ブロックのID）は1つも出さない（利用者要求
 * 「分かりやすく直感的に操作できるUI」）。押せない選択肢は**理由を添えて**淡色にする。
 */
export function NotationDialog({
  profile,
  onClose,
}: {
  profile: DialectProfile;
  onClose: () => void;
}): JSX.Element {
  const program = useStore((s) => s.ladder);
  const problem = useStore((s) => s.problem);
  const [target, setTarget] = useState<DialectId | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement | null>(null);

  /**
   * いま以外の3メーカー。機種に割付が収まらないメーカーは押させない（決定表#10）。
   * 押してから「収まりませんでした」と言われるより、押す前に理由が読めるほうがよい。
   */
  const choices = useMemo<NotationChoice[]>(
    () =>
      availableDialects()
        .filter((other) => other.id !== profile.id)
        .map((other) => {
          const fits =
            problem === undefined ||
            !isPlcProblem(problem) ||
            plcForVendor(problem, other.id) !== undefined;
          const model = plcUnitForVendor(other.id)?.displayName ?? other.displayName;
          return {
            profile: other,
            fits,
            reason: fits ? undefined : JA.ladder.notationNotFit(model),
          };
        }),
    [problem, profile],
  );

  const preview: NotationSwitchResult | undefined = useMemo(() => {
    if (target === undefined || program === undefined) return undefined;
    const to = choices.find((choice) => choice.profile.id === target);
    return to === undefined || !to.fits ? undefined : switchNotation(program, profile, to.profile);
  }, [choices, profile, program, target]);

  const targetName = choices.find((choice) => choice.profile.id === target)?.profile.displayName;

  /**
   * 開いているあいだはモーダルを1枚積む（盤やエディタのショートカットへ Esc を通さない。§8.2）。
   * Esc で閉じられるようにし、開いた直後の読み上げ位置をダイアログの先頭へ移す。
   */
  useEffect(() => {
    const { depth, release } = pushModalLayer();
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      // 上に別のモーダルが乗っているときは、そちらに任せる
      if (event.key !== 'Escape' || depth !== topModalLayer()) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      release();
    };
  }, [onClose]);

  const apply = useCallback((): void => {
    if (preview === undefined) return;
    useStore.getState().switchDialect(preview.to);
    onClose();
  }, [onClose, preview]);

  return (
    <div className={styles.notationOverlay} role="presentation">
      <div
        ref={panelRef}
        className={styles.notation}
        role="dialog"
        aria-modal="true"
        aria-label={JA.ladder.notationTitle}
        data-testid="notation-dialog"
        tabIndex={-1}
      >
        <div className={styles.notationHead}>
          <h2 className={styles.sideTitle}>{JA.ladder.notationTitle}</h2>
          <button
            type="button"
            className={styles.notationClose}
            data-testid="notation-close"
            aria-label={JA.ladder.notationClose}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className={styles.sideNote}>{JA.ladder.notationHelp}</p>
        <p className={styles.notationPickLabel} id="notation-pick-label">
          {JA.ladder.notationPick}
        </p>
        <div className={styles.notationPicker} role="group" aria-labelledby="notation-pick-label">
          {choices.map((choice) => (
            <div key={choice.profile.id} className={styles.notationChoice}>
              <button
                type="button"
                data-testid={`notation-to-${choice.profile.id}`}
                aria-pressed={target === choice.profile.id}
                disabled={!choice.fits}
                onClick={() => {
                  setTarget(choice.profile.id);
                }}
              >
                {choice.profile.displayName}
              </button>
              {choice.reason === undefined ? null : (
                <span
                  className={styles.notationReason}
                  data-testid={`notation-reason-${choice.profile.id}`}
                >
                  {choice.reason}
                </span>
              )}
            </div>
          ))}
        </div>
        {preview === undefined ? (
          <p className={styles.sideNote}>{JA.ladder.notationPickFirst}</p>
        ) : (
          <>
            <p className={styles.notationWarn} data-testid="notation-warning">
              {JA.ladder.notationWarning}
            </p>
            <h3 className={styles.notationSection}>{JA.ladder.notationDevices}</h3>
            <table className={styles.ioTable}>
              <thead>
                <tr>
                  <th scope="col">{JA.ladder.notationFrom}</th>
                  <th scope="col">{JA.ladder.notationTo}</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.length === 0 ? (
                  <tr>
                    <td colSpan={2}>{JA.ladder.notationNoChange}</td>
                  </tr>
                ) : null}
                {preview.changes.map((change, index) => (
                  <tr
                    key={`${change.from}-${String(index)}`}
                    data-testid={`notation-change-${String(index)}`}
                  >
                    <td>{change.from}</td>
                    <td>{change.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.presetChanges.length === 0 ? null : (
              <>
                <h3 className={styles.notationSection}>{JA.ladder.notationPresets}</h3>
                <table className={styles.ioTable}>
                  <thead>
                    <tr>
                      <th scope="col">{JA.ladder.notationFrom}</th>
                      <th scope="col">{JA.ladder.notationTo}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.presetChanges.map((change, index) => (
                      <tr
                        key={`preset-${change.from}-${String(index)}`}
                        data-testid={`notation-preset-${String(index)}`}
                      >
                        <td>{change.from}</td>
                        <td>{change.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            <h3 className={styles.notationSection}>{JA.ladder.notationIssues}</h3>
            {/*
              切替先の方言で表せない項目（決定表#11）。文言は切替先のバリデータが作るので、
              デバイス名は**切替後の表記**で出る（`profile.validate()` は自分の
              `formatDevice()` を使う）。切替前から出ていた指摘は `switchNotation()` が除く。
            */}
            <div data-testid="notation-errors">
              {preview.errors.length === 0 ? (
                <p className={styles.sideNote}>{JA.ladder.notationNoIssue}</p>
              ) : (
                <ul className={styles.notationErrors}>
                  {preview.errors.map((issue, index) => (
                    <li key={`${issue.code}-${String(index)}`}>{issue.message}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className={styles.notationActions}>
              <button
                type="button"
                className={styles.notationPrimary}
                data-testid="notation-apply"
                onClick={apply}
              >
                {targetName === undefined
                  ? JA.ladder.notationApply
                  : JA.ladder.notationApplyTo(targetName)}
              </button>
              <button type="button" data-testid="notation-cancel" onClick={onClose}>
                {JA.inspectRepair.cancel}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
