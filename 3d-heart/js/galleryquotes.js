/* ================================================================
 * 相册陈列室 · 台词轮播
 *
 * - 陈列室「中间偏上」的空白区域里，每句台词停留 N 秒（默认 3 秒）后换下一句，
 *   循环滚动；台词叠层 pointer-events:none，绝不挡住照片的点击 / 聚焦操作
 * - 四种切换效果（侧栏「台词轮播 → 切换效果」下拉框）：
 *     ① 淡入淡出（原效果）：原地淡入 → 停留 → 原地淡出，再换下一句
 *     ② 上浮交替：停留之后当前句慢慢往上移并淡出，同一时间下一句从下方浮现、
 *        慢慢升回到上一句原来所在的位置 —— 两层台词槽同时在动
 *     ③ 烟消云散：停留之后当前句逐字飘散成烟，隔一拍在原地逐字凝聚出下一句
 *     ④ 翻页打字机：停留之后当前句像书页一样绕自己的左边翻走，空一拍后
 *        下一句在原地**逐字打出**（打字机进场，带一支跟着字走的光标）
 *   四种效果共用同一套节奏：「间隔」= 每句停留的秒数，过场时长随间隔伸缩
 * - 台词来自侧栏「台词轮播」模块的多行文本框：一行一句、空行自动忽略；
 *   字体与字号均从下拉框选择（字体表与主场景三维文字共用 fonts.js）
 * - 走时由 gallery.js 的陈列室渲染循环每帧调用 updateQuotes(time) 驱动：
 *   陈列室开着才推进，退出即停，切后台（rAF 暂停）不会跳句、不会堆句。
 *   动画本体全交给 CSS（合成器友好，js 不逐帧改样式），js 只按同一份时长推进
 *   相位机：in（进场）→ hold（停留）→ cross / out（过场）→ 下一句的 in …
 * - 逐字拆分（烟消云散 / 翻页打字机 / 照片级台词三路共用）见 js/charsplit.js；
 *   照片级台词（每张照片配一句、聚焦时打出）是另一个模块 js/photoquotes.js
 * - 「台词绝不压照片」在三种效果下都成立：空白带（--gq-top / --gq-h）算法一字未改，
 *   自动收字改成量「在场的所有台词层」（上浮交替的过场里是两层，只量当前层的话
 *   较长的那句可能在浮现途中探出空白带），上浮的位移量另收一道上限：
 *   下一句从下方起步时不许探出空白带下沿；烟消云散的逐字一律往上飘（烟往上升），
   超长句退回的「整块雾化」则在收字号时先扣掉上下各 0.2em 的飘散余地，同样不越带
 * - 所有参数通过 config.js 注册表随全局配置保存（导出 / 方案一并带上），
 *   刷新自动恢复
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';
import { fetchQuotePack } from './seedquotes.js';
import { FONT_LIST } from './fonts.js';
import { appendChars, spanCount, markLastChar } from './charsplit.js';

/* 字号档位：陈列室台词是 DOM 文字，直接落到 px（小屏另有 CSS 上限自适应） */
const SIZE_STEPS = [
  { px: 18, name: '特小 18px' },
  { px: 22, name: '小 22px' },
  { px: 28, name: '中小 28px' },
  { px: 36, name: '标准 36px' },
  { px: 46, name: '大 46px' },
  { px: 60, name: '特大 60px' },
  { px: 80, name: '超大 80px' },
];
/* 切换效果：数组下标就是配置里存的值，key 与 style.css 里 data-gq-state 的
   前缀一一对应（fade-in / rise-out / smoke-in / type-in + flip-out …），
   新增效果两边都要加一份 */
const EFFECT_LIST = [
  { key: 'fade', name: '淡入淡出', note: '原地淡入 → 停留 → 原地淡出，再换下一句' },
  { key: 'rise', name: '上浮交替', note: '当前句慢慢上移淡出，下一句同时从下方浮现并升回原位' },
  { key: 'smoke', name: '烟消云散', note: '当前句逐字飘散成烟，下一句在原地逐字凝聚' },
  { key: 'type', name: '翻页打字机', note: '当前句像书页一样翻走，下一句在原地逐字打出（带光标）' },
];
const DEFAULT_SIZE_INDEX = 3;   // 标准 36px（手机另按屏幕宽度加一道显示上限）
const MOBILE_QUOTE_CAP_VW = 0.05; // iPhone 17（402px 逻辑宽）≈ 20px，减少长台词折行
const DEFAULT_EFFECT = 2;       // 烟消云散（新访客默认；老访客的已存配置不受影响）
const MIN_INTERVAL = 2;         // 停留间隔下限（秒）
const MAX_INTERVAL = 20;        // 停留间隔上限（秒）
const DEFAULT_INTERVAL = 3;     // 默认每句停留 3 秒（2–20 秒可调）
const MAX_TEXT = 50000;         // 自定义层字符上限（5 万字符约 100KB，距 localStorage 5MB 还很远）
const MAX_LINES = 200;          // 台词条数上限
/* 烟消云散逐字拆分的字数上限：超过就退回「整块雾化飘散」（data-gq-chars="0"）。
   逐字要跑 blur 滤镜动画，一句几百个字时上百个滤镜同跑不划算，
   而且那么长的句子本来也只显示前几行（line-clamp） */
const SMOKE_MAX_CHARS = 120;
/* 烟消云散散场的错峰顺序逐句轮换：每句都「自左向右被风吹走」太单调，
   按句子下标 mod 4 轮转四种「谁先消失」—— 头先 / 尾先 / 中间先 / 两头先。
   order(p, q) 返回 0→1 的消失次序，乘散场错峰总时长即该字的 --gq-d2；
   p = 字在句中的左右位置，q = 离中心的距离（0 中心 → 1 两端）。 */
const SMOKE_EXIT_PATTERNS = [
  { name: '头先散', order: (p) => p },            // 一阵风从句头吹向句尾
  { name: '尾先散', order: (p) => 1 - p },        // 风向反过来，句尾先走
  { name: '中间先散', order: (p, q) => q },       // 句心先化烟，向两端漫开
  { name: '两头先散', order: (p, q) => 1 - q },   // 两端先化烟，向句心收拢
];
let exitPatternIdx = 0;   // 最近一次填句用的散场顺序（quoteDebug 验收用）
/* 超长句退回「整块雾化飘散」（不逐字拆）时，整块会一边模糊一边整体飘走 ——
   见 style.css 的 gqSmokeWholeIn / gqSmokeWholeOut：translateY(±0.2em) + blur（不做 scale，
   放大会让整块横向也胀出去，长句本来就快占满可用宽度了，胀出去反而压到侧栏）。
   而自动收字只保证「停稳时」台词块 ≤ 空白带：正好被 line-clamp 撑满空白带的长句，
   飘走那一瞬间就会探出带子（往下就是照片）。所以整块雾化的句子收字号时，先把
   上下各一份飘散余地（0.2em，居中摆放 → 两侧均分，扣两倍）扣掉再收 ——
   于是「过场途中也不越空白带」对整块雾化同样是构造性成立的。数字与 CSS 同源，
   改 keyframes 里的 em 数就要连这里一起改（SMOKE_WHOLE_LIFT）。
   （逐字飘散不需要额外扣：单字一律往上飘、烟往上升，向下只有放大出来的半个字高，
     而空白带下沿本来就比最高的照片再高 12px，那点余量吃得下；没截断的行在散烟时
   打开 overflow 让字飘出药丸（见 style.css 的 data-gq-trunc 规则），药丸因此与
   上浮交替完全同高，框内不再预留留白） */
