/* ================================================================
 * js/charsplit.js —— 台词「逐字拆分」的唯一口径
 *
 * 现在有三路动画都要把一句话拆成「一个字一个 span」：
 *   · 烟消云散（46）    逐字飘散成烟 / 逐字凝聚
 *   · 翻页打字机（46 尾补）逐字打出 + 光标
 *   · 照片级台词（46 尾补）聚焦时逐字打出
 * 三路的拆法必须一模一样，否则同一个效果下不同句子的折行行为会走岔，
 * 所以只在写在这里一份：
 *   · 空白成一组 → 原样保留成一个文本节点（折行点，与纯文本时代一致）
 *   · 拉丁 / 数字连成一词 → 外面包一层 .gq-w（整词不在词中间断行，词内仍可折）
 *   · 其余一律一字一 span（.gq-c）。带 u 标志时 [\s\S] 匹配的是**一个码点**，
 *     emoji / 生僻字的代理对不会被切成两半 → 中日韩「处处可断行」的行为不变
 *
 * 三条路都依赖的关键性质：拆字**只改「怎么揭开」，不改「占多少地方」** ——
 * 每个字从进场前就在流里占好自己最终的格子，逐字进场 / 散场期间**零重排**。
 * 于是台词块的尺寸在它动起来之前就已经定型：按空白带高度自动收字号（fitFont）
 * 量到的就是停稳后的高度，「台词绝不压照片」照旧构造性成立。
 * ================================================================ */

/* 分词规则（见文件头）：空白一组 / 拉丁数字一词 / 其余一字一组 */
export const Q_TOKEN_RE = /\s+|[0-9A-Za-z][0-9A-Za-z'’.\-_@#%&*/+]*|[\s\S]/gu;

/* 单字 span。那四个随机漂移变量是给「烟消云散」用的（横向左右分家、纵向一律往上 ——
   烟往上升，再带一点旋转与放大；单位 em → 跟着自动收过的字号一起缩放）。
   打字机那两路不读它们，留着也只是四个自定义属性，不参与布局。 */
function charSpan(ch, sink) {
  const c = document.createElement('span');
  c.className = 'gq-c';
  c.textContent = ch;
  c.style.setProperty('--gq-dx', `${((Math.random() * 2 - 1) * 1.0).toFixed(3)}em`);
  c.style.setProperty('--gq-dy', `${(-(0.3 + Math.random() * 0.85)).toFixed(3)}em`);
  c.style.setProperty('--gq-sc', (1.15 + Math.random() * 0.8).toFixed(3));
  c.style.setProperty('--gq-rot', `${((Math.random() * 2 - 1) * 16).toFixed(1)}deg`);
  if (sink) sink.push(c);
  return c;
}

/**
 * 把 str 拆成字符 span 铺进 el（先清空再铺），返回这些 span 的数组。
 * 错峰延迟由调用方各写各的（烟消云散按散场模式轮换、打字机严格按左到右）。
 * @param {HTMLElement} el
 * @param {string} str
 * @returns {HTMLElement[]}
 */
export function appendChars(el, str) {
  const chars = [];
  const frag = document.createDocumentFragment();
  for (const m of String(str == null ? '' : str).matchAll(Q_TOKEN_RE)) {
    const tok = m[0];
    if (/^\s+$/.test(tok)) { frag.appendChild(document.createTextNode(' ')); continue; }
    if (tok.length === 1) { frag.appendChild(charSpan(tok, chars)); continue; }
    const w = document.createElement('span');      // 拉丁 / 数字词整词成组，不在词中间断行
    w.className = 'gq-w';
    for (const ch of tok) w.appendChild(charSpan(ch, chars));
    frag.appendChild(w);
  }
  el.textContent = '';
  el.appendChild(frag);
  return chars;
}

/**
 * 这句话会被拆成多少个字符 span（不含空白）—— 打字机用它定「这一句打多久」，
 * 与 appendChars 的口径完全一致（同一份分词循环），所以 js 的相位秒数与
 * CSS 里逐字延迟的总和永远对得上。
 * @param {string} str
 * @returns {number}
 */
export function spanCount(str) {
  let n = 0;
  for (const m of String(str == null ? '' : str).matchAll(Q_TOKEN_RE)) {
    if (/^\s+$/.test(m[0])) continue;
    for (const _ch of m[0]) n++;   // 数码点，代理对算一个字
  }
  return n;
}

/** 给最后一个字的 span 打个标记：打字机的光标在它身上多闪一会儿再收 */
export function markLastChar(chars) {
  const last = chars && chars.length ? chars[chars.length - 1] : null;
  if (last) last.classList.add('gq-c-last');
  return chars;
}
