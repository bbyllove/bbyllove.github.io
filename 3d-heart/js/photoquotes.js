/* ================================================================
 * js/photoquotes.js —— 照片级台词：每张照片配一句，聚焦（灯箱）时打出来
 *
 * 与「台词轮播」（js/galleryquotes.js）是两套东西、共用一套观感与一份打字机 CSS：
 *   · 轮播台词在陈列室**常态**下滚动（顶栏与照片之间那条空白带里），聚焦时淡出让位；
 *   · 照片级台词只在**聚焦某一张**时出现，说的是这一张照片自己的话，一次讲完不循环。
 * 位置在画面底部、图注之上（图注 bottom:64 → 这里 bottom:104）。
 *
 * 「不压照片」在聚焦模式同样是构造性成立的：gallery.js 算聚焦自适应倍数时，
 * 底栏让位量取 max(120px, photoQuoteReservePx())，而 photoQuoteReservePx()
 * = 药丸下沿(104) + 药丸实高 + 10px 呼吸 —— 于是照片的可见区恒在这句话之上。
 * 放大（focusZoom > 1.12）本来就是「允许超出画幅裁切看细节」，这时把台词淡出
 * （pq-dim）让位给照片，但**不撤让位量**：免得一边滚轮一边重排照片，画面抖。
 *
 * 台词从哪来（两层，与 45/47 的「内置台词包 ++ 自定义层」同一个思路）：
 *   ① 内置层 assets/gallery/quotes.txt —— sidecar：第 N 行 = manifest 排序后第 N 张，
 *      空行 = 这张不配。tools/build_assets.py 把它并进 manifest.json 的 quote 字段，
 *      js/seedphotos.js 透传到 photo.quote → 在 GitHub 网页上改一行提交即可生效，
 *      代码零改动、不依赖访客浏览器存储；
 *   ② 访客层 —— 按 photo.id 存进全局配置（随导出 / 方案一并带走）：
 *      内置图 id = `seed:<文件名>`（稳定：文件名就是契约），导入图 id 存在 IndexedDB
 *      里、刷新不变。**照片的台词一个字节都不写进 IndexedDB** —— 照片字节与台词文本
 *      分开存，改台词不必重写几十张照片的 dataUrl。
 *   优先级：访客层写了就以它为准（写空串 = 明确「这张不要台词」，用于盖掉内置那句）；
 *   键不存在才落到内置层 → 「用回内置台词」就是把这个键删掉。
 *
 * 进场用的就是效果四那套打字机（同一个 data-*-state="type-in" + --tw-* 变量、
 * 同一份 js/charsplit.js 逐字拆分），可整体关掉退化成淡入。
 * ================================================================ */
import { $ } from './dom.js';
import { registerConfig, saveConfig } from './config.js';
import { quoteLinePool, quoteParams, SIZE_STEPS } from './galleryquotes.js';
import { FONT_LIST } from './fonts.js';
import { appendChars, spanCount, markLastChar } from './charsplit.js';

const PQ_BOTTOM = 104;      // 药丸下沿距视口底部（图注 bottom:64、提示条 bottom:20）
const PQ_GAP = 10;          // 与照片之间再留一口呼吸（一起算进让位量）
const BASE_RESERVE = 120;   // gallery.js 聚焦时底栏本来就留的量（图注 + 提示条）
const PQ_MAX_LEN = 120;     // 单张照片台词的字数上限（它是图注级的一句话，不是正文）
const PQ_MAX_ENTRIES = 200; // 访客层条数上限（防配置无限膨胀）
const TYPE_PER_CHAR = 0.05; // 打字节拍（秒/字）≈ 20 字/秒：一句 12 字约 0.6 秒打完
const TYPE_MIN = 0.55;      // 再短也至少打这么久，看得出是逐字打的
const TYPE_MAX = 2.6;       // 再长也不许拖（它是聚焦时的点睛，不该让人等）
const TYPE_TAIL = 0.45;     // 打完后光标再闪一会儿
const TYPE_MAX_CHARS = 120; // 超过就不逐字，整块淡入（与轮播台词同一个理由）
const DIM_ZOOM = 1.12;      // 放大超过这个倍数就把台词淡出让位给照片
const SEED_PREFIX = 'seed:';// 内置照片的 id 前缀（剪枝时用它区分两类）