const SMOKE_WHOLE_LIFT = 0.2;      // gqSmokeWholeOut 的 translateY(-0.2em)：整块最远飘这么多

/* ---------- 效果四 · 翻页打字机（46 尾补） ----------
   两段合起来才是这个效果：
   ① 翻页（离场）：当前句像书页一样绕自己的**左边**翻走。用 rotateY 而不是 rotateX ——
      rotateY 纵向尺度全程不变，横向因为「远离镜头就朝透视原点收缩」只会**收窄**，
      于是投影盒必定落在药丸自己原来的盒子里，而那个盒子 fitFont 已经保证 ≤ 空白带 →
      这一路「过场中也不越空白带」同样是构造性成立的，不必像上浮交替那样开裁切。
      （换成绕水平轴翻就不行了：近端被透视放大，上下都会探出盒外。）
   ② 打字机（进场）：下一句逐字打出。每字延迟 = i × step（严格自左向右），
      光标就是这个字自己的 ::after，只在「这一拍」里亮 → 看起来一路跟着字往右走；
      最后一个字的光标多闪 --tw-tail 再收。逐字揭开只改透明度 / 0.08em 的抬落，
      字都在流里占好最终格子（见 charsplit.js）→ 零重排，抬落又落在药丸 9px 内边距里，
      所以进场全程既不撑大药丸也不越空白带。
   超过 TYPE_MAX_CHARS 的长句沿用「整块」退路：不逐字，整块快速淡入，翻页离场照旧
   （与烟消云散的整块雾化同一个理由：几百个字时逐字跑几百个动画不划算，
     而且那么长的句子本来也只显示前几行）。*/
const TYPE_PER_CHAR = 0.055;   // 每字打字节拍（秒/字）≈ 18 字/秒，读得出「在打字」
const TYPE_MIN_IN = 0.55;      // 再短的句子也至少打这么久
const TYPE_TAIL = 0.3;         // 打完之后留给光标闪两下的时间（算进 in 相位）
const TYPE_MAX_CHARS = 120;    // 与烟消云散同一个上限：超了就整块进场
/* 淡入淡出的位移上限（px）：进场从下方 12px 处落定、出场往上飘 10px。
   这是三种效果里唯一「原地小幅挪一下」的过场，余量够时就用这份原样；
   台词几乎撑满空白带的极矮窗口由 fitFont 按剩余余量自动收小（--gq-fade-dy），
   于是三种切换效果都做到「过场全程也不越空白带」。与 style.css 的 gqFadeIn/Out 同源。 */
const FADE_DY_MAX = 12;
const DEFAULT_TEXT = [
  '遇见你，是我所有浪漫的开始',
  '这张照片里，有我最喜欢的光',
  '世界很吵，你笑的时候就很安静',
  '往后余生，风雪是你，平淡也是你',
].join('\n');

const quoteParams = {
  enabled: true,
  text: '',                // 自定义层初始为空：内置句统一由台词包提供（fetch 失败才回退 DEFAULT_TEXT）
  fontIndex: 1,          // 苹方 / 雅黑
  sizeIndex: DEFAULT_SIZE_INDEX,
  effect: DEFAULT_EFFECT,
  interval: DEFAULT_INTERVAL,
  random: false,
  packEnabled: true,        // 是否轮播内置台词包（assets/quotes/default.txt）
};

let lines = [];          // 解析后的台词（去空行 / 去首尾空白）
let curIdx = -1;         // 当前显示的句子下标
let curSlot = 0;         // 当前台词落在哪一层（上浮交替在两层之间来回换）
let phase = 'idle';      // idle | in | hold | out | gap | cross
let phaseDur = 0;        // 当前相位的总时长（秒，调试用）
let phaseLeft = 0;       // 当前相位剩余秒数
let pendingIdx = -1;     // cross 走完要落地的句子（上浮交替：下一句先摆在另一层）
let pendingSlot = -1;    // cross 走完要换用的台词层
let running = false;     // 陈列室是否打开
let lastStamp = 0;       // 上一帧时间戳（秒），用于算帧间隔
let debounceId = 0;      // 文本框输入的防抖计时器
let overCharNote = '';   // 文本框超出字数上限时的提示（并入 hint）
let packText = null;     // 内置台词包原文：null = 还没加载成功（回退 DEFAULT_TEXT）；'' = 拉到了空包

const stageEl = $('galleryQuotes');
const lineEls = [$('galleryQuoteLine'), $('galleryQuoteLineB')];  // 两层台词槽，叠在同一位置
const lineEl = lineEls[0];   // 半宽缓存读 A 层即可：两层的 CSS 完全一致，算得值相同
const textEl = $('quoteText');
const hintEl = $('quoteHint');
const enableEl = $('quoteEnabled');
const fontEl = $('quoteFont');
const sizeEl = $('quoteSize');
const effectEl = $('quoteEffect');
const intervalEl = $('quoteInterval');
const intervalValEl = $('quoteIntervalVal');
const randomEl = $('quoteRandom');
const packEl = $('quotePackEnabled');

