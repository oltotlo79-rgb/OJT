import { describe, expect, it } from 'vitest';
import {
  IdError,
  parseTerminalId,
  partId,
  terminalId,
  terminalOwner,
  wireId,
} from '../src/index.js';

describe('ids', () => {
  it('部品IDと端子名から端子IDを組み立てる（§6.4）', () => {
    expect(terminalId('CR1', '13')).toBe('CR1.13');
    expect(terminalId('PL1', '+')).toBe('PL1.+');
    expect(terminalId('TB_PB', '4c')).toBe('TB_PB.4c');
  });

  it('端子名側には "." を含んでよい', () => {
    expect(terminalId('PLC', '0.00')).toBe('PLC.0.00');
    expect(parseTerminalId('PLC.0.00')).toEqual({ part: 'PLC', name: '0.00' });
  });

  it('端子IDを分解する', () => {
    expect(parseTerminalId('CR1.13')).toEqual({ part: 'CR1', name: '13' });
    expect(terminalOwner(terminalId('CR1', '9'))).toBe('CR1');
  });

  it('不正な識別子は IdError を投げる', () => {
    expect(() => partId('')).toThrow(IdError);
    expect(() => partId('CR.1')).toThrow(IdError);
    expect(() => wireId('')).toThrow(IdError);
    expect(() => terminalId('CR1', '')).toThrow(IdError);
    expect(() => parseTerminalId('CR1')).toThrow(IdError);
    expect(() => parseTerminalId('.13')).toThrow(IdError);
    expect(() => parseTerminalId('CR1.')).toThrow(IdError);
  });
});
