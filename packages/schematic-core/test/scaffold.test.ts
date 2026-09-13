import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from '../src/index.js';

describe('scaffold', () => {
  it('パッケージ名を公開している', () => {
    expect(PACKAGE_NAME).toBe('@ojt/schematic-core');
  });
});
