import { nodeKey, resolveNode, type SchematicDocument } from './document.js';

/** 回路図の同一節点へ同じ線番を振る。故障・通電状態・電線の並びに依存しない。 */
export function schematicWireNumbers(doc: SchematicDocument): ReadonlyMap<string, string> {
  const numbers = new Map<string, string>([
    ['BUS:P', 'P'],
    ['BUS:N', 'N'],
  ]);
  let next = 1;
  for (const rung of doc.rungs) {
    for (let index = 0; index <= rung.cells.length; index += 1) {
      const node = resolveNode(doc, rung, index);
      if (node === undefined) continue;
      const key = nodeKey(node);
      if (!numbers.has(key)) numbers.set(key, String(next++).padStart(2, '0'));
    }
  }
  return numbers;
}
