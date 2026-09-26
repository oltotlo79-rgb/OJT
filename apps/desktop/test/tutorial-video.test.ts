import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIALECT_IDS } from '@ojt/plc-dialects';
import { describe, expect, it } from 'vitest';
import catalog from '../src/renderer/public/tutorials/catalog.json';
import { PLC_TUTORIALS, TUTORIALS, tutorialFile } from '../src/renderer/help/TutorialVideo.js';

/**
 * PLCの動画はメーカーごとに1本ずつ（2026-09-26 利用者指示「他メーカーのPLCでも同様に
 * チュートリアルの動画を作成して」）。どのメーカーを選んでも、同梱の動画・字幕・目録の行が
 * そろっていること。
 */
const TUTORIAL_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../src/renderer/public/tutorials',
);

describe('解答操作動画の選び方', () => {
  it('PLCはいま使っているメーカーの動画を開く', () => {
    expect(tutorialFile('plc', 'mitsubishi')).toBe('plc');
    expect(tutorialFile('plc', 'jtekt')).toBe('plc-jtekt');
    expect(tutorialFile('plc', 'omron')).toBe('plc-omron');
    expect(tutorialFile('plc', 'sharp')).toBe('plc-sharp');
  });

  it('PLC以外はメーカーに関係なく1本', () => {
    for (const vendor of DIALECT_IDS) {
      expect(tutorialFile('assemble', vendor)).toBe(TUTORIALS.assemble.file);
      expect(tutorialFile('inspect-repair', vendor)).toBe(TUTORIALS['inspect-repair'].file);
    }
  });

  it('4メーカーすべての動画・字幕・目録の行が同梱されている', () => {
    for (const vendor of DIALECT_IDS) {
      const file = PLC_TUTORIALS[vendor].file;
      expect(existsSync(join(TUTORIAL_DIR, `${file}.webm`)), `${file}.webm`).toBe(true);
      expect(existsSync(join(TUTORIAL_DIR, `${file}.vtt`)), `${file}.vtt`).toBe(true);
      expect(catalog[file].durationSec, `${file} の長さ`).toBeGreaterThan(60);
      expect(catalog[file].durationSec, `${file} の長さ`).toBeLessThan(305);
    }
  });
});