/* ---------- 小工具 ---------- */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const intIn = (v, hi) => clamp(Math.round(Number(v) || 0), 0, Math.max(0, hi));
const sec = (v) => `${(Number(v) || 0).toFixed(3)}s`;
function parseLines(raw) {
  return String(raw == null ? '' : raw)
    .split(/\r\n|\r|\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
}
function curFont() {
  return FONT_LIST[quoteParams.fontIndex] || FONT_LIST[0];
}
function quoteSizeCapPx() {
  const vw = window.innerWidth || 0;
  const compact = window.matchMedia ? window.matchMedia('(max-width: 700px)').matches : vw <= 700;
  // 与 style.css 窄屏的 max(17px, 5vw) 同口径；落到整数 px，fitFont / debug 才不会误报。
  return Math.max(17, Math.floor(vw * (compact ? MOBILE_QUOTE_CAP_VW : 0.09)));
}
function curSizePx() {
  const s = SIZE_STEPS[quoteParams.sizeIndex] || SIZE_STEPS[DEFAULT_SIZE_INDEX];
  return Math.min(s.px, quoteSizeCapPx());
}
function curEffect() {
  return EFFECT_LIST[quoteParams.effect] || EFFECT_LIST[DEFAULT_EFFECT];
}
function effectKey() {
  return curEffect().key;
}
function indexMod(i) {
  if (!lines.length) return -1;
  return ((i % lines.length) + lines.length) % lines.length;
}

/* ---------- 节奏 ----------
   「间隔」滑杆给的是每句的停留秒数（hold），三种效果都一样；过场时长按停留
   时长伸缩（始终明显短于停留），于是调间隔时过场也跟着从容 / 紧凑，
   不会出现「过渡比停留还长」的怪节奏。js 的相位机与 CSS 的动画时长
   取的都是这里的同一份数字 → 两边永远对得上。 */
/* 烟消云散的节奏拆分：逐字错峰扫过（最多占相位的 44%）+ 单字自身时长，
   两段之和就是这个相位真正的时长（也写进 CSS 的 --gq-tot / --gq-cdur） */
function smokeSplit(total) {
  const stag = clamp(total * 0.44, 0.2, 1.1);
  const cdur = Math.max(0.3, total - stag);
  return { stag, cdur, tot: stag + cdur };
}
/* 打字机的进场时长**随句长走**（长的句子打得久一点才像打字），所以 timings() 要能看见
   「当前这句会拆成多少个字符 span」—— 口径与 fillSlot 用的 appendChars 完全一致
   （见 charsplit.js 的 spanCount），于是相位机推进的秒数 = 逐字延迟之和 + 收尾，
   两边不会走岔。startLine 里 curIdx 在 timings() 之前就换成新进场的句子了，
   量到的正是「快要打出来的那句」。 */
function typeLineStats() {
  const str = lines[indexMod(curIdx)] || '';
  if (str.length > TYPE_MAX_CHARS) return { whole: true, n: 0 };   // 整块退路
  return { whole: false, n: Math.max(1, spanCount(str)) };
}
function timings() {
  const iv = quoteParams.interval;
  const key = effectKey();
  if (key === 'rise') return { key, iv, swap: clamp(iv * 0.32, 0.9, 1.6) };
  if (key === 'smoke') {
    const sin = smokeSplit(clamp(iv * 0.32, 0.9, 1.7));
    const sout = smokeSplit(clamp(iv * 0.4, 1.2, 2.2));
    return { key, iv, gap: 0.16, in: sin.tot, out: sout.tot, sin, sout };
  }
  if (key === 'type') {
    const out = clamp(iv * 0.28, 0.66, 1.15);          // 翻一页走的秒数
    const st = typeLineStats();
    if (st.whole) {                                    // 超长句：整块快速淡入
      return { key, iv, gap: 0.14, out, in: clamp(iv * 0.16, 0.3, 0.55), type: st };
    }
    const cap = Math.max(TYPE_MIN_IN + 0.2, iv * 0.62);   // 打字不许长过停留
    const total = clamp(st.n * TYPE_PER_CHAR, TYPE_MIN_IN, cap);
    const step = total / st.n;                         // 每字一拍
    const cdur = clamp(step * 0.9, 0.07, 0.15);        // ≤ step → 最后一个字必在相位内打完
    return { key, iv, gap: 0.14, out, in: total + TYPE_TAIL, type: { ...st, step, cdur } };
  }
  return { key, iv, in: clamp(iv * 0.12, 0.35, 0.62), out: clamp(iv * 0.14, 0.4, 0.72) };
}
/* 把过场节奏写进叠层上的 CSS 变量（两层一起继承） */
function applyTimingVars() {
  if (!stageEl) return;
  const t = timings();
  stageEl.style.setProperty('--gq-in', sec(t.in));
  stageEl.style.setProperty('--gq-out', sec(t.out));
  stageEl.style.setProperty('--gq-swap', sec(t.swap));
  stageEl.style.setProperty('--gq-rise', `${risePx}px`);
  /* 打字机的四个量（--tw-step 一拍多长 = 光标的亮窗 / --tw-dur 单字揭开时长 /
     --tw-tail 打完再闪多久）。逐字的开拍时刻 --tw-d 由 fillSlot 写在每个字上。
     这套变量名与 js/photoquotes.js 的照片级台词**共用同一份 CSS**（见 style.css 的
     「打字机」段）：一处实现，两处使用。 */
  stageEl.style.setProperty('--tw-step', sec(t.type ? t.type.step : 0));
  stageEl.style.setProperty('--tw-dur', sec(t.type ? t.type.cdur : 0));
  stageEl.style.setProperty('--tw-tail', sec(TYPE_TAIL));
}
function applySmokeVars(sp) {
  if (!stageEl || !sp) return;
  stageEl.style.setProperty('--gq-tot', sec(sp.tot));
  stageEl.style.setProperty('--gq-cdur', sec(sp.cdur));
}

/* ---------- 样式 / 文案同步 ----------
   el：只给这一层收字号（上浮交替过场里只收「新进场的那层」，
   离场那层保住自己原来的字号，不会被带跑 → 过场首尾都不会跳字号）；
   不传就收「在场的所有层」（取最高的那层当约束，见 fitFont） */
function applyQuoteStyle(el) {
  const font = curFont();
  if (stageEl) {
    stageEl.style.fontFamily = font.stack;   // 两层台词槽一起继承
    stageEl.dataset.gqEffect = effectKey();  // CSS 据此决定要不要给散烟留白（见 data-gq-effect）
    applyTimingVars();
  }
  if (textEl) textEl.style.fontFamily = font.stack; // 文本框同步预览所选字体
  updateBand();
  fitFont(el ? [el] : liveSlots());   // --gq-size / --gq-clamp 统一由 fitFont 写
}
function syncQuoteMeta() {
  if (!hintEl) return;
  const parts = [];
  if (overCharNote) parts.push(overCharNote);
  if (!lines.length) {
    parts.push(quoteParams.packEnabled
      ? '还没有台词：内置台词包为空，也可在文本框里每行写一句，进入陈列室即开始轮播'
      : '还没有台词：在文本框里每行写一句，进入陈列室即开始轮播');
  } else {
    const nb = packBase().length;
    const custom = Math.max(0, lines.length - nb);
    if (nb) parts.push(custom ? `内置包 ${nb} 句 + 自定义 ${custom} 句` : `内置包 ${nb} 句`);
    if (lines.length >= MAX_LINES) parts.push(`只取前 ${MAX_LINES} 句`);
    parts.push(`共 ${lines.length} 句 · ${curEffect().name} · 每句停留 ${quoteParams.interval} 秒`
      + (curIdx >= 0 && running ? ` · 正在显示第 ${curIdx + 1} 句` : ''));
    if (fittedPx) {
      parts.push(`上方空间有限，字号自动收到 ${fittedPx}px`
        + (fittedLines < MAX_SHOWN_LINES ? `、只显示 ${fittedLines} 行` : ''));
    }
  }
  hintEl.textContent = parts.join(' · ');
}
function setStageVisible(on) {
  if (!stageEl) return;
  if (stageEl.hidden === !on) return;
  stageEl.hidden = !on;
}
function syncQuoteUI() {
  if (enableEl) enableEl.checked = !!quoteParams.enabled;
  if (textEl && textEl.value !== quoteParams.text) textEl.value = quoteParams.text;
  if (fontEl) fontEl.value = String(quoteParams.fontIndex);
  if (sizeEl) sizeEl.value = String(quoteParams.sizeIndex);
  if (effectEl) effectEl.value = String(quoteParams.effect);
  if (intervalEl) intervalEl.value = String(quoteParams.interval);
  if (intervalValEl) intervalValEl.textContent = `${quoteParams.interval} 秒`;
  if (randomEl) randomEl.checked = !!quoteParams.random;
  if (packEl) packEl.checked = !!quoteParams.packEnabled;
  applyQuoteStyle();
  syncQuoteMeta();
}

/* ---------- 摆放：顶栏与照片之间的空白带 ----------
   gallery.js 每帧把「所有可见照片在屏幕上的最高点」喂进来（setQuoteClearance，
   见 gallery.js 的 quoteClearanceTopPx：环视两侧的邻张、圆环远端的照片、
   扇形两边翘起的手牌都比当前张更高，只让当前张会被压住），
   这里据此算出一条空白带：上沿贴顶栏下方、下沿躲开照片上沿，
   台词块在带内上下居中、水平落在屏幕中轴线上；带子太矮时自动收字号，
   保证台词永远不会压到任何一张照片上。 */
const topBarEl = document.querySelector('.gallery-top');
const MIN_BAND = 44;         // 再挤也留一行台词的高度（16px 一行 + 内边距刚好放得下）
const MIN_FONT = 16;         // 自动收字的地板：再小就宁可少显示几行
let clearTop = 0;            // 当前照片可见区最高点的屏幕 y（px；0 = 没有照片）
let bandTop = 62;            // 空白带上沿（px）
let bandH = 150;             // 空白带高度（px）
let fittedPx = 0;            // 空间不够时自动收到的小字号（0 = 用的就是所选字号）
let fittedLines = 4;         // 自动收过的可见行数（line-clamp）
let fadeDy = FADE_DY_MAX;    // 淡入淡出实际用的位移量（带内余量不足时会小于上限）
let risePx = 60;             // 上浮交替的位移量（px，按两句实际高度算）
let maskPx = 18;             // 上浮交替过场时裁切柔边宽度（px，只吃带内空白余量）
const MAX_SHOWN_LINES = 4;   // 台词最多显示 4 行，再多省略号收尾
let lastClear = -1e9;        // 抖动过滤：相机插值每帧微动，不必每帧重排
let lastVh = 0;

function topBarBottom() {
  const r = topBarEl ? topBarEl.getBoundingClientRect() : null;
  return r && r.height ? Math.round(r.bottom) : 57;
}
function updateBand() {
  const vh = window.innerHeight || 600;
  const top = Math.min(Math.max(topBarBottom() + 8, 48), Math.round(vh * 0.3));
  // 下沿躲开照片上沿（留 12px 呼吸）；没有照片就取 42% 屏高，保持「中间偏上」
  const want = clearTop > 0 ? clearTop - 12 : Math.round(vh * 0.42);
  const bottom = Math.max(Math.min(want, Math.round(vh * 0.66)), top + MIN_BAND);
  bandTop = top;
  bandH = bottom - top;
  if (stageEl) {
    stageEl.style.setProperty('--gq-top', `${bandTop}px`);
    stageEl.style.setProperty('--gq-h', `${bandH}px`);
  }
}
/* 当前「在场」的台词层：有文字且不在 idle 态（上浮交替的过场里是两层） */
function liveSlots() {
  return lineEls.filter((el) => el && el.textContent && el.dataset.gqState !== 'idle');
}
function writeFit(els, px, linesShown) {
  els.forEach((el) => {
    el.style.setProperty('--gq-size', `${px}px`);
    el.style.setProperty('--gq-clamp', String(linesShown));
  });
}
/* 把台词层收进空白带里：先按用户所选字号铺，量真实高度（多层时取最高的那层），
   超出就 ① 先收字号（收到偶数 px 防抖，保句子完整可读），② 收到地板仍放不下
   再减少可见行数（line-clamp，超出部分省略号收尾）—— 两种手段都试过后，
   在场每层的高度必定 ≤ 空白带，于是「台词绝不压到照片」这条是构造性成立的，
   不挑窗口大小 / 照片比例 / 切换效果（上浮交替过场里两层同时在带内）。
   字号写在每层自己的 inline style 上（不吃叠层继承值），所以离场的那一层
   可以保住自己原本的字号，过场首尾都不会跳字号。 */
function fitFont(els) {
  if (!stageEl) return 0;
  const list = (els || []).filter((el) => el && el.textContent);
  const base = curSizePx();
  if (!list.length || stageEl.hidden) {
    fittedPx = 0; fittedLines = MAX_SHOWN_LINES; fadeDy = FADE_DY_MAX;
    return base;
  }
  const smoke = effectKey() === 'smoke';
  // 这一批里有没有「整块雾化」的层（烟消云散 + 超长句不逐字拆）：
  // 有的话目标高度要再扣掉上下各一份飘散余地（见 SMOKE_WHOLE_LIFT）
  const whole = smoke && list.some((el) => el.dataset.gqChars === '0');
  // 量高度之前先把 overflow 摁回 hidden：line-clamp 只在 hidden 下真的裁行，
  // 而烟消云散会让「没截断的行」overflow:visible（放散烟飘出药丸），
  // 不先统一口径的话，被裁的长句会按没裁的全高去收字号（收过头）
  if (smoke) list.forEach((el) => { el.style.overflow = 'hidden'; });
  let px = base;
  let linesShown = MAX_SHOWN_LINES;
  let h = 0;
  let avail = bandH;                        // 真正能用的高度（整块雾化时 = 带高 − 飘散余地）
  for (let i = 0; i < 10; i++) {
    writeFit(list, px, linesShown);
    h = list.reduce((m, el) => Math.max(m, el.offsetHeight), 0);  // 顺带刷一次布局
    // 整块雾化：上下各让出 0.2em 的飘散余地（居中摆放 → 带高要扣两份）
    avail = whole
      ? Math.max(MIN_BAND, bandH - Math.ceil(2 * px * SMOKE_WHOLE_LIFT))
      : bandH;
    if (h <= avail) break;
    if (px > MIN_FONT) {                    // ① 先收字号，尽量保住整句话
      const next = Math.floor((px * avail) / h / 2) * 2;
      px = Math.max(MIN_FONT, next >= px ? px - 2 : next);
      continue;
    }
    if (linesShown > 1) { linesShown--; continue; }   // ② 再减行数（省略号收尾）
    break;                                  // 已经是一行的地板字号，不可能再小（极限窄窗的兜底）
  }
  // ③ 烟消云散：量一句「有没有被 line-clamp 截成省略号」写进 data-gq-trunc ——
  //    没截断的行由 CSS 打开 overflow，散烟的字飘出药丸也不被切，于是框内不必再
  //    预留留白，药丸与上浮交替完全同高；截断的行保留 hidden 护住那个省略号。
  //    量完把 inline overflow 擦掉，交还给 CSS 决定
  if (smoke) {
    list.forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 1) el.dataset.gqTrunc = '1';
      else delete el.dataset.gqTrunc;
      el.style.overflow = '';
    });
  }
  // ④ 淡入淡出的位移量收进带内：取「带内上下余量」与上限的较小值 ——
  //    余量够时（正常窗口）与原样 12px 一模一样，看不出任何差别；
  //    台词几乎撑满空白带时才自动收小，于是淡入淡出也不会越带
  fadeDy = clamp(Math.floor((bandH - h) / 2), 0, FADE_DY_MAX);
  list.forEach((el) => {
    if (fadeDy < FADE_DY_MAX) el.style.setProperty('--gq-fade-dy', `${fadeDy}px`);
    else el.style.removeProperty('--gq-fade-dy');   // 够用就走 CSS 里的上限兜底值
  });
  fittedPx = px < base ? px : 0;
  fittedLines = linesShown;
  return px;
}
/* 上浮交替的位移量（px）= 两句半高之和 + 一道缝隙 ——
   这样上移的那句与下方浮现的那句全程互不重叠（两条曲线对称，位移差恒定）。
   位移不再受空白带高度限制：过场期间台词槽开 overflow:hidden + 柔边遮罩
   （见 style.css 的 data-gq-clip），槽盒就是空白带本身，于是超出带子的部分
   被裁在带内，浮现中的下一句绝不可能压到照片、上移的上一句也不会糊到顶栏。
   顺带把柔边宽度算出来：min(带内空白余量, 18px) —— 遮罩只吃掉台词块到带边
   的那段余量，绝不碰到停稳的台词本身，所以过场结束摘掉遮罩也看不到跳变。 */
