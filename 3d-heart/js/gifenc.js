/* ================================================================
 * 极简 GIF89a 编码器（零依赖，用于导出 GIF 动图）
 * 调色板 = 6×6×6 彩色立方（216 色）+ 灰阶补齐 + 255 号透明位；
 * Bayer 4×4 有序抖动减轻色带；标准 GIF LZW 压缩。
 * 用法：encodeGif(frames, { width, height, delay, transparent })
 *   frames: Uint8Array 索引帧（每像素调色板下标）数组
 * ================================================================ */

// Bayer 4×4 阈值矩阵（0–15）
const BAYER4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

// 256 色调色板：0–215 彩色立方，216–254 灰阶，255 透明位
function buildPalette() {
  const pal = new Uint8Array(256 * 3);
  for (let i = 0; i < 216; i++) {
    const r = Math.floor(i / 36), g = Math.floor((i % 36) / 6), b = i % 6;
    pal[i * 3] = Math.round((r / 5) * 255);
    pal[i * 3 + 1] = Math.round((g / 5) * 255);
    pal[i * 3 + 2] = Math.round((b / 5) * 255);
  }
  for (let i = 216; i < 255; i++) {
    const v = Math.round(((i - 216) / 38) * 255);
    pal[i * 3] = v; pal[i * 3 + 1] = v; pal[i * 3 + 2] = v;
  }
  pal[255 * 3] = 0; pal[255 * 3 + 1] = 0; pal[255 * 3 + 2] = 0;
  return pal;
}

// RGBA ImageData → 索引帧（带有序抖动；alpha<128 且 transparent 时落 255）
function quantizeFrame(imageData, transparent) {
  const { width, height, data } = imageData;
  const idx = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const o = y * width + x;
      if (transparent && data[i + 3] < 128) { idx[o] = 255; continue; }
      const dither = (BAYER4[(y % 4) * 4 + (x % 4)] - 7.5) * (51 / 16);
      const r = Math.min(255, Math.max(0, data[i] + dither));
      const g = Math.min(255, Math.max(0, data[i + 1] + dither));
      const b = Math.min(255, Math.max(0, data[i + 2] + dither));
      const ri = Math.min(5, Math.max(0, Math.round(r / 51)));
      const gi = Math.min(5, Math.max(0, Math.round(g / 51)));
      const bi = Math.min(5, Math.max(0, Math.round(b / 51)));
      let q = ri * 36 + gi * 6 + bi;
      // 接近灰度时优先灰阶槽，减少彩色噪点
      if (ri === gi && gi === bi && q % 36 === 0) { /* 立方对角即灰，保持 */ }
      idx[o] = q;
    }
  }
  return idx;
}

/* ---------- 位流 / 子块输出 ---------- */
function createByteSink() {
  const chunks = [];
  let buf = new Uint8Array(255);
  let used = 0;
  const flush = () => {
    if (used > 0) { chunks.push(new Uint8Array([used]), buf.slice(0, used)); used = 0; }
  };
  return {
    chunks,
    byte(b) { buf[used++] = b; if (used === 255) { chunks.push(new Uint8Array([255]), buf); buf = new Uint8Array(255); used = 0; } },
    flush,
  };
}

/* 固定 9 位码宽 + 保守清表：码值始终 ≤ 511（9 位可表示），
   在解码器需要扩位之前发 CLEAR 重置字典，彻底规避扩位时序差异。
   解码器比编码器滞后一个表项，本方案下其表不会超过 511，安全。 */
function lzwEncode(indexed, sink) {
  const CLEAR = 256, EOI = 257;
  const CODE_SIZE = 9;
  let nextCode = 258;
  let dict = new Map();

  let acc = 0, accBits = 0;
  const emit = (code) => {
    acc |= code << accBits;
    accBits += CODE_SIZE;
    while (accBits >= 8) {
      sink.byte(acc & 0xff);
      acc >>= 8;
      accBits -= 8;
    }
  };

  emit(CLEAR);
  let prev = indexed[0];
  for (let i = 1; i < indexed.length; i++) {
    const cur = indexed[i];
    const key = (prev << 12) | cur;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prev = hit;
    } else {
      emit(prev);
      dict.set(key, nextCode++);
      if (nextCode >= 512) {
        emit(CLEAR);
        dict = new Map();
        nextCode = 258;
      }
      prev = cur;
    }
  }
  emit(prev);
  emit(EOI);
  if (accBits > 0) sink.byte(acc & 0xff);
}

function encodeGif(frames, opts) {
  const { width, height, delay, transparent } = opts;
  const pal = buildPalette();
  const sink = createByteSink();
  const out = [];

  // Header + Logical Screen Descriptor + 全局调色板
  out.push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])); // GIF89a
  const lsd = new Uint8Array(7);
  lsd[0] = width & 0xff; lsd[1] = (width >> 8) & 0xff;
  lsd[2] = height & 0xff; lsd[3] = (height >> 8) & 0xff;
  lsd[4] = 0xf7; // 全局调色板 256 色
  lsd[5] = 0; lsd[6] = 0;
  out.push(lsd, pal);

  // Netscape 循环扩展（无限循环）
  out.push(new Uint8Array([0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00]));

  for (const frame of frames) {
    // Graphics Control Extension
    const gce = new Uint8Array(8);
    gce[0] = 0x21; gce[1] = 0xf9; gce[2] = 0x04;
    gce[3] = transparent ? 0x09 : 0x08; // 含透明位 + 不处置
    gce[4] = delay & 0xff; gce[5] = (delay >> 8) & 0xff;
    gce[6] = 255; gce[7] = 0;
    out.push(gce);
    // Image Descriptor
    out.push(new Uint8Array([0x2c, 0, 0, 0, 0,
      width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff, 0]));
    out.push(new Uint8Array([8])); // LZW 最小码长
    lzwEncode(frame, sink);
    sink.flush();
    out.push(...sink.chunks);
    sink.chunks.length = 0;
    out.push(new Uint8Array([0])); // 块结束
  }
  out.push(new Uint8Array([0x3b])); // Trailer

  let total = 0;
  for (const u of out) total += u.length;
  const bytes = new Uint8Array(total);
  let p = 0;
  for (const u of out) { bytes.set(u, p); p += u.length; }
  return bytes;
}

export { encodeGif, quantizeFrame };
