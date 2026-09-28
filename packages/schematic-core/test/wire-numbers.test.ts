import { describe, expect, it } from 'vitest';
import { layout, nodeKey, resolveNode, schematicWireNumbers } from '../src/index.js';
import { selfHoldDoc } from './helpers/docs.js';

describe('線番', () => {
  it('自己保持の分岐を同じ番号にし、母線をP/Nとして表示する', () => {
    const doc = selfHoldDoc();
    const numbers = schematicWireNumbers(doc);
    expect(numbers.get('BUS:P')).toBe('P');
    expect(numbers.get('BUS:N')).toBe('N');
    for (const rung of doc.rungs) {
      for (let n = 0; n <= rung.cells.length; n += 1) {
        const node = resolveNode(doc, rung, n);
        expect(node).toBeDefined();
        expect(numbers.has(nodeKey(node!))).toBe(true);
      }
    }
    const shapes = layout(doc, { wireNumbers: numbers }).shapes.filter(
      (shape) => shape.role === 'wire-number',
    );
    expect(shapes).toHaveLength(doc.rungs.reduce((sum, rung) => sum + rung.cells.length * 2, 0));
    expect(layout(doc).shapes.some((shape) => shape.role === 'wire-number')).toBe(false);
  });
});