const params = {
  enabled: true,            // 聚焦时是否显示照片级台词
  type: true,               // 是否用打字机进场（关掉 = 整块淡入）
  map: {},                  // 访客层：photo.id → 台词（'' = 明确不要）
};

/* gallery.js 注入的三个钩子：相册数组 / 重新渲染缩略图 / 当前选中的那张。
   用钩子而不是互相 import —— gallery.js 已经 import 本模块，反向依赖会成环。 */
const hooks = { list: () => [], rerender: null, current: () => null };

const wrapEl = $('galleryPhotoQuote');
const lineEl = $('galleryPhotoQuoteLine');
const whoEl = $('photoQuoteWho');
const textEl = $('photoQuoteText');
const enableEl = $('photoQuoteEnabled');
const typeEl = $('photoQuoteType');
const hintEl = $('photoQuoteHint');
const resetSeedBtn = $('photoQuoteResetSeed');

let focused = false;        // 现在是不是聚焦态（灯箱开着）
let curId = '';             // 正在显示的那张的 id
let pillH = 0;              // 药丸实测高度（px）
let reserve = 0;            // 交给 gallery.js 的底栏让位量（px）
let dimmed = false;         // 放大到把台词淡出了吗
let editedId = '';          // 侧栏编辑器现在对着哪一张
let showTimer = 0;
let hideTimer = 0;
let editDebounce = 0;
let editNote = '';          // 编辑器的一次性提示（并入 hint）

/* ---------- 小工具 ---------- */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sec = (v) => `${(Number(v) || 0).toFixed(3)}s`;
const own = (k) => Object.prototype.hasOwnProperty.call(params.map, k);
function seedText(p) {
  return String((p && p.quote) || '').replace(/\s+/g, ' ').trim().slice(0, PQ_MAX_LEN);
}
/** 有效台词（不看开关）：访客层优先，键不存在才落回内置层 */
function photoQuoteText(p) {
  if (!p || !p.id) return '';
  if (own(p.id)) return params.map[p.id];
  return seedText(p);
}
/** 这句是哪来的：user 自己写的 / cleared 明确清空 / seed 内置层 / none 没有 */
function photoQuoteSource(p) {
  if (!p || !p.id) return 'none';
  if (own(p.id)) return params.map[p.id] ? 'user' : 'cleared';
  return seedText(p) ? 'seed' : 'none';
}
/** 显示用的台词（开关关掉就一律不出声），聚焦显示与缩略图角标都走它 */
function photoQuoteOf(p) {
  return params.enabled ? photoQuoteText(p) : '';
}
function hasPhotoQuote(p) {
  return !!photoQuoteOf(p);
}
/* 字号跟着轮播台词的选择折算（它是图注级的一句话，不该跟轮播台词一样大）：
   18px → 15、36px → 21、80px → 27，始终落在 [15, 27] 里 */
function pqSizePx() {
  const s = SIZE_STEPS[quoteParams.sizeIndex] || SIZE_STEPS[3];
  return clamp(Math.round(s.px * 0.58), 15, 27);
}
function applyStyle() {
  if (!wrapEl) return;
  const f = FONT_LIST[quoteParams.fontIndex] || FONT_LIST[0];
  wrapEl.style.fontFamily = f.stack;
  wrapEl.style.setProperty('--pq-size', `${pqSizePx()}px`);
}

/* ---------- 写 / 删 ----------
   改完立刻：剪枝 → 存配置 → 同步侧栏与缩略图 → 正在聚焦这张就重打一次 */