function applyRiseVars(hOut, hIn) {
  const a = Math.max(0, hOut);
  const b = Math.max(0, hIn);
  const gap = Math.max(8, Math.round((fittedPx || curSizePx()) * 0.3));
  risePx = Math.round(Math.max(16, (a + b) / 2 + gap));
  maskPx = clamp(Math.floor((bandH - Math.max(a, b)) / 2), 0, 18);
  if (stageEl) {
    stageEl.style.setProperty('--gq-rise', `${risePx}px`);
    stageEl.style.setProperty('--gq-mask', `${maskPx}px`);
  }
  return risePx;
}
/* 过场裁切的开 / 关：进场（rise-enter）与交叉（rise-in / rise-out）期间都开着 */
function setRiseClip(on) {
  lineEls.forEach((el) => {
    const slotElm = el && el.parentNode;
    if (slotElm && slotElm.classList && slotElm.classList.contains('gallery-quote-slot')) {
      if (on) slotElm.dataset.gqClip = '1';
      else delete slotElm.dataset.gqClip;
    }
  });
}
/* 台词块的「最大半宽」（px）：gallery.js 用它当作水平窗口去挑需要让位的照片 ——
   台词块只可能占屏幕中间这么宽的一条，窗口外的照片顶不构成约束。
   直接读 CSS 算好的 max-width（--gq-side 已经把侧栏 / 窄屏都算进去了），
   js 与 css 只有一份「让位量」定义，不会走偏；读不到（元素还没布局）时
   退回与 CSS 等价的算式兜底。按 vw / 侧栏开合缓存，稳态下每帧都是纯读缓存。
   两层台词槽宽度都等于叠层宽度，所以照旧读 A 层，值与单层时代一致。 */
