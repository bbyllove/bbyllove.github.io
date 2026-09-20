/* ================================================================
 * js/seedphotos.js —— 内置相册的「资源层」：只读清单，不碰相册数组
 *
 * 只做三件事：
 *   1. 读 assets/gallery/manifest.json（张数与顺序由它决定，因此张数可变）；
 *   2. 过滤掉访客手动删过的内置图（localStorage；seedId = 相对文件名）；
 *   3. 返回 [{ src, name, seedId, version, quote }] 交给 js/gallery.js 建 mesh
 *      （quote = 这张的「照片级台词」，来自 sidecar quotes.txt → manifest，可缺省）。
 *
 * 为什么 seedId 用相对文件名：真图是「同名覆盖」换进来的，文件名就是契约；
 * 改文件名 = 换了一张，旧的删除记录自然失效，符合直觉。
 *
 * 为什么图片 URL 带 ?v=<manifest.version>：version 是全部文件内容的哈希，
 * 同名替换真图后浏览器 / CDN 缓存会因此失效，不会看到旧图。
 *
 * 失败一律优雅降级：manifest 读不到（file:// 双击打开 / 断网 / 404）→ 返回空数组，
 * 页面退回「空相册 + 手动导入」的原行为，不报错、不白屏。
 * ================================================================ */

/* 以「页面」为基准解析，而不是 import.meta.url：二者在本工程里等价（index.html 与
   assets/ 同级），但单文件构建（bun --format=iife，经典脚本）不允许 import.meta，
   留着它会让整包在 file:// 双击时直接语法报错。document.baseURI 两种形态都可用。 */
const MANIFEST_URL = new URL('assets/gallery/manifest.json', document.baseURI);
const IMG_BASE = new URL('assets/gallery/', document.baseURI);
const DELETED_KEY = 'heart3d-seed-deleted-v1';
const MAX_BUILTIN_PHOTOS = 40;   // 内置配额：与相册总上限 MAX_PHOTOS=80 分开，给访客导入留名额

function readDeleted() {
  try {
    const list = JSON.parse(localStorage.getItem(DELETED_KEY));
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function markSeedDeleted(seedId) {
  if (!seedId) return;
  const list = readDeleted();
  if (list.includes(seedId)) return;
  list.push(seedId);
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify(list));
  } catch { /* 隐私模式等场景忽略 */ }
}

export function markSeedDeletedMany(seedIds) {
  const set = new Set(readDeleted());
  let changed = false;
  for (const id of seedIds) {
    if (id && !set.has(id)) { set.add(id); changed = true; }
  }
  if (!changed) return;
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify(Array.from(set)));
  } catch { /* 忽略 */ }
}

export function clearSeedDeleted() {
  try {
    localStorage.removeItem(DELETED_KEY);
  } catch { /* 忽略 */ }
}

export function seedDeletedCount() {
  return readDeleted().length;
}

/**
 * 读取内置相册清单（已按 manifest 顺序、已剔除被删项、已带上缓存版本号）。
 * @returns {Promise<Array<{src: string, name: string, seedId: string, version: string, quote: string}>>}
 */
export async function fetchSeedPhotos() {
  let manifest = null;
  try {
    // no-cache：强制向服务器做一次新鲜度校验，避免「加了图但拿到的还是旧清单」
    const res = await fetch(MANIFEST_URL.href, { cache: 'no-cache' });
    if (!res.ok) {
      console.warn('[内置相册] manifest 请求失败:', res.status);
      return [];
    }
    manifest = await res.json();
  } catch (err) {
    console.warn('[内置相册] manifest 不可用（file://、断网时会这样，功能自动降级）:', err);
    return [];
  }
  const list = manifest && Array.isArray(manifest.photos) ? manifest.photos : [];
  const version = typeof manifest.version === 'string' ? manifest.version : '0';
  const deleted = new Set(readDeleted());
  const out = [];
  for (const item of list) {
    if (!item || typeof item.file !== 'string' || !item.file) continue;
    if (deleted.has(item.file)) continue;
    const url = new URL(item.file, IMG_BASE);
    url.searchParams.set('v', version);
    out.push({
      src: url.href, name: item.name || item.file, seedId: item.file, version,
      quote: typeof item.quote === 'string' ? item.quote : '',   // 照片级台词（可缺省）
    });
    if (out.length >= MAX_BUILTIN_PHOTOS) break;
  }
  return out;
}
