/* ================================================================
 * 内置背景音乐：浪漫夜曲（纯音乐）
 * --------------------------------------------------------------
 * 说明：
 *  - 音乐在浏览器本地实时合成，不依赖外部音频文件，也没有版权风险；
 *  - 8 小节 C-G-Am-F 系浪漫和声，钢片琴主旋律 + 轻柔弦垫 + 低音拨弦；
 *  - 输出为循环播放的 WAV Blob，接入原有音乐分析器后仍可用于
 *    心跳 / 粒子 / 烟花的节奏同步。
 * ================================================================ */

export const DEFAULT_MUSIC_NAME = '爱的夜曲（内置纯音乐）';

// 24kHz 足够覆盖这类柔和乐器的主体频段，同时把 32 秒循环控制在约 3MB。
const SAMPLE_RATE = 24000;
const DURATION = 32; // 60 BPM × 8 小节，正好一个完整和声循环
const TOTAL_SAMPLES = SAMPLE_RATE * DURATION;

const NOTES = {
  F2: 87.31, G2: 98.00, A2: 110.00,
  C3: 130.81, F3: 174.61, G3: 196.00, A3: 220.00,
  B3: 246.94, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23,
  G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.26, F5: 698.46, G5: 783.99,
  A5: 880.00, B5: 987.77, C6: 1046.50,
};

const CHORD_BARS = [
  { root: 'C3', chord: ['C4', 'E4', 'G4', 'B4'] },
  { root: 'G2', chord: ['G3', 'B3', 'D4', 'G4'] },
  { root: 'A2', chord: ['A3', 'C4', 'E4', 'G4'] },
  { root: 'F2', chord: ['F3', 'A3', 'C4', 'E4'] },
  { root: 'C3', chord: ['C4', 'E4', 'G4', 'B4'] },
  { root: 'G2', chord: ['G3', 'B3', 'D4', 'G4'] },
  { root: 'F2', chord: ['F3', 'A3', 'C4', 'E4'] },
  { root: 'C3', chord: ['C4', 'E4', 'G4', 'B4'] },
];

// 每小节一小句歌唱性旋律，避免只有和声时显得“练习曲”。
const MELODY = [
  [['E5', 0.0, 1.8], ['G5', 1.8, 0.8], ['C6', 2.6, 1.2]],
  [['D5', 0.0, 1.5], ['B4', 1.5, 0.8], ['G4', 2.3, 1.4]],
  [['A4', 0.0, 1.5], ['C5', 1.5, 0.8], ['E5', 2.3, 1.4]],
  [['F5', 0.0, 1.7], ['E5', 1.7, 0.7], ['A4', 2.4, 1.3]],
  [['G5', 0.0, 1.6], ['E5', 1.6, 0.8], ['C5', 2.4, 1.3]],
  [['D5', 0.0, 1.7], ['B4', 1.7, 0.9], ['G5', 2.6, 1.1]],
  [['A5', 0.0, 1.6], ['G5', 1.6, 0.8], ['E5', 2.4, 1.3]],
  [['C6', 0.0, 1.4], ['B5', 1.4, 0.8], ['C6', 2.2, 1.5]],
];