let spanKey = '';
let spanHalf = 0;
function quoteSpanHalfPx() {
  const vw = window.innerWidth || 0;
  const panelHidden = document.body.classList.contains('gallery-panel-hidden');
  const key = `${vw}|${panelHidden}|${stageEl ? stageEl.hidden : 1}`;
  if (key === spanKey && spanHalf > 0) return spanHalf;
  spanKey = key;
  let w = 0;
  if (lineEl) {
    const raw = String(window.getComputedStyle(lineEl).maxWidth || '').trim();
    if (/px$/.test(raw)) w = parseFloat(raw) || 0;
  }
  if (!(w > 0)) {          // 兜底：复刻 CSS 里 --gq-side 的算式（改 CSS 要同步这里）
    const panelSide = vw <= 700 ? 236 : 300;
    const side = panelHidden ? 12 : Math.min(panelSide, Math.max(12, vw / 2 - 90));
    w = Math.max(160, vw - side * 2);
  }
  spanHalf = Math.max(60, w / 2);
  return spanHalf;
}
/* gallery.js 每帧调用：所有可见照片的最高屏幕沿（px），0 = 没有照片 */
function setQuoteClearance(topPx) {
  const t = Math.max(0, Math.round(Number(topPx) || 0));
  const vh = window.innerHeight || 600;
  if (Math.abs(t - lastClear) <= 4 && vh === lastVh) return;   // 抖动 / 每帧重排的浪费都省掉
  lastClear = t;
  const resized = vh !== lastVh;
  lastVh = vh;
  clearTop = t;
  const prevH = bandH;
  updateBand();
  const changed = resized || Math.abs(bandH - prevH) > 4;
  if (changed) {
    fitFont(liveSlots());
    // 带高变了：上浮交替正在过场的话，位移量上限也跟着变，重算一次
    if (phase === 'cross' && pendingSlot >= 0) {
      applyRiseVars(slotEl(curSlot).offsetHeight, slotEl(pendingSlot).offsetHeight);
    }
    syncQuoteMeta();
  }
}
/* 手动要求重排（切陈列模式、进出聚焦等）：绕开抖动过滤直接重算 */
function relayoutQuotes() {
  lastVh = -1;
  lastClear = -1e9;
  spanKey = '';      // 侧栏开合 / 窗口宽变化都会改台词块的最大宽度，缓存作废
  updateBand();
  fitFont(liveSlots());
  if (phase === 'cross' && pendingSlot >= 0) {
    applyRiseVars(slotEl(curSlot).offsetHeight, slotEl(pendingSlot).offsetHeight);
  }
  syncQuoteMeta();
}

/* ---------- 两层台词槽 ---------- */
function slotEl(i) {
  return lineEls[i] || lineEls[0];
}
function otherSlot(i) {
  return i === 0 ? 1 : 0;
}
function setSlotState(el, state) {
  if (!el) return;
  if (el.dataset.gqState === state) {
    // 同一相位重来（改间隔 / 改效果 / 手动下一句）：先摘成未知态再强制回流，
    // 动画才会从头走一遍；回流与复位在同一个任务里完成，中间不产生一帧画面
    el.dataset.gqState = '_restart';
    void el.offsetWidth;
  }
  el.dataset.gqState = state;
}
function clearSlot(i) {
  const el = lineEls[i];
  if (!el) return;
  el.dataset.gqState = 'idle';
  if (el.parentNode && el.parentNode.dataset) delete el.parentNode.dataset.gqClip;  // 空槽不必再裁
  el.dataset.gqChars = '0';
  delete el.dataset.gqTrunc;
  el.style.overflow = '';      // 别把测量用的 inline overflow 留给下一句
  el.textContent = '';
}
function clearSlots() {
  clearSlot(0);
  clearSlot(1);
}
/* 往台词层里填一句：烟消云散与翻页打字机都要逐字拆成 span，其余效果直接放纯文本
   （DOM 更省，折行与单层时代一模一样）。单字 span 的工厂、分词口径与随机漂移变量
   （--gq-dx/dy/sc/rot）都在 js/charsplit.js —— 逐字动画的三路共用同一份。
   两份错峰延迟各自写：
     · 烟消云散：进场 --gq-d 自中心向两侧（烟聚成字）；散场 --gq-d2 的「谁先消失」
       按句轮换（SMOKE_EXIT_PATTERNS，lineIdx mod 4）—— 散场时不必再碰 DOM，
       换一下 data-gq-state 就能接着跑另一组延迟；
     · 翻页打字机：进场 --tw-d = i × step，严格自左向右（打字机的顺序没有花样），
       最后一个字打标记 .gq-c-last → 光标在它身上多闪一会儿；散场不逐字（整页翻走）。 */