function commit(p, note) {
  pruneEntries();
  saveConfig();
  editNote = note || '';
  syncEditor();
  if (hooks.rerender) hooks.rerender();          // 缩略图上的「❝」角标要跟上
  if (focused && p && curId === p.id) showFor(p);
}
function setPhotoQuote(p, text) {
  if (!p || !p.id) return;
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, PQ_MAX_LEN);
  params.map[p.id] = t;       // 空串也写：明确表示「这张不要台词」，盖得住内置那句
  commit(p, t ? '' : '已清空这张的台词');
}
function resetPhotoQuote(p) {
  if (!p || !p.id) return;
  const had = own(p.id);
  delete params.map[p.id];    // 删掉访客层这一键 → 落回内置那句
  commit(p, had ? '已改回内置台词' : '');
}
/** 删掉某张照片的台词条目（照片被 ✕ 删掉时调用）：只有导入图值得删，
    内置图的 id（seed:<文件名>）留着 —— 「清空相册」后再「恢复内置相册」，
    当初给它写的那句还在（内容跟着文件名走，与内置删除记录同一套语义） */
function dropPhotoQuote(p) {
  if (!p || !p.id) return;
  if (String(p.id).startsWith(SEED_PREFIX)) return;
  if (!own(p.id)) return;
  delete params.map[p.id];
  saveConfig();
}
/** 剪枝：删掉「相册里已经没有这张」的导入图条目 + 没有内置台词可盖的空串条目，
    再按插入顺序砍到条数上限（防配置无限膨胀） */
function pruneEntries() {
  const album = hooks.list ? hooks.list() : [];
  if (album.length) {
    const alive = new Set(album.map((p) => p.id));
    for (const k of Object.keys(params.map)) {
      if (!alive.has(k) && !String(k).startsWith(SEED_PREFIX)) delete params.map[k];
    }
  }
  /* 空串条目（= 明确「这张不要台词」，用来盖住内置那句）只在**看得见这张、
     且它确实有内置句可盖**时才有意义。看不见就一律留着：相册是异步装起来的，
     模块刚初始化时 album 还是空的，这时候乱删会把访客「盖掉内置句」的意图弄丢 */
  for (const k of Object.keys(params.map)) {
    if (params.map[k]) continue;
    const p = album.find((q) => q.id === k);
    if (p && !seedText(p)) delete params.map[k];
  }
  const keys = Object.keys(params.map);
  const over = keys.length - PQ_MAX_ENTRIES;
  if (over > 0) keys.slice(0, over).forEach((k) => delete params.map[k]);
}
function prunePhotoQuotes() {
  pruneEntries();
  saveConfig();
  syncEditor();
  if (hooks.rerender) hooks.rerender();
}
/** 全部自动配句：给还没有台词的那几张，从当前台词池（内置包 ++ 自定义层）里
    按顺序循环取句配上；已经有台词的一张都不动（要改就单选那张重写） */
function autoFillAll() {
  const album = hooks.list ? hooks.list() : [];
  const pool = quoteLinePool();
  if (!album.length) { editNote = '相册是空的，先导入或恢复照片'; syncEditor(); return; }
  if (!pool.length) { editNote = '台词池是空的（内置台词包关了、自定义层也没写）'; syncEditor(); return; }
  const todo = album.filter((p) => p && p.id && !photoQuoteText(p));
  if (!todo.length) { editNote = '每张都已经有台词了，不需要自动配'; syncEditor(); return; }
  todo.forEach((p, i) => { params.map[p.id] = pool[i % pool.length]; });
  commit(null, `已给 ${todo.length} 张自动配句（台词池 ${pool.length} 句循环取用）`);
}
/** 随机配一句：从台词池里挑一句和当前不一样的 */
function randomFor(p) {
  if (!p || !p.id) return;
  const pool = quoteLinePool();
  if (!pool.length) { editNote = '台词池是空的，先在「台词轮播」里写几句'; syncEditor(); return; }
  const cur = photoQuoteText(p);
  let pick = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1) {
    for (let k = 0; k < 8 && pick === cur; k++) pick = pool[Math.floor(Math.random() * pool.length)];
  }
  params.map[p.id] = pick;
  commit(p, '');
}

