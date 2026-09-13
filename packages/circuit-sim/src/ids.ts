/**
 * 端子・部品・電線の識別子。実行時は素の文字列だが、型の上では取り違えを防ぐためブランドを付ける。
 */

/** 部品インスタンスID（例: `CR1`, `PB1`, `PS`）。`.` を含まない。 */
export type PartId = string & { readonly __brand: 'PartId' };

/** 電線ID（例: `w-001`）。 */
export type WireId = string & { readonly __brand: 'WireId' };

/** 端子ID。`<部品ID>.<端子名>` 形式（設計仕様 §6.4）。端子名側には `.` を含んでよい（例: `PLC.0.00`）。 */
export type TerminalId = `${PartId}.${string}` & { readonly __brand: 'TerminalId' };

/** 識別子が不正なときに投げる。 */
export class IdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdError';
  }
}

/** 文字列を PartId にする。空文字、`.` を含む文字列、`:`（要素IDの区切り文字）を含む文字列は拒否する。 */
export function partId(raw: string): PartId {
  if (raw.length === 0) throw new IdError('部品IDが空です');
  if (raw.includes('.')) throw new IdError(`部品IDに "." は使えません: ${raw}`);
  if (raw.includes(':')) throw new IdError(`部品IDに ":" は使えません: ${raw}`);
  return raw as PartId;
}

/** 文字列を WireId にする。 */
export function wireId(raw: string): WireId {
  if (raw.length === 0) throw new IdError('電線IDが空です');
  return raw as WireId;
}

/** 部品IDと端子名から端子IDを組み立てる（設計仕様 §6.4）。 */
export function terminalId(part: PartId | string, name: string): TerminalId {
  const p = partId(part);
  if (name.length === 0) throw new IdError(`端子名が空です: ${p}`);
  return `${p}.${name}` as TerminalId;
}

/** 端子IDを部品IDと端子名に分解する。最初の `.` で分割する。 */
export function parseTerminalId(id: TerminalId | string): { part: PartId; name: string } {
  const dot = id.indexOf('.');
  if (dot <= 0 || dot === id.length - 1) throw new IdError(`端子IDの形式が不正です: ${id}`);
  return { part: id.slice(0, dot) as PartId, name: id.slice(dot + 1) };
}

/** 端子IDが属する部品IDを返す。 */
export function terminalOwner(id: TerminalId): PartId {
  return parseTerminalId(id).part;
}

/** 素の文字列を検証して TerminalId にする。`parseTerminalId` で形式を検証し、不正なら IdError。 */
export function toTerminalId(raw: string): TerminalId {
  parseTerminalId(raw);
  return raw as TerminalId;
}
