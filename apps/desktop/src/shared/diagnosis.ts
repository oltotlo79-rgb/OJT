export const MEASUREMENT_LIMIT = 200;
export interface MeasurementRecord {
  id: string;
  at: string;
  tMs: number;
  mode: 'DCV' | 'OHM' | 'CONT';
  kind: 'digital' | 'analog';
  black: string;
  red: string;
  range: number;
  value: number | null;
  display: string;
  powered: boolean;
  partId?: string;
  note: string;
}
export interface DiagnosisNote {
  id: string;
  target: string;
  prediction: string;
  conclusion: string;
  measurementIds: readonly string[];
}

/** 固定した表示にも単位を残す。OL・導通などの状態表示には単位を付けない。 */
export function measurementDisplay(
  record: Pick<MeasurementRecord, 'mode' | 'display' | 'value'>,
): string {
  const unit = record.mode === 'DCV' ? 'V' : record.mode === 'OHM' ? 'Ω' : '';
  return record.value !== null && unit !== '' && record.display !== 'OL'
    ? `${record.display} ${unit}`
    : record.display;
}

/** 保存した測定方式を利用者向けに表す。デジタルで使わないアナログ倍率を表示しない。 */
export function measurementSetting(
  record: Pick<MeasurementRecord, 'kind' | 'mode' | 'range'>,
): string {
  if (record.mode === 'CONT') return `${record.kind === 'digital' ? 'デジタル' : 'アナログ'}・導通`;
  const mode = record.mode === 'OHM' ? '抵抗（Ω）' : '直流電圧（DCV）';
  if (record.kind === 'digital') return `デジタル・${mode}・自動レンジ`;
  return `アナログ・${mode}・${record.mode === 'OHM' ? `×${record.range}` : `${record.range} Vレンジ`}`;
}

export function measurementTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.valueOf())
    ? '時刻不明'
    : date.toLocaleString('ja-JP', { hour12: false });
}

export function isMeasurementRecord(value: unknown): value is MeasurementRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    ['id', 'at', 'black', 'red', 'display', 'note'].every(
      (key) => typeof record[key] === 'string' && record[key].length <= 1000,
    ) &&
    ['DCV', 'OHM', 'CONT'].includes(String(record['mode'])) &&
    ['digital', 'analog'].includes(String(record['kind'])) &&
    typeof record['powered'] === 'boolean' &&
    typeof record['tMs'] === 'number' &&
    Number.isFinite(record['tMs']) &&
    record['tMs'] >= 0 &&
    typeof record['range'] === 'number' &&
    Number.isFinite(record['range']) &&
    record['range'] > 0 &&
    (record['value'] === null ||
      (typeof record['value'] === 'number' && Number.isFinite(record['value']))) &&
    (record['partId'] === undefined || typeof record['partId'] === 'string')
  );
}