/* ---------- 显示（聚焦态）----------
   打字机的全部逻辑只读 --tw-*，与轮播台词共用 style.css 里那份 CSS */
function measure() {
  pillH = lineEl ? lineEl.offsetHeight : 0;   // visibility:hidden 仍参与布局 → 量得到真高
  reserve = focused && params.enabled && pillH > 0 ? PQ_BOTTOM + pillH + PQ_GAP : 0;
}
function hardReset() {
  clearTimeout(hideTimer);
  hideTimer = 0;
  if (lineEl) { lineEl.textContent = ''; lineEl.dataset.pqState = 'idle'; }
  curId = '';
  pillH = 0;
  reserve = 0;
}
function showFor(p) {
  if (!lineEl || !wrapEl) return;
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  showTimer = hideTimer = 0;
  curId = p && p.id ? p.id : '';
  const text = p ? photoQuoteOf(p) : '';
  if (!text) {                               // 这张没配台词：底部什么都不出
    wrapEl.classList.remove('pq-on');
    hardReset();
    return;
  }
  applyStyle();
  lineEl.dataset.pqState = 'idle';
  if (params.type && text.length <= TYPE_MAX_CHARS) {
    const chars = markLastChar(appendChars(lineEl, text));
    const n = Math.max(1, chars.length || spanCount(text));
    const total = clamp(n * TYPE_PER_CHAR, TYPE_MIN, TYPE_MAX);
    const step = total / n;
    lineEl.style.setProperty('--tw-step', sec(step));
    lineEl.style.setProperty('--tw-dur', sec(clamp(step * 0.9, 0.07, 0.15)));
    lineEl.style.setProperty('--tw-tail', sec(TYPE_TAIL));
    chars.forEach((c, i) => c.style.setProperty('--tw-d', sec(i * step)));
    lineEl.dataset.pqState = 'type-in';
    // 打完（含光标收尾）换成稳态：稳态没有任何动画在跑，合成器彻底歇手。
    // 定时器被切后台拖晚了也不影响画面 —— 逐字动画是 forwards，早停在揭开态了
    showTimer = setTimeout(() => {
      showTimer = 0;
      if (lineEl.dataset.pqState === 'type-in') lineEl.dataset.pqState = 'show';
    }, Math.round((total + TYPE_TAIL) * 1000));
  } else {
    lineEl.textContent = text;               // 关了打字机 / 超长句：整块淡入
    lineEl.dataset.pqState = 'fade-in';
    showTimer = setTimeout(() => {
      showTimer = 0;
      if (lineEl.dataset.pqState === 'fade-in') lineEl.dataset.pqState = 'show';
    }, 320);
  }
  wrapEl.classList.add('pq-on');
  measure();                                 // 同步量：聚焦第一帧就能让对位
}
function showPhotoQuote(p) {
  focused = true;
  dimmed = false;
  if (wrapEl) wrapEl.classList.remove('pq-dim');
  showFor(p || (hooks.current ? hooks.current() : null));
}
function hidePhotoQuote() {
  focused = false;
  clearTimeout(showTimer);
  showTimer = 0;
  if (!wrapEl || !wrapEl.classList.contains('pq-on')) { hardReset(); return; }
  if (lineEl) lineEl.dataset.pqState = 'out';
  wrapEl.classList.remove('pq-on');
  reserve = 0;                               // 立刻松掉让位量：底栏空间马上还给照片
  pillH = 0;
  hideTimer = setTimeout(hardReset, 320);
}
/** gallery.js 每帧喂一次聚焦缩放倍数：放大到要裁切看细节时把这句淡出 */
function syncPhotoQuoteZoom(z) {
  const want = Number(z) > DIM_ZOOM;
  if (want === dimmed || !wrapEl) return;
  dimmed = want;
  wrapEl.classList.toggle('pq-dim', want);
}
/** 底栏让位量（px），0 = 现在没有照片台词占位。gallery.js：max(120, 这个值) */
function photoQuoteReservePx() {
  return reserve;
}