function fillSlot(el, text, lineIdx = 0) {
  if (!el) return;
  const key = effectKey();
  const str = String(text == null ? '' : text);
  const perChar = key === 'smoke' || key === 'type';
  const tooLong = str.length > (key === 'smoke' ? SMOKE_MAX_CHARS : TYPE_MAX_CHARS);
  if (!perChar || tooLong || !str.length) {
    el.dataset.gqChars = '0';
    el.textContent = str;
    return;
  }
  const chars = markLastChar(appendChars(el, str));
  el.dataset.gqChars = '1';
  const n = chars.length;
  if (key === 'type') {
    const step = (timings().type || {}).step || TYPE_PER_CHAR;
    chars.forEach((c, i) => c.style.setProperty('--tw-d', sec(i * step)));
    exitPatternIdx = 0;                       // 打字机不散烟，散场顺序无意义
    return;
  }
  const t = timings();
  exitPatternIdx = ((Math.round(lineIdx) % SMOKE_EXIT_PATTERNS.length)
    + SMOKE_EXIT_PATTERNS.length) % SMOKE_EXIT_PATTERNS.length;
  const pat = SMOKE_EXIT_PATTERNS[exitPatternIdx];
  chars.forEach((c, i) => {
    const p = n > 1 ? i / (n - 1) : 0.5;            // 0 → 1：自左向右
    const q = n > 1 ? Math.abs(p - 0.5) * 2 : 0;    // 0 → 1：中心向两侧
    const o = pat.order(p, q);                      // 0 → 1：本句的消失次序（逐句轮换）
    c.style.setProperty('--gq-d', sec(q * 0.66 * t.sin.stag + Math.random() * 0.34 * t.sin.stag));
    c.style.setProperty('--gq-d2', sec(o * 0.62 * t.sout.stag + Math.random() * 0.38 * t.sout.stag));
  });
}

/* ---------- 播放：相位机 ----------
   in（进场）→ hold（停留 = 间隔秒数）→ 过场 → 下一句的 in …
   过场按效果分四种走法：
     fade   出（fade-out）→ 下一句原地进（fade-in）
     rise   交叉（rise-out 与 rise-in 两层同时跑，走完换层落地）
     smoke  逐字散烟（smoke-out）→ 空一拍（gap）→ 原地逐字凝聚（smoke-in）
     type   整页翻走（flip-out）→ 空一拍（gap）→ 原地逐字打出（type-in） */
function setPhase(name, dur) {
  phase = name;
  phaseDur = Math.max(0, Number(dur) || 0);
  phaseLeft = phaseDur;
}
/* 起一句新的：另一层收干净 → 填当前层 → 摆样式（含自动收字）→ 走进场相位 */
function startLine(i) {
  const idx = indexMod(i);
  pendingIdx = -1;
  pendingSlot = -1;
  if (idx < 0) {
    curIdx = -1;
    clearSlots();
    setPhase('idle', 0);
    setStageVisible(false);
    syncQuoteMeta();
    return;
  }
  curIdx = idx;
  clearSlot(otherSlot(curSlot));
  const el = slotEl(curSlot);
  setStageVisible(true);        // 先显示：hidden 状态下 offsetHeight 恒为 0，量不准
  fillSlot(el, lines[curIdx], curIdx);
  applyQuoteStyle(el);          // 字体 / 节奏 + 按空白带高度给这一层自动收字号
  const t = timings();
  if (t.key === 'smoke') {
    setRiseClip(false);
    applySmokeVars(t.sin);
    setSlotState(el, 'smoke-in');
    setPhase('in', t.in);
  } else if (t.key === 'type') {
    // 翻页打字机：药丸先落定，字一个个打出来（逐字延迟已写在每个字的 --tw-d 上）
    setRiseClip(false);
    setSlotState(el, 'type-in');
    setPhase('in', t.in);
  } else if (t.key === 'rise') {
    // 进场也走「从下方浮现」：开裁切，起步位置在空白带下沿之外也不会压到照片
    applyRiseVars(el.offsetHeight, el.offsetHeight);
    setRiseClip(true);
    setSlotState(el, 'rise-enter');
    setPhase('in', t.swap);
  } else {
    setRiseClip(false);
    setSlotState(el, 'fade-in');
    setPhase('in', t.in);
  }
  syncQuoteMeta();
}
function pickNext() {
  if (lines.length <= 1) return 0;
  if (!quoteParams.random) return curIdx + 1;
  let n = curIdx;
  for (let k = 0; k < 8 && n === curIdx; k++) n = Math.floor(Math.random() * lines.length);
  return n === curIdx ? (curIdx + 1) % lines.length : n; // 极端情况兜底：不重复同一句
}
/* 停留结束 → 按效果起过场 */
function beginSwap() {
  const t = timings();
  const outEl = slotEl(curSlot);
  if (t.key === 'rise') {
    const nxt = indexMod(pickNext());
    const inSlot = otherSlot(curSlot);
    const inEl = slotEl(inSlot);
    if (nxt < 0) return;
    // 下一句先摆到另一层，只给这一层收字号：离场那句保住自己的字号不被带跑
    fillSlot(inEl, lines[nxt], nxt);
    applyQuoteStyle(inEl);
    applyRiseVars(outEl.offsetHeight, inEl.offsetHeight);
    setRiseClip(true);                 // 裁到空白带内：位移给足也不会压到照片 / 顶栏
    setSlotState(outEl, 'rise-out');   // 当前句慢慢往上移并且淡出
    setSlotState(inEl, 'rise-in');     // 下一句同时从下方浮现、升回到上一句原来的位置
    pendingIdx = nxt;
    pendingSlot = inSlot;
    setPhase('cross', t.swap);
    syncQuoteMeta();
    return;
  }
  if (t.key === 'smoke') {
    applySmokeVars(t.sout);
    setSlotState(outEl, 'smoke-out');  // 逐字飘散成烟（底板跟着淡出）
    setPhase('out', t.out);
    syncQuoteMeta();
    return;
  }
  if (t.key === 'type') {
    // 翻页：整页绕左边缘翻走（纵向尺度不变、横向只收窄 → 见 TYPE_* 常量注释，不必开裁切）
    setRiseClip(false);
    setSlotState(outEl, 'flip-out');
    setPhase('out', t.out);
    syncQuoteMeta();
    return;
  }
  setSlotState(outEl, 'fade-out');
  setPhase('out', t.out);
  syncQuoteMeta();
}
/* 上浮交替落地：离场那层收干净、换成进场那层，稳稳停住 */
function finishCross() {
  if (pendingSlot >= 0 && pendingSlot !== curSlot) clearSlot(curSlot);
  if (pendingSlot >= 0) curSlot = pendingSlot;
  if (pendingIdx >= 0) curIdx = pendingIdx;
  pendingIdx = -1;
  pendingSlot = -1;
  setRiseClip(false);                  // 停稳之后就不必再裁（柔边只吃余量，摘掉也看不出差别）
  setSlotState(slotEl(curSlot), 'hold');
  setPhase('hold', timings().iv);
  syncQuoteMeta();
}
/* 相位到点了：收尾当前相位、切到下一个（溢出的时间带过去，长播不漂移） */
function stepPhase() {
  const t = timings();
  if (phase === 'in') {                 // 进场走完 → 稳稳停在原位
    setRiseClip(false);
    setSlotState(slotEl(curSlot), 'hold');
    setPhase('hold', t.iv);
    syncQuoteMeta();
    return;
  }
  if (phase === 'hold') { beginSwap(); return; }
  if (phase === 'cross') { finishCross(); return; }
  if (phase === 'out') {
    // 烟消云散（散完空一拍）与翻页打字机（翻走空一拍）都要走 gap，再接下一句的进场
    if (t.gap) { setPhase('gap', t.gap); syncQuoteMeta(); return; }
    startLine(pickNext());
    return;
  }
  if (phase === 'gap') { startLine(pickNext()); return; }
  startLine(0);
}
/* 「立即下一句」：停在 hold 就直接起过场；正走在过场里则先把这一段瞬间收尾，
   免得一次点击叠出两层动画 / 两句台词同时在动 */
