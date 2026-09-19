/* ================================================================
 * 爱心表面贴图：上传图片贴在心形表面（正面平面投影 UV）
 *
 * - 上传后自动压缩（≤1024、JPEG）生成 Texture，赋给 heartMaterial.map，
 *   图片按正面投影「贴」满爱心表面，背面共享镜像投影
 * - 爱心颜色作为色调（与图片相乘）；应用贴图时自动切白色以显示原图色，
 *   期间仍可调颜色当实时色调；清除贴图后恢复上传前颜色
 * - 钻石形状使用独立折射材质，不应用贴图
 * - 贴图随配置保存（压缩后的 dataURL），刷新自动恢复
 * ================================================================ */
import * as THREE from 'three';
import { $ } from './dom.js';
import { heartMaterial } from './heart.js';
import { setHeartColor } from './colors.js';
import { saveConfig, registerConfig } from './config.js';

const MAX_TEX_CHARS = 900000;
let texDataUrl = '';
let texPrevColor = '';   // 首次应用贴图前的颜色，清除时恢复
let texObj = null;
const texLoader = new THREE.TextureLoader();

function applyHeartTexture() {
  if (texObj) { texObj.dispose(); texObj = null; }
  heartMaterial.map = null;
  if (texDataUrl) {
    texObj = texLoader.load(texDataUrl, () => { heartMaterial.needsUpdate = true; });
    texObj.colorSpace = THREE.SRGBColorSpace;
    texObj.anisotropy = 4;
    heartMaterial.map = texObj;
  }
  heartMaterial.needsUpdate = true;
  syncTexUI();
}

function syncTexUI() {
  const name = $('heartTexName');
  if (name) {
    name.textContent = texDataUrl
      ? '已应用：图片已贴在爱心表面（爱心颜色作为色调；钻石形状不使用贴图）'
      : '未选择：爱心显示纯色；上传图片后会贴在爱心表面，颜色作为色调';
  }
  if ($('heartTexClear')) $('heartTexClear').disabled = !texDataUrl;
}

async function compressImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('图片解码失败'));
      i.src = url;
    });
    let dataUrl = '';
    for (const [maxSide, quality] of [[1024, 0.87], [768, 0.82], [512, 0.78]]) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(2, Math.round(img.width * scale));
      const h = Math.max(2, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      dataUrl = c.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= MAX_TEX_CHARS) break;
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- UI 绑定 ---------- */
if ($('heartTexUpload')) {
  $('heartTexUpload').addEventListener('click', () => $('heartTexFile') && $('heartTexFile').click());
}
if ($('heartTexFile')) {
  $('heartTexFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许重复选同一张
    if (!file || !file.type.startsWith('image/')) return;
    const name = $('heartTexName');
    if (name) name.textContent = '正在压缩图片…';
    try {
      const dataUrl = await compressImageFile(file);
      if (!dataUrl) { syncTexUI(); return; }
      if (!texDataUrl) {
        // 记录当前颜色，清除贴图时恢复
        texPrevColor = '#' + heartMaterial.color.getHexString();
        setHeartColor('#ffffff'); // 原色显示贴图
        if ($('heartColor')) $('heartColor').value = '#ffffff';
      }
      texDataUrl = dataUrl;
      applyHeartTexture();
      saveConfig();
    } catch (err) {
      console.warn('爱心贴图处理失败:', err);
      syncTexUI();
    }
  });
}
if ($('heartTexClear')) {
  $('heartTexClear').addEventListener('click', () => {
    texDataUrl = '';
    applyHeartTexture();
    if (texPrevColor) {
      setHeartColor(texPrevColor);
      if ($('heartColor')) $('heartColor').value = texPrevColor;
      texPrevColor = '';
    }
    saveConfig();
  });
}

registerConfig({
  save: () => ({ heartTex: texDataUrl ? { dataUrl: texDataUrl, prevColor: texPrevColor } : null }),
  load: (cfg) => {
    if (cfg.heartTex && typeof cfg.heartTex.dataUrl === 'string' && cfg.heartTex.dataUrl.startsWith('data:')) {
      texPrevColor = typeof cfg.heartTex.prevColor === 'string' ? cfg.heartTex.prevColor : '';
      texDataUrl = cfg.heartTex.dataUrl;
      applyHeartTexture();
    } else {
      syncTexUI();
    }
  },
});

window.__heartTexDebug = {
  has: () => !!texDataUrl,
  prevColor: () => texPrevColor,
  materialHasMap: () => !!heartMaterial.map,
};

export { applyHeartTexture, syncTexUI };