/* ---------- 侧栏编辑器 ---------- */
function editedPhoto() {
  const album = hooks.list ? hooks.list() : [];
  return album.find((p) => p && p.id === editedId) || null;
}
function editorHint(p) {
  const head = editNote ? `${editNote} · ` : '';
  if (!p) return `${head}选中一张照片就能给它配一句专属台词（← / → 或点缩略图切换）。`;
  const n = Object.keys(params.map).filter((k) => params.map[k]).length;
  const src = photoQuoteSource(p);
  const tail = src === 'seed'
    ? '当前这句来自内置层 assets/gallery/quotes.txt（仓库里改一行，所有访客都会看到）'
    : src === 'user'
      ? '当前这句是你自己写的，随全局配置保存（导出 / 方案一并带走）'
      : src === 'cleared'
        ? '你已明确清空这张的台词（有内置句的话，点「用回内置台词」可恢复）'
        : '这张还没有台词：写一句，或点「随机配一句」从台词池里挑';
  return `${head}聚焦（点照片进灯箱）时逐字打出这一句，最多两行、${PQ_MAX_LEN} 字以内。${tail}。已配 ${n} 张。`;
}
function syncEditor() {
  const p = editedPhoto() || (hooks.current ? hooks.current() : null);
  if (p && p.id) editedId = p.id;
  if (enableEl) enableEl.checked = !!params.enabled;
  if (typeEl) typeEl.checked = !!params.type;
  if (whoEl) {
    const album = hooks.list ? hooks.list() : [];
    const i = p ? album.indexOf(p) : -1;
    whoEl.textContent = p && i >= 0 ? `第 ${i + 1} / ${album.length} 张 · ${p.name}` : '相册里还没有照片';
  }
  if (textEl) {
    const t = p ? photoQuoteText(p) : '';
    // 正在这个框里打字时不要回写：光标会被拽到末尾
    if (textEl.value !== t && document.activeElement !== textEl) textEl.value = t;
    textEl.disabled = !p;
  }
  if (resetSeedBtn) resetSeedBtn.hidden = !(p && seedText(p) && own(p.id));
  if (hintEl) hintEl.textContent = editorHint(p);
}
function syncPhotoQuoteEditor() {
  editNote = '';
  syncEditor();
}

/* ---------- 控件绑定 ---------- */
if (enableEl) enableEl.addEventListener('change', () => {
  params.enabled = !!enableEl.checked;
  saveConfig();
  if (!params.enabled) hidePhotoQuote();
  else if (focused) showFor(hooks.current ? hooks.current() : null);
  syncEditor();
  if (hooks.rerender) hooks.rerender();
});
if (typeEl) typeEl.addEventListener('change', () => {
  params.type = !!typeEl.checked;
  saveConfig();
  if (focused) showFor(hooks.current ? hooks.current() : null);   // 换进场方式立刻重演
});
if (textEl) textEl.addEventListener('input', () => {
  const p = editedPhoto();
  if (!p) return;
  const raw = textEl.value.slice(0, PQ_MAX_LEN);
  if (raw.length < textEl.value.length) textEl.value = raw;   // 超上限就把多出来的截掉写回
  params.map[p.id] = raw.replace(/\s+/g, ' ').trim();
  editNote = '';
  saveConfig();
  clearTimeout(editDebounce);
  // 连续输入不逐字重画缩略图角标 / 提示条，停顿 0.35 秒再一起收
  editDebounce = setTimeout(() => {
    editDebounce = 0;
    pruneEntries();
    syncEditor();
    if (hooks.rerender) hooks.rerender();
    if (focused && curId === p.id) showFor(p);
  }, 350);
});
if ($('photoQuoteRandom')) $('photoQuoteRandom').addEventListener('click', () => randomFor(editedPhoto()));
if ($('photoQuoteClear')) $('photoQuoteClear').addEventListener('click', () => {
  const p = editedPhoto();
  if (p) setPhotoQuote(p, '');
});
if (resetSeedBtn) resetSeedBtn.addEventListener('click', () => resetPhotoQuote(editedPhoto()));
if ($('photoQuoteFillAll')) $('photoQuoteFillAll').addEventListener('click', autoFillAll);
window.addEventListener('resize', () => {
  applyStyle();            // 字号档位 / vw 兜底都可能变
  measure();               // 让位量跟着实测高度走（gallery.js 下一帧就用新值）
});

