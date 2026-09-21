import { Buffer } from 'node:buffer';
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, bytes) {
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length);
  result.write(type, 4, 'ascii');
  bytes.copy(result, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}

function predictor(filter, a, b, c) {
  if (filter === 0) return 0;
  if (filter === 1) return a;
  if (filter === 2) return b;
  if (filter === 3) return (a + b) >>> 1;
  const p = a + b - c;
  const pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Electron の8bit RGB/RGBA PNGを画素・寸法・色の情報を変えずに再圧縮する。 */
export function optimizePng(input) {
  if (!input.subarray(0, 8).equals(SIGNATURE)) throw new Error('PNGではありません');
  const before = [],
    after = [],
    idats = [];
  let seenData = false;
  for (let p = 8; p < input.length;) {
    const length = input.readUInt32BE(p);
    const type = input.toString('ascii', p + 4, p + 8);
    const bytes = input.subarray(p + 8, p + 8 + length);
    if (p + length + 12 > input.length) throw new Error('PNGが途中で切れています');
    if (type === 'IDAT') {
      seenData = true;
      idats.push(bytes);
    } else (seenData ? after : before).push(input.subarray(p, p + length + 12));
    p += length + 12;
  }
  const header = before[0]?.subarray(8, -4);
  if (!header || header[8] !== 8 || ![2, 6].includes(header[9]) || header[12] !== 0) {
    throw new Error('8bit・非インターレースのRGB/RGBA PNGだけを圧縮できます');
  }
  const width = header.readUInt32BE(0),
    height = header.readUInt32BE(4);
  const channels = header[9] === 2 ? 3 : 4;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idats));
  if (raw.length !== (stride + 1) * height) throw new Error('PNGの画素数が一致しません');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) throw new Error('PNGのフィルタが不正です');
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const a = x >= channels ? pixels[at - channels] : 0;
      const b = y > 0 ? pixels[at - stride] : 0;
      const c = y > 0 && x >= channels ? pixels[at - stride - channels] : 0;
      pixels[at] = (raw[y * (stride + 1) + x + 1] + predictor(filter, a, b, c)) & 255;
    }
  }
  // 行ごとの自動選択に加え、同じフィルタを全行に使う候補も比べる。
  // 平坦なUIでは後者のほうが、縮小画像でも画質を落とさず小さくなる場合がある。
  const candidates = Array.from({ length: 7 }, () => Buffer.alloc(raw.length));
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    let bestScore = Infinity,
      bestFilter = 0,
      bestEntropy = Infinity,
      entropyFilter = 0;
    for (let filter = 0; filter < 5; filter++) {
      const candidate = candidates[filter];
      candidate[start] = filter;
      let score = 0;
      const frequencies = new Uint32Array(256);
      for (let x = 0; x < stride; x++) {
        const at = y * stride + x;
        const a = x >= channels ? pixels[at - channels] : 0;
        const b = y > 0 ? pixels[at - stride] : 0;
        const c = y > 0 && x >= channels ? pixels[at - stride - channels] : 0;
        const value = (pixels[at] - predictor(filter, a, b, c)) & 255;
        candidate[start + x + 1] = value;
        score += Math.min(value, 256 - value);
        frequencies[value]++;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
      }
      let entropy = 0;
      for (const count of frequencies) if (count > 0) entropy -= count * Math.log2(count / stride);
      if (entropy < bestEntropy) {
        bestEntropy = entropy;
        entropyFilter = filter;
      }
    }
    candidates[bestFilter].copy(candidates[5], start, start, start + stride + 1);
    candidates[entropyFilter].copy(candidates[6], start, start, start + stride + 1);
  }
  let best = Buffer.concat(idats);
  for (const candidate of [raw, ...candidates]) {
    for (const strategy of [0, 1]) {
      const compressed = deflateSync(candidate, { level: 9, memLevel: 9, strategy });
      if (compressed.length < best.length) best = compressed;
    }
  }
  const optimized = Buffer.concat([SIGNATURE, ...before, chunk('IDAT', best), ...after]);
  return optimized.length < input.length ? optimized : input;
}
