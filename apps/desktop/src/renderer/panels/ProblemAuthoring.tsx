import { useEffect, useMemo, useState, type JSX } from 'react';
import { FAULT_KINDS, PART_TRUTHS, PART_TRUTH_LABELS } from '@ojt/content';
import { FREE_TRAINING_RULES, MOUNTABLE_KINDS, TRAINING_CHECK_IDS } from '@ojt/board-model';
import type { AuthoringRequest } from '../../shared/authoring.js';
import type { ProblemSummary } from '../../shared/ipc.js';
import { isRecord } from '../../shared/work-file-schema.js';
import { ojtApi, tryOjtApi } from '../app/ojt-api.js';
import { CollapsiblePanel } from './CollapsiblePanel.js';
import { AuthoringReferenceEditor } from './AuthoringReferenceEditor.js';
import { readAuthoringReference, type AuthoringReference } from '../session/authoring-reference.js';
import { JA } from '../i18n/ja.js';
import styles from './problem-authoring.module.css';
import {
  editAuthoringText,
  flushAuthoringDraft,
  retryAuthoringDraft,
  useAuthoringDraft,
} from '../session/authoring-draft.js';

type Row = Record<string, unknown>;
const OPTION_LABELS: Readonly<Record<string, string>> = {
  ...PART_TRUTH_LABELS,
  ...JA.reportKind,
  'contact-open': '接点の導通不良',
  'contact-welded': '接点の溶着',
  'contact-resistive': '接点抵抗の増大',
  'coil-layer-short': 'コイルのレアショート',
  'lamp-open': '表示灯の断線',
  'relay-my4n': 'リレー MY4N',
  'timer-h3y4': 'タイマ H3Y-4',
  press: '押す',
  release: '離す',
};
const fieldText = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
type Column = { key: string; label: string; values?: readonly string[]; numeric?: boolean };
const operationColumns: readonly Column[] = [
  { key: 't', label: '時刻（ms／10の倍数）', numeric: true },
  {
    key: 'target',
    label: '押ボタン',
    values: ['PB1', 'PB2', 'PB3', 'PB4', 'PB5', 'PB6', 'PB7', 'PB8'],
  },
  { key: 'action', label: '操作', values: ['press', 'release'] },
];