/* ---------- 配置持久化（访客层与开关都随全局配置走）---------- */
registerConfig({
  save: () => ({ photoQuotes: { enabled: params.enabled, type: params.type, map: { ...params.map } } }),
  load: (cfg) => {
    const q = cfg && cfg.photoQuotes;
    if (!q || typeof q !== 'object') return;
    if (typeof q.enabled === 'boolean') params.enabled = q.enabled;
    if (typeof q.type === 'boolean') params.type = q.type;
    if (q.map && typeof q.map === 'object' && !Array.isArray(q.map)) {
      const next = {};
      for (const k of Object.keys(q.map).slice(0, PQ_MAX_ENTRIES)) {
        const v = q.map[k];
        if (typeof v !== 'string' || !k) continue;
        next[k] = v.replace(/\s+/g, ' ').trim().slice(0, PQ_MAX_LEN);
      }
      params.map = next;
    }
    syncEditor();
    // 配置到位得比相册装好还早 / 还晚都有可能：让缩略图上的「❝」角标跟着补一次
    if (hooks.rerender) hooks.rerender();
  },
});

/* 调试 / 验收：与 quoteDebug / galleryDebug 同一风格 */
function photoQuoteDebug() {
  const p = editedPhoto();
  const album = hooks.list ? hooks.list() : [];
  const rect = lineEl ? lineEl.getBoundingClientRect() : null;
  return {
    enabled: params.enabled,
    typeIn: params.type,
    focused,
    curId: curId || null,
    editing: p ? p.id : null,
    editingName: p ? p.name : null,
    text: lineEl ? lineEl.textContent : '',
    source: p ? photoQuoteSource(p) : 'none',
    seedText: p ? seedText(p) : '',
    state: lineEl ? lineEl.dataset.pqState || 'idle' : 'idle',
    chars: lineEl ? lineEl.querySelectorAll('.gq-c').length : 0,
    caretMark: !!(lineEl && lineEl.querySelector('.gq-c-last')),
    sizePx: pqSizePx(),
    pillH,
    reserve,                    // 交给 gallery.js 的底栏让位量（0 = 没占位）
    baseReserve: BASE_RESERVE,
    bottom: PQ_BOTTOM,
    gap: PQ_GAP,
    dimmed,
    on: !!(wrapEl && wrapEl.classList.contains('pq-on')),
    userEntries: Object.keys(params.map).length,
    albumWithQuote: album.filter(hasPhotoQuote).length,
    album: album.length,
    box: rect ? {
      top: Math.round(rect.top), bottom: Math.round(rect.bottom),
      left: Math.round(rect.left), right: Math.round(rect.right),
      h: Math.round(rect.height),
      cx: Math.round((rect.left + rect.right) / 2),
    } : null,
    vw: window.innerWidth, vh: window.innerHeight,
  };
}

function configurePhotoQuotes(h) {
  if (h && typeof h === 'object') Object.assign(hooks, h);
  pruneEntries();
  syncEditor();
}

/* 启动即用默认值把控件铺好（loadConfig 之后会被保存值覆盖） */
applyStyle();
syncEditor();

export {
  configurePhotoQuotes, photoQuoteOf, photoQuoteText, photoQuoteSource, hasPhotoQuote,
  setPhotoQuote, resetPhotoQuote, dropPhotoQuote, prunePhotoQuotes, autoFillAll,
  showPhotoQuote, hidePhotoQuote, syncPhotoQuoteZoom, photoQuoteReservePx,
  syncPhotoQuoteEditor, photoQuoteDebug, params, PQ_BOTTOM, BASE_RESERVE,
};
