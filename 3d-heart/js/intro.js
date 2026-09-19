/* ================================================================
 * js/intro.js —— 开场闪屏（51）
 *
 * 页面正式内容（爱心 / 侧栏）露面之前：正中一句「Welcome To The Secret Garden!」
 * 逐字如 smoke 般自中心向两侧凝聚；下方读秒 7→1（每秒一位：数字裹烟砸入 +
 * 一圈光环扩散，旧数字向上 puff 散掉）；数到尽头整句与数字一起烟消云散，
 * 幕布淡出，进入正常页面。
 *
 * 与全工程同一口径：**动画本体全在 CSS 关键帧**（style.css 的 introCharIn/Out、
 * introDigitIn/Out、introRing），js 只推相位（#introSplash 的 data-intro：
 * in → count → out）与每秒换一位数字；逐字拆分复用 js/charsplit.js
 * （烟消云散 / 翻页打字机同一份），每个字的揭示时刻写在它自己的 --it-d /
 * --it-o 上 → 凝聚 / 散场期间零重排（句子尺寸动起来之前就定型）。
 *
 * 交互：点任意处 / 按任意键 = 跳过（快速淡出）；prefers-reduced-motion =
 * 直接进页面（不播闪屏）。返回 Promise，main.js 用它把「首访引导」排在闪屏之后。
 * ================================================================ */
import { appendChars } from './charsplit.js';

const LINE = 'Welcome To The Secret Garden!';   // 开场问候（拉丁词整词成组、词内逐字，共 25 字）
const COUNT_FROM = 7;        // 读秒起点（= 持续秒数：7→1 每秒一位）
const IN_SETTLE = 1.0;       // 句子凝聚完后多久开始读秒（秒）
const TICK = 1.0;            // 一位数字停留（秒）
const OUT_STAGGER = 0.5;     // 散场逐字错峰总量（秒）
const OUT_CHAR = 0.8;        // 单字散场时长（与 CSS introCharOut 同步）
const FADE = 0.55;           // 散场结束后整幕淡出（秒）

export function playIntro() {
  const root = document.getElementById('introSplash');
  if (!root) return Promise.resolve();
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    root.remove();                                  //  Reduce Motion：不播闪屏
    return Promise.resolve();
  }
  document.body.classList.add('intro-playing');     // CSS 据此把主界面先藏起来

  const line = root.querySelector('.intro-line');
  const countBox = root.querySelector('.intro-count');
  const chars = appendChars(line, LINE);
  const n = chars.length || 1;
  chars.forEach((c, i) => {
    const mid = (n - 1) / 2;
    const p = n > 1 ? Math.abs(i - mid) / mid : 0;  // 0 = 正中 → 1 = 两端
    c.style.setProperty('--it-d', `${(p * 0.55).toFixed(3)}s`);          // 凝聚：自中心向两侧
    c.style.setProperty('--it-o', `${((i / n) * OUT_STAGGER).toFixed(3)}s`); // 散场：自左向右
  });

  let resolveDone;
  const doneP = new Promise((r) => { resolveDone = r; });
  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(fn, ms));
  let phase = 'in';
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    window.removeEventListener('keydown', onSkip);
    root.remove();
    document.body.classList.remove('intro-playing');
    resolveDone();
  };
  const fadeOut = (fast) => {
    root.classList.add(fast ? 'leaving-fast' : 'leaving');
    at((fast ? 0.32 : FADE) * 1000 + 60, finish);
  };
  const startOut = (fast = false) => {
    if (finished || phase === 'out') return;
    phase = 'out';
    root.dataset.intro = 'out';                     // 烟消云散散场（逐字 --it-o 错峰）
    at(fast ? 420 : (OUT_STAGGER + OUT_CHAR) * 1000, () => fadeOut(fast));
  };
  const onSkip = (e) => {
    if (finished || phase === 'out') return;
    /* 这次按键 / 点击只消费给「跳过」：拦下来，别同时触发主场景快捷键
       （空格切音乐之类）或画布点击烟花 */
    if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    if (phase === 'in') { phase = 'out'; fadeOut(true); return; }  // 字还没凝完：整幕快淡出
    startOut(true);                                                // 读秒中：散场 + 快淡出
  };
  root.addEventListener('click', onSkip, { once: true });
  window.addEventListener('keydown', onSkip);

  const tickDigit = (k) => {
    if (finished || phase !== 'count') return;
    const old = countBox.querySelector('.intro-digit:not(.leave)');
    if (old) { old.classList.add('leave'); at(520, () => old.remove()); }  // 旧数字 puff 散掉
    if (k <= 0) { startOut(); return; }                                    // 1 走完 → 全幕散场
    const d = document.createElement('span');
    d.className = 'intro-digit';
    d.textContent = String(k);
    countBox.appendChild(d);
    at(TICK * 1000, () => tickDigit(k - 1));
  };

  root.dataset.intro = 'in';
  at(IN_SETTLE * 1000, () => {
    if (finished || phase !== 'in') return;
    phase = 'count';
    root.dataset.intro = 'count';
    tickDigit(COUNT_FROM);
  });
  return doneP;
}