function skipPhase() {
  if (phase === 'idle') { startLine(0); return; }
  if (phase === 'cross') { finishCross(); return; }
  if (phase === 'gap') { startLine(pickNext()); return; }
  if (phase === 'out') {                 // 散 / 翻 / 淡到一半：当作已经走完，直接接下一句
    const t0 = timings();
    if (t0.gap) { setPhase('gap', t0.gap); syncQuoteMeta(); return; }
    startLine(pickNext());
    return;
  }
  setRiseClip(false);                    // 打断的可能是上浮进场：先把裁切摘掉
  setSlotState(slotEl(curSlot), 'hold'); // in / hold：内容已在位，直接起过场
  beginSwap();                           // beginSwap 会按效果重新决定要不要裁
}
/* 重新解析文本框 → 台词；正在播放时立即重显当前句，改动即时可见 */
/* ---------- 台词两层合并 ----------
 * 播放集合 = 内置台词包 ++ 文本框自定义层（剔除与包重复的句子）。
 * 包内容永不写进 localStorage：改了 txt 重新部署，老访客下一帧就是新句，
 * 也永远不会覆盖他们在文本框里手写的句子。 */
function packBase() {
  if (!quoteParams.packEnabled) return [];
  if (packText === null) return parseLines(DEFAULT_TEXT);  // 包没到 / 拉取失败：回退代码内默认四条
  return parseLines(packText);
}
function computeLines() {
  const base = packBase();
  if (!base.length) return parseLines(quoteParams.text);
  const seen = new Set(base);
  return base.concat(parseLines(quoteParams.text).filter((l) => !seen.has(l))).slice(0, MAX_LINES);
}
function refreshLines() {
  lines = computeLines();
  if (!lines.length) {
    curIdx = -1;
    pendingIdx = -1;
    pendingSlot = -1;
    clearSlots();
    setPhase('idle', 0);
    setStageVisible(false);
    syncQuoteMeta();
    return;
  }
  if (curIdx >= lines.length) curIdx = -1;
  if (running && quoteParams.enabled) startLine(curIdx < 0 ? 0 : curIdx);
  else syncQuoteMeta();
}

/* ---------- 陈列室开 / 关（由 gallery.js 调用）---------- */
function startQuotes() {
  running = true;
  lastStamp = 0;
  curIdx = -1;                       // 每次进入都从第一句开始，便于「从头看」
  curSlot = 0;
  pendingIdx = -1;
  pendingSlot = -1;
  setPhase('idle', 0);
  clearSlots();
  if (quoteParams.enabled && lines.length) startLine(0);
  else { setStageVisible(false); syncQuoteMeta(); }
}
function stopQuotes() {
  running = false;
  lastStamp = 0;
  curIdx = -1;
  pendingIdx = -1;
  pendingSlot = -1;
  setPhase('idle', 0);
  clearSlots();
  setStageVisible(false);
}
/* 陈列室渲染循环每帧调用；time 为秒级时间戳（performance.now() / 1000）。
   动画在 CSS 里自己跑，这里只推进相位：相位时长到点就换相位；
   切后台（rAF 停）时 CSS 动画照样跑完并停在末态（fill:both），
   js 这边一帧最多走 0.1 秒 → 回来只会「补完」不会「跳句 / 堆句」 */
function updateQuotes(time) {
  if (!running) return;
  const dt = lastStamp ? clamp(time - lastStamp, 0, 0.1) : 0; // 卡顿 / 切回来时不按大步长跳相位
  lastStamp = time;
  if (!quoteParams.enabled || !lines.length) {
    if (phase !== 'idle' || curIdx !== -1) {
      curIdx = -1;
      pendingIdx = -1;
      pendingSlot = -1;
      clearSlots();
      setPhase('idle', 0);
      setStageVisible(false);
      syncQuoteMeta();
    }
    return;
  }
  if (phase === 'idle') { startLine(0); return; }
  phaseLeft -= dt;
  if (phaseLeft > 0) return;
  const over = Math.max(0, -phaseLeft);
  stepPhase();
  if (phase !== 'idle') phaseLeft = Math.max(0, phaseLeft - over);
}

/* ---------- 控件绑定 ---------- */
FONT_LIST.forEach((font, i) => {
  if (!fontEl) return;
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = font.name;
  o.style.fontFamily = font.stack;   // 下拉项自带字体预览
  fontEl.appendChild(o);
});
SIZE_STEPS.forEach((s, i) => {
  if (!sizeEl) return;
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = s.name;
  sizeEl.appendChild(o);
});
EFFECT_LIST.forEach((e, i) => {
  if (!effectEl) return;
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = e.name;
  o.title = e.note;                  // 悬停即可看到这句效果到底怎么演
  effectEl.appendChild(o);
});

if (enableEl) enableEl.addEventListener('change', () => {
  quoteParams.enabled = !!enableEl.checked;
  saveConfig();
  if (!quoteParams.enabled) {
    clearSlots();
    setPhase('idle', 0);
    setStageVisible(false);
    syncQuoteMeta();
    return;
  }
  if (running && lines.length) startLine(curIdx < 0 ? 0 : curIdx);
  else syncQuoteMeta();
});
if (packEl) packEl.addEventListener('change', () => {
  quoteParams.packEnabled = !!packEl.checked;
  saveConfig();
  refreshLines();
  syncQuoteUI();
});
if (textEl) textEl.addEventListener('input', () => {
  const raw = textEl.value;
  quoteParams.text = raw.slice(0, MAX_TEXT);
  if (raw.length > MAX_TEXT) {
    // 超上限：把截断后的值写回文本框，避免「看到的」和「保存 / 播放的」不一致
    textEl.value = quoteParams.text;
    overCharNote = `已达 ${MAX_TEXT} 字上限，超出部分已自动截断`;
  } else {
    overCharNote = '';
  }
  syncQuoteMeta();
  saveConfig();
  // 连续输入时不逐字重建画面，停顿 0.4 秒后再刷新台词
  clearTimeout(debounceId);
  debounceId = setTimeout(refreshLines, 400);
});
if (fontEl) fontEl.addEventListener('change', () => {
  quoteParams.fontIndex = intIn(fontEl.value, FONT_LIST.length - 1);
  syncQuoteUI();
  saveConfig();
});
if (sizeEl) sizeEl.addEventListener('change', () => {
  quoteParams.sizeIndex = intIn(sizeEl.value, SIZE_STEPS.length - 1);
  applyQuoteStyle();
  saveConfig();
});
if (effectEl) effectEl.addEventListener('change', () => {
  quoteParams.effect = intIn(effectEl.value, EFFECT_LIST.length - 1);
  saveConfig();
  // 换效果 = 换一套相位与拆分方式，正在播的这句直接按新效果重新起头
  applyQuoteStyle();
  syncQuoteMeta();
  if (running && lines.length) startLine(curIdx < 0 ? 0 : curIdx);
});
if (intervalEl) intervalEl.addEventListener('input', () => {
  quoteParams.interval = clamp(Math.round(Number(intervalEl.value) || DEFAULT_INTERVAL), MIN_INTERVAL, MAX_INTERVAL);
  if (intervalValEl) intervalValEl.textContent = `${quoteParams.interval} 秒`;
  applyQuoteStyle();
  syncQuoteMeta();
  saveConfig();
  if (running && lines.length && curIdx >= 0) startLine(curIdx); // 新节奏立即生效
});
if (randomEl) randomEl.addEventListener('change', () => {
  quoteParams.random = !!randomEl.checked;
  saveConfig();
});
if ($('quoteNext')) $('quoteNext').addEventListener('click', () => {
  if (!lines.length) return;
  if (!running) return;   // 陈列室未打开时没有画面，避免空转
  skipPhase();
});

