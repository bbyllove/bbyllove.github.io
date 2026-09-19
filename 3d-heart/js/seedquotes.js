/* ================================================================
 * js/seedquotes.js —— 内置台词包 assets/quotes/default.txt 的读取层
 *
 * txt 一行一句、空行忽略（解析复用 js/galleryquotes.js 的 parseLines，
 * 这里只负责把原文取回来）。用 txt 而不是 JS 数组的理由：
 *   · 台词里的引号 / emoji / 反斜杠零转义，改文案不用碰代码；
 *   · 在 GitHub 网页端直接编辑 + 提交即可生效（Pages 重建后所有访客
 *     下一帧就是新句），且永不覆盖访客在文本框里自己写的句子
 *     （两层合并的语义见 js/galleryquotes.js）。
 *
 * 失败降级：fetch 失败（file:// 双击打开 / 断网 / 404）→ { ok:false }，
 * galleryquotes 会回退到代码里的 DEFAULT_TEXT 那四条。
 * ================================================================ */

const PACK_URL = new URL('assets/quotes/default.txt', document.baseURI);  // 见 seedphotos.js 注释：iife 经典脚本不容 import.meta

/**
 * @returns {Promise<{ok: boolean, text: string}>}
 */
export async function fetchQuotePack() {
  try {
    const res = await fetch(PACK_URL.href, { cache: 'no-cache' });
    if (!res.ok) {
      console.warn('[台词包] 请求失败:', res.status);
      return { ok: false, text: '' };
    }
    return { ok: true, text: await res.text() };
  } catch (err) {
    console.warn('[台词包] 不可用（file://、断网时会这样，回退内置默认句）:', err);
    return { ok: false, text: '' };
  }
}