function addVoice(left, right, options) {
  const {
    frequency, startSec, duration, amplitude, type, pan = 0,
  } = options;

  const start = Math.max(0, Math.min(TOTAL_SAMPLES - 1, Math.floor(startSec * SAMPLE_RATE)));
  const end = Math.min(TOTAL_SAMPLES, Math.ceil((startSec + duration) * SAMPLE_RATE));
  if (end <= start) return;

  const attackSec = type === 'pad' ? 0.85 : type === 'bass' ? 0.025 : 0.008;
  const releaseSec = type === 'pad' ? 1.25 : 0.18;
  const decaySec = type === 'bell' ? 1.05 : type === 'bass' ? 0.75 : 1;
  const attackSamples = Math.max(1, Math.floor(attackSec * SAMPLE_RATE));
  const releaseSamples = Math.max(1, Math.floor(releaseSec * SAMPLE_RATE));
  const phaseStep = Math.PI * 2 * frequency / SAMPLE_RATE;
  const positivePan = Math.max(0, pan);
  const negativePan = Math.min(0, pan);
  const leftGain = amplitude * (1 - positivePan);
  const rightGain = amplitude * (1 + negativePan);

  for (let i = start; i < end; i++) {
    const t = (i - start) / SAMPLE_RATE;
    const remaining = (end - i) / SAMPLE_RATE;
    let envelope;
    if (type === 'pad') {
      envelope = Math.min(1, t / attackSec) * Math.min(1, remaining / releaseSec);
    } else if (type === 'bass') {
      envelope = Math.min(1, t / attackSec) * Math.exp(-t / decaySec);
    } else {
      envelope = (1 - Math.exp(-t / attackSec)) * Math.exp(-t / decaySec);
    }
    if (remaining < releaseSec) envelope *= remaining / releaseSec;
    if (envelope <= 0.00001) continue;

    const phase = phaseStep * (i - start);
    let wave;
    if (type === 'pad') {
      wave = Math.sin(phase) +
        0.12 * Math.sin(phase * 2) +
        0.045 * Math.sin(phase * 3);
    } else if (type === 'bass') {
      wave = Math.sin(phase) +
        0.12 * Math.sin(phase * 2) * Math.exp(-t * 1.8) +
        0.035 * Math.sin(phase * 3) * Math.exp(-t * 2.6);
    } else {
      wave = Math.sin(phase) +
        0.22 * Math.sin(phase * 2) * Math.exp(-t * 1.1) +
        0.085 * Math.sin(phase * 3) * Math.exp(-t * 2.0) +
        0.035 * Math.sin(phase * 4) * Math.exp(-t * 3.0);
    }

    const sample = wave * envelope;
    left[i] += sample * leftGain;
    right[i] += sample * rightGain;
  }
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function encodeWav(left, right) {
  const channelCount = 2;
  const bytesPerSample = 2;
  const dataSize = TOTAL_SAMPLES * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    // 循环首尾各留一点淡入淡出，避免浏览器 loop 点出现轻微爆音。
    const fadeIn = Math.min(1, i / (SAMPLE_RATE * 0.08));
    const fadeOut = Math.min(1, (TOTAL_SAMPLES - i) / (SAMPLE_RATE * 0.28));
    const fade = fadeIn * fadeOut;
    const l = Math.max(-1, Math.min(1, left[i] * fade));
    const r = Math.max(-1, Math.min(1, right[i] * fade));
    view.setInt16(offset, Math.round(l * 32767), true); offset += 2;
    view.setInt16(offset, Math.round(r * 32767), true); offset += 2;
  }
  return buffer;
}

export function createDefaultRomanticMusic() {
  const left = new Float32Array(TOTAL_SAMPLES);
  const right = new Float32Array(TOTAL_SAMPLES);

  CHORD_BARS.forEach((bar, barIndex) => {
    const barStart = barIndex * 4;

    // 轻柔弦垫：慢起慢收，负责 romantic 的底色。
    bar.chord.forEach((note, noteIndex) => {
      addVoice(left, right, {
        frequency: NOTES[note],
        startSec: barStart,
        duration: 3.7,
        amplitude: noteIndex === 0 ? 0.035 : 0.025,
        type: 'pad',
        pan: noteIndex % 2 === 0 ? -0.10 : 0.10,
      });
    });

    // 低音拨弦：每小节开头轻轻落一次，不使用鼓点，保持纯音乐质感。
    addVoice(left, right, {
      frequency: NOTES[bar.root],
      startSec: barStart,
      duration: 2.7,
      amplitude: 0.15,
      type: 'bass',
    });

    // 八分音符琶音：一点星光感，但音量压低，只作为背景装饰。
    [0, 2, 1, 3, 2, 0, 3, 1].forEach((chordIndex, step) => {
      addVoice(left, right, {
        frequency: NOTES[bar.chord[chordIndex]],
        startSec: barStart + step * 0.5,
        duration: 0.48,
        amplitude: 0.026,
        type: 'bell',
        pan: step % 2 === 0 ? 0.12 : -0.12,
      });
    });

    // 钢片琴主旋律。
    MELODY[barIndex].forEach(([note, noteStart, noteDuration]) => {
      addVoice(left, right, {
        frequency: NOTES[note],
        startSec: barStart + noteStart,
        duration: noteDuration,
        amplitude: 0.125,
        type: 'bell',
        pan: -0.06,
      });
    });
  });

  // 峰值归一化，留出余量避免与音效叠加时削波。
  let peak = 0;
  for (let i = 0; i < TOTAL_SAMPLES; i++) {
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  if (peak > 0) {
    const normalize = Math.min(1, 0.82 / peak);
    for (let i = 0; i < TOTAL_SAMPLES; i++) {
      left[i] *= normalize;
      right[i] *= normalize;
    }
  }

  return encodeWav(left, right);
}