window.addEventListener('resize', relayoutQuotes);

/* ---------- 配置持久化 ---------- */
registerConfig({
  save: () => ({ galleryQuotes: { ...quoteParams } }),
  load: (cfg) => {
    const q = cfg && cfg.galleryQuotes;
    if (!q || typeof q !== 'object') return;
    if (typeof q.enabled === 'boolean') quoteParams.enabled = q.enabled;
    if (typeof q.text === 'string') {
      let txt = q.text.slice(0, MAX_TEXT);
      // 旧版迁移：老用户文本框里躺的就是 DEFAULT_TEXT 那四条；如今这四条归内置台词包管，
      // 自定义层应为空，避免「包里的句 + 文本框里同样的句」重复播放。
      if (txt.trim() === DEFAULT_TEXT.trim()) txt = '';
      quoteParams.text = txt;
    }
    if (typeof q.packEnabled === 'boolean') quoteParams.packEnabled = q.packEnabled;
    overCharNote = '';
    if (q.fontIndex !== undefined) quoteParams.fontIndex = intIn(q.fontIndex, FONT_LIST.length - 1);
    if (q.sizeIndex !== undefined) quoteParams.sizeIndex = intIn(q.sizeIndex, SIZE_STEPS.length - 1);
    if (q.effect !== undefined) quoteParams.effect = intIn(q.effect, EFFECT_LIST.length - 1);
    if (q.interval !== undefined) {
      quoteParams.interval = clamp(Math.round(Number(q.interval) || DEFAULT_INTERVAL), MIN_INTERVAL, MAX_INTERVAL);
    }
    if (typeof q.random === 'boolean') quoteParams.random = q.random;
    lines = computeLines();
    syncQuoteUI();
  },
});

/* 当前播放集合（内置台词包 ++ 自定义层，已去重 / 去空行）的一份副本 ——
   js/photoquotes.js 的「随机配一句」「全部自动配句」从这里取句，
   于是照片级台词用的池子跟轮播的池子始终是同一份，不必另存一套。 */
function quoteLinePool() {
  return lines.slice();
}

function quoteDebug() {
  const t = timings();
  const el = slotEl(curSlot);
  const rect = el ? el.getBoundingClientRect() : null;
  return {
    enabled: quoteParams.enabled,
    running,
    total: lines.length,
    index: curIdx,
    text: el ? el.textContent : '',
    font: curFont().name,
    sizePx: curSizePx(),
    effect: quoteParams.effect,
    effectKey: effectKey(),
    smokeExitIdx: exitPatternIdx,
    smokeExitPattern: SMOKE_EXIT_PATTERNS[exitPatternIdx].name,
    effectName: curEffect().name,
    type: t.type ? {                                  // 打字机这一句的实际节拍
      whole: !!t.type.whole,                          // true = 超长句走整块退路
      chars: t.type.n || 0,                           // 会拆成多少个字符 span
      stepMs: t.type.step ? Math.round(t.type.step * 1000) : 0,
      charMs: t.type.cdur ? Math.round(t.type.cdur * 1000) : 0,
      tailMs: Math.round(TYPE_TAIL * 1000),
    } : null,
    interval: quoteParams.interval,
    random: quoteParams.random,
    packLoaded: packText !== null,
    packEnabled: quoteParams.packEnabled,
    packLines: packBase().length,
    customLines: Math.max(0, lines.length - packBase().length),  // 包句数超过 MAX_LINES 时兜成 0
    visible: !!stageEl && !stageEl.hidden,
    phase,
    phaseDur: +phaseDur.toFixed(2),
    phaseLeft: +phaseLeft.toFixed(2),
    elapsed: +(phaseDur - phaseLeft).toFixed(2),
    dur: {                      // 当前效果这套节奏的实际秒数（相位机与 CSS 同源）
      hold: t.iv, in: t.in, out: t.out, swap: t.swap, gap: t.gap,
      smokeIn: t.sin ? t.sin.tot : undefined, smokeOut: t.sout ? t.sout.tot : undefined,
    },
    slot: curSlot,
    pending: pendingIdx >= 0 ? pendingIdx : null,
    pendingSlot: pendingSlot >= 0 ? pendingSlot : null,
    risePx,                     // 上浮交替的位移量（= 两句半高之和 + 缝隙 → 全程不重叠）
    maskPx,                     // 上浮交替过场时裁切柔边宽度（0 = 带内没有余量，硬裁）
    fadeDy,                     // 淡入淡出实际位移（< 12 = 空白带余量不够，已自动收小）
    sizeUsed: fittedPx || curSizePx(),   // 真正生效的字号（自动收过就是收后的值）
    autoFit: fittedPx,                   // 0 = 没被自动收字
    linesShown: fittedLines,             // 自动收过的可见行数
    clearTop,                            // 所有可见照片的最高屏幕沿（px，0 = 无）
    band: [bandTop, bandTop + bandH],    // 允许台词待的空白带
    slots: lineEls.map((s, i) => (s ? {   // 两层各自的状态（过场时两层同时在动）
      i,
      state: s.dataset.gqState || 'idle',
      clip: !!(s.parentNode && s.parentNode.dataset && s.parentNode.dataset.gqClip === '1'),
      chars: s.dataset.gqChars === '1',
      trunc: s.dataset.gqTrunc === '1',
      len: s.textContent.length,
      charsN: s.querySelectorAll('.gq-c').length,      // 逐字 span 数（打字机 / 散烟）
      lastCaret: !!s.querySelector('.gq-c-last'),      // 光标收尾标记在不在
      h: s.offsetHeight || 0,
      top: Math.round(s.getBoundingClientRect().top),
      bottom: Math.round(s.getBoundingClientRect().bottom),
    } : null)),
    box: rect ? {                       // 当前这层台词块在屏幕上的实际矩形
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), right: Math.round(rect.right),
      w: Math.round(rect.width), h: Math.round(rect.height),
      cx: Math.round((rect.left + rect.right) / 2),
    } : null,
    vw: window.innerWidth, vh: window.innerHeight,
  };
}

/* 启动即用默认值铺好控件（loadConfig 之后会被保存值覆盖） */
lines = computeLines();
syncQuoteUI();
/* 后台拉内置台词包：几 KB 不阻塞首屏；到了再合并进播放集合（不碰文本框里的自定义层） */
fetchQuotePack().then((pack) => {
  packText = pack.ok ? pack.text : null;
  refreshLines();
  syncQuoteUI();
});

export {
  startQuotes, stopQuotes, updateQuotes, refreshLines, quoteParams, quoteDebug,
  parseLines, SIZE_STEPS, EFFECT_LIST, setQuoteClearance, relayoutQuotes, quoteSpanHalfPx,
  quoteLinePool,
};