function ArrayEditor({
  label,
  rows,
  columns,
  empty,
  onChange,
}: {
  label: string;
  rows: readonly Row[];
  columns: readonly Column[];
  empty: Row;
  onChange: (rows: Row[]) => void;
}): JSX.Element {
  return (
    <details>
      <summary>
        {label}（{rows.length}件）
      </summary>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              <th>行</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {columns.map((column) => {
                  const value = row[column.key];
                  const changed = (text: string): void =>
                    onChange(
                      rows.map((item, n) =>
                        n === index
                          ? { ...item, [column.key]: column.numeric ? Number(text) : text }
                          : item,
                      ),
                    );
                  return (
                    <td key={column.key}>
                      {column.values === undefined ? (
                        <input
                          aria-label={`${label} ${index + 1} ${column.label}`}
                          style={{ width: '100%', minWidth: 70 }}
                          type={column.numeric ? 'number' : 'text'}
                          value={
                            typeof value === 'string' || typeof value === 'number' ? value : ''
                          }
                          onChange={(event) => changed(event.target.value)}
                        />
                      ) : (
                        <select
                          aria-label={`${label} ${index + 1} ${column.label}`}
                          value={fieldText(value ?? '')}
                          onChange={(event) => changed(event.target.value)}
                        >
                          {column.values.map((option) => (
                            <option key={option} value={option}>
                              {OPTION_LABELS[option] ?? option}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  );
                })}
                <td>
                  <button
                    type="button"
                    aria-label={`${label} ${index + 1}行を削除`}
                    onClick={() => onChange(rows.filter((_, n) => n !== index))}
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        disabled={rows.length >= 200}
        onClick={() => onChange([...rows, structuredClone(empty)])}
      >
        行を追加
      </button>
    </details>
  );
}

export function ProblemAuthoring({
  directory,
  onDirectory,
}: {
  directory: string;
  onDirectory: (directory: string) => void;
}): JSX.Element {
  const [problems, setProblems] = useState<readonly ProblemSummary[]>([]);
  const {
    templateId,
    text,
    savedText,
    validation,
    message,
    busy,
    savedDirectory,
    persistence,
    persistenceMessage,
    savedAt,
  } = useAuthoringDraft();
  const setTemplateId = (templateId: string): void => useAuthoringDraft.setState({ templateId });
  const setMessage = (message: string): void => useAuthoringDraft.setState({ message });
  const setBusy = (busy: boolean): void => useAuthoringDraft.setState({ busy });
  const [replacement, setReplacement] = useState<AuthoringRequest>();
  const [discardDraft, setDiscardDraft] = useState(false);
  const [referenceEditor, setReferenceEditor] = useState<{
    reference: AuthoringReference;
    definition: Row;
    originalText: string;
  }>();
  useEffect(() => {
    let disposed = false;
    const api = tryOjtApi();
    if (api?.listProblems === undefined) return;
    void api.listProblems().then(
      (list) => {
        if (!disposed) setProblems(list.problems);
      },
      (error) => {
        if (!disposed) setMessage(String(error));
      },
    );
    return () => {
      disposed = true;
    };
  }, []);
  const definition = useMemo((): Row | undefined => {
    try {
      const value: unknown = JSON.parse(text);
      return isRecord(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }, [text]);
  const edit = editAuthoringText;
  const patch = (changes: Row): void => {
    if (definition !== undefined) edit(JSON.stringify({ ...definition, ...changes }, null, 2));
  };
  const rowsOf = (value: unknown): Row[] => (Array.isArray(value) ? value.filter(isRecord) : []);
  const act = async (request: AuthoringRequest): Promise<void> => {
    const api = ojtApi().authorContent;
    if (api === undefined) {
      setMessage('課題作成機能を読み込めません。アプリを起動し直してください。');
      return;
    }
    setBusy(true);
    const requestedRevision = useAuthoringDraft.getState().revision;
    setMessage(
      request.action === 'validate' || request.action === 'save'
        ? '模範の自己判定を実行しています…'
        : '処理中…',
    );
    try {
      const result = await api(request);
      if (useAuthoringDraft.getState().revision !== requestedRevision) {
        setMessage(
          '処理中に編集内容が変わりました。現在の下書きを保持しました。もう一度検証してください。',
        );
        return;
      }
      if (result.validation !== undefined)
        useAuthoringDraft.setState({ validation: result.validation });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      if (result.text !== undefined) {
        editAuthoringText(result.text);
        useAuthoringDraft.setState({ savedText: request.action === 'open' ? result.text : '' });
      }
      if (request.action === 'choose-directory' && result.directory !== undefined)
        onDirectory(result.directory);
      if (result.path !== undefined) {
        useAuthoringDraft.setState({ savedText: text, savedDirectory: result.directory ?? '' });
      }
      setMessage(
        result.path !== undefined
          ? `保存しました：${result.path}。このJSONを配布できます。`
          : result.validation !== undefined
            ? result.validation.reasons.length === 0
              ? '検証合格：形式・機種能力・模範の動作を確認しました。'
              : '検証で指摘があります。項目名を手掛かりに修正してください。'
            : request.action === 'template'
              ? '新しいIDの複製を作りました。内容を編集して検証してください。'
              : '完了しました。',
      );
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  };
  const replace = (request: AuthoringRequest): void => {
    if (text && text !== savedText) setReplacement(request);
    else void act(request);
  };
  const io = definition !== undefined && isRecord(definition['io']) ? definition['io'] : undefined;
  const board =
    definition !== undefined && isRecord(definition['board']) ? definition['board'] : undefined;
  const profile = board !== undefined && isRecord(board['profile']) ? board['profile'] : undefined;
  const rules = profile !== undefined && isRecord(profile['rules']) ? profile['rules'] : {};
  const patchRules = (change: Row): void =>
    patch({ board: { ...board, profile: { ...profile, rules: { ...rules, ...change } } } });
  const faults = definition?.['faults'];
  const faultRows = rowsOf(faults).map((row) => ({
    ...row,
    ...(isRecord(row['target']) ? row['target'] : {}),
  }));
  return (
    <CollapsiblePanel
      title="課題の導入・作成"
      testId="problem-authoring"
      summary="複製・編集・模範検証・JSON配布"
    >
      <p aria-live="polite" data-testid="authoring-draft-status">
        {persistence === 'loading'
          ? '課題下書きを読み込んでいます…'
          : persistence === 'failed'
            ? '課題下書きの保存を確認できません'
            : persistence === 'saving'
              ? '課題下書きを保存中…'
              : persistence === 'pending'
                ? '課題下書きの保存待ち'
                : text && savedAt
                  ? `課題下書き保存済み ${new Date(savedAt).toLocaleTimeString('ja-JP')}`
                  : '編集中の課題は下書きとして自動保存します。'}
      </p>
      {persistenceMessage && <p role="alert">{persistenceMessage}</p>}
      {persistence === 'failed' && (
        <button
          type="button"
          onClick={() => {
            void retryAuthoringDraft();
          }}
        >
          下書きの保存を再試行
        </button>
      )}
      {text && (
        <>
          <p>
            下書きは、このPCで編集を続けるための控えです。配布する課題は「検証してJSONを保存」で書き出します。
          </p>
          <button
            type="button"
            disabled={persistence === 'loading'}
            onClick={() => {
              void flushAuthoringDraft();
            }}
          >
            下書きを今すぐ保存
          </button>
          <button type="button" disabled={busy} onClick={() => setDiscardDraft(true)}>
            下書きを破棄…
          </button>
        </>
      )}
      {discardDraft && (
        <div role="alert">
          <p>このPCの課題作成の下書きを空にしますか？</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              editAuthoringText('');
              useAuthoringDraft.setState({
                savedText: '',
                savedDirectory: '',
                templateId: '',
                message: '課題下書きを空にしました。',
              });
              setDiscardDraft(false);
              void flushAuthoringDraft();
            }}
          >
            下書きを破棄する
          </button>
          <button type="button" onClick={() => setDiscardDraft(false)}>
            取消
          </button>
        </div>
      )}
      <fieldset disabled={busy || persistence === 'loading'} className={styles.form}>
        <p>
          内蔵課題を複製して変更し、模範の自己判定に合格してから保存します。JSONを渡すだけで、ほかのPCにも課題を追加できます。
        </p>
        <button
          type="button"
          onClick={() => {
            void act({ action: 'choose-directory' });
          }}
        >
          利用者課題フォルダを選ぶ
        </button>
        <button
          type="button"
          disabled={!directory}
          onClick={() => {
            void act({ action: 'open-directory' });
          }}
        >
          このフォルダを開く
        </button>
        <label>
          複製元
          <select
            aria-label="複製元の課題"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            <option value="">課題を選択</option>
            {problems.map((problem) => (
              <option key={problem.id} value={problem.id}>
                {problem.id}：{problem.title}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!templateId}
          onClick={() => replace({ action: 'template', id: templateId })}
        >
          課題を複製
        </button>
        <button type="button" onClick={() => replace({ action: 'open' })}>
          課題JSONを開く
        </button>
        {replacement !== undefined && (
          <div role="alert">
            <p>編集中の未保存内容を置き換えます。残す場合は先に保存してください。</p>
            <button
              type="button"
              onClick={() => {
                const next = replacement;
                setReplacement(undefined);
                void act(next);
              }}
            >
              置き換える
            </button>
            <button type="button" onClick={() => setReplacement(undefined)}>
              取消
            </button>
          </div>
        )}
        {definition !== undefined && (
          <>
            <label>
              課題ID
              <input
                value={fieldText(definition['id'] ?? '')}
                onChange={(event) => patch({ id: event.target.value })}
              />
            </label>
            {definition['mode'] === 'assemble' && board !== undefined && (
              <fieldset>
                <legend>盤と訓練ルール</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={profile !== undefined}
                    onChange={(event) =>
                      patch({
                        board: {
                          ...board,
                          profile: event.target.checked
                            ? {
                                id: 'expanded',
                                terminalPairs: 4,
                                extraPushButtons: 1,
                                extraLamps: 1,
                                rules: FREE_TRAINING_RULES,
                              }
                            : undefined,
                        },
                      })
                    }
                  />
                  自由練習用の拡張盤を使う
                </label>
                {profile !== undefined && (
                  <>
                    {(
                      [
                        { key: 'terminalPairs', label: '中継端子の対数', max: 8 },
                        { key: 'extraPushButtons', label: '追加押ボタン数（PB5〜）', max: 4 },
                        { key: 'extraLamps', label: '追加表示灯数（PL5〜）', max: 4 },
                      ] as const
                    ).map((field) => (
                      <label key={field.key}>
                        {field.label}
                        <input
                          type="number"
                          min={0}
                          max={field.max}
                          value={Number(profile[field.key])}
                          onChange={(event) =>
                            patch({
                              board: {
                                ...board,
                                profile: { ...profile, [field.key]: Number(event.target.value) },
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                    <p>
                      中継端子は同じ番号のa–b間が内部でつながっています。1端子に接続できる電線は、どの盤でも2本までです（3本目は画面で止めます）。自由練習の線色などは以下で変更できます。
                    </p>
                    <fieldset>
                      <legend>使える線色</legend>
                      {['青', '白', '黄'].map((color) => (
                        <label key={color}>
                          <input
                            type="checkbox"
                            checked={
                              Array.isArray(rules['allowedColors']) &&
                              rules['allowedColors'].includes(color)
                            }
                            onChange={(event) => {
                              const colors = Array.isArray(rules['allowedColors'])
                                ? rules['allowedColors'].filter(
                                    (value: unknown): value is string => typeof value === 'string',
                                  )
                                : [];
                              patchRules({
                                allowedColors: event.target.checked
                                  ? [...colors, color]
                                  : colors.filter((item) => item !== color),
                              });
                            }}
                          />
                          {color}
                        </label>
                      ))}
                    </fieldset>
                    <fieldset>
                      <legend>使える装着部品</legend>
                      {MOUNTABLE_KINDS.map((kind) => (
                        <label key={kind}>
                          <input
                            type="checkbox"
                            checked={
                              !Array.isArray(rules['allowedParts']) ||
                              rules['allowedParts'].includes(kind)
                            }
                            onChange={(event) => {
                              const kinds = Array.isArray(rules['allowedParts'])
                                ? rules['allowedParts'].filter(
                                    (value: unknown): value is string => typeof value === 'string',
                                  )
                                : [...MOUNTABLE_KINDS];
                              patchRules({
                                allowedParts: event.target.checked
                                  ? [...kinds, kind]
                                  : kinds.filter((item) => item !== kind),
                              });
                            }}
                          />
                          {kind === 'relay-my4n' ? 'リレー' : 'タイマ'}
                        </label>
                      ))}
                    </fieldset>
                    <label>
                      ヒントの出し方
                      <select
                        aria-label="ヒントの出し方"
                        value={fieldText(rules['hintPolicy'] ?? 'task')}
                        onChange={(event) => patchRules({ hintPolicy: event.target.value })}
                      >
                        <option value="task">級のルールに従う</option>
                        <option value="always">全段階・回路図を利用可</option>
                        <option value="off">ヒント・回路図を表示しない</option>
                      </select>
                    </label>
                    <fieldset>
                      <legend>判定する配線規則</legend>
                      {TRAINING_CHECK_IDS.map((id) => {
                        const checks = isRecord(rules['staticChecks']) ? rules['staticChecks'] : {};
                        const labels = {
                          wireColorRule: '線色',
                          terminalLimit: '端子本数',
                          unusedParts: '未使用部品',
                          forbiddenCircuit: '禁則回路',
                          coilPolarity: 'コイル極性',
                          powerSequence: '電源手順',
                        };
                        return (
                          <label key={id}>
                            {labels[id]}
                            <select
                              value={
                                checks[id] === undefined
                                  ? 'task'
                                  : checks[id] === true
                                    ? 'true'
                                    : 'false'
                              }
                              onChange={(event) => {
                                const next = { ...checks };
                                if (event.target.value === 'task') delete next[id];
                                else next[id] = event.target.value === 'true';
                                patchRules({ staticChecks: next });
                              }}
                            >
                              <option value="task">課題の設定に従う</option>
                              <option value="true">判定する</option>
                              <option value="false">判定しない</option>
                            </select>
                          </label>
                        );
                      })}
                    </fieldset>
                  </>
                )}
              </fieldset>
            )}
            <label>
              課題名
              <input
                value={fieldText(definition['title'] ?? '')}
                onChange={(event) => patch({ title: event.target.value })}
              />
            </label>
            <label>
              操作・達成条件の説明
              <textarea
                aria-label="操作・達成条件の説明"
                rows={4}
                value={fieldText(definition['description'] ?? '')}
                onChange={(event) => patch({ description: event.target.value })}
              />
            </label>
            {problems.some((problem) => problem.id === definition['id']) && (
              <p role="alert">
                このIDは既存の課題と同じです。利用者課題フォルダに保存すると、そのIDの課題を置き換えます。別の課題として追加する場合はIDを変更してください。
              </p>
            )}
            {'operations' in definition && (
              <>
                <label>
                  判定区間（ms）
                  <input
                    type="number"
                    step={10}
                    value={Number(definition['durationMs'])}
                    onChange={(event) => patch({ durationMs: Number(event.target.value) })}
                  />
                </label>
                <ArrayEditor
                  label="操作列"
                  rows={rowsOf(definition['operations'])}
                  columns={operationColumns}
                  empty={{ t: 1000, target: 'PB1', action: 'press' }}
                  onChange={(operations) => patch({ operations })}
                />
              </>
            )}
            {io !== undefined && (
              <>
                <label>
                  入力方式
                  <select
                    value={fieldText(io['wiring'] ?? 'sink')}
                    onChange={(event) => patch({ io: { ...io, wiring: event.target.value } })}
                  >
                    <option value="sink">シンク</option>
                    <option value="source">ソース</option>
                  </select>
                </label>
                <ArrayEditor
                  label="PLC入力割付"
                  rows={rowsOf(io['inputs'])}
                  columns={[
                    { key: 'x', label: 'X番号（10進）', numeric: true },
                    { key: 'pb', label: '押ボタン', values: ['PB1', 'PB2', 'PB3', 'PB4'] },
                  ]}
                  empty={{ x: 0, pb: 'PB1' }}
                  onChange={(inputs) => patch({ io: { ...io, inputs } })}
                />
                <ArrayEditor
                  label="PLC出力割付"
                  rows={rowsOf(io['outputs'])}
                  columns={[
                    { key: 'y', label: 'Y番号（10進）', numeric: true },
                    { key: 'cr', label: '中継リレー', values: ['CR1', 'CR2', 'CR3', 'CR4'] },
                    { key: 'pl', label: '表示灯', values: ['PL1', 'PL2', 'PL3', 'PL4'] },
                  ]}
                  empty={{ y: 0, cr: 'CR1', pl: 'PL1' }}
                  onChange={(outputs) => patch({ io: { ...io, outputs } })}
                />
              </>
            )}
            {Array.isArray(faults) && (
              <ArrayEditor
                label="故障条件"
                rows={faultRows}
                columns={[
                  { key: 'kind', label: '故障種別', values: FAULT_KINDS },
                  { key: 'wireId', label: '電線ID' },
                  { key: 'partId', label: '部品ID' },
                  { key: 'elementIndex', label: '要素番号', numeric: true },
                  { key: 'to', label: '誤配線先の端子' },
                ]}
                empty={{ kind: 'wire-open', wireId: 'sw-001' }}
                onChange={(rows) =>
                  patch({
                    faults: rows.map((row) => {
                      const { wireId, partId, elementIndex, ...other } = row;
                      delete other['target'];
                      return {
                        ...other,
                        ...(other['kind'] === 'wire-misrouted' ? {} : { to: undefined }),
                        target: fieldText(other['kind']).startsWith('wire-')
                          ? { wireId }
                          : { partId, elementIndex: Number(elementIndex ?? 0) },
                      };
                    }),
                  })
                }
              />
            )}
            {Array.isArray(definition['parts']) && (
              <ArrayEditor
                label="部品点検の出題部品"
                rows={rowsOf(definition['parts'])}
                columns={[
                  { key: 'id', label: '部品ID' },
                  { key: 'kind', label: '部品', values: ['relay-my4n', 'timer-h3y4'] },
                  { key: 'truth', label: '正解', values: PART_TRUTHS },
                  { key: 'group', label: '接点組（1〜4）', numeric: true },
                ]}
                empty={{ id: 'part-new', kind: 'relay-my4n', truth: 'normal', group: 1 }}
                onChange={(parts) => patch({ parts })}
              />
            )}
          </>
        )}
        {text && (
          <>
            {definition !== undefined &&
              ['assemble', 'inspect-repair', 'plc'].includes(fieldText(definition['mode'])) && (
                <p>
                  <button
                    type="button"
                    data-testid="author-reference-open"
                    onClick={() => {
                      const reference = readAuthoringReference(definition);
                      if (typeof reference === 'string') setMessage(reference);
                      else setReferenceEditor({ reference, definition, originalText: text });
                    }}
                  >
                    {definition['mode'] === 'plc' ? '模範ラダーを編集' : '模範回路図を編集'}
                  </button>
                  記号を選んで編集できます。途中の回路も下書きに保存します。
                </p>
              )}
            <details open={definition === undefined}>
              <summary>詳細JSONを編集（高度な設定・データ形式の修正）</summary>
              <textarea
                aria-label="課題定義JSON"
                rows={16}
                spellCheck={false}
                style={{ width: '100%', fontFamily: 'monospace' }}
                value={text}
                onChange={(event) => edit(event.target.value)}
              />
            </details>
            <button
              type="button"
              onClick={() => {
                void act({ action: 'validate', text });
              }}
            >
              課題を検証（模範の自己判定）
            </button>
            <button
              type="button"
              onClick={() => {
                void act({ action: 'save', text });
              }}
            >
              検証してJSONを保存
            </button>
          </>
        )}
      </fieldset>
      <p role="status">{message}</p>
      {validation !== undefined && (
        <>
          <p>{validation.note}</p>
          <ul>
            {validation.reasons.map((reason, index) => (
              <li key={index}>{reason}</li>
            ))}
          </ul>
        </>
      )}
      {savedDirectory && savedDirectory !== directory && (
        <button type="button" onClick={() => onDirectory(savedDirectory)}>
          保存先を利用者課題フォルダに設定する
        </button>
      )}
      {referenceEditor !== undefined && (
        <AuthoringReferenceEditor
          reference={referenceEditor.reference}
          onChange={(changes) =>
            editAuthoringText(
              JSON.stringify({ ...referenceEditor.definition, ...changes }, null, 2),
            )
          }
          onVerify={() => {
            void act({ action: 'validate', text: useAuthoringDraft.getState().text });
          }}
          onClose={() => setReferenceEditor(undefined)}
          onCancel={() => {
            editAuthoringText(referenceEditor.originalText);
            setReferenceEditor(undefined);
          }}
        />
      )}
    </CollapsiblePanel>
  );
}
