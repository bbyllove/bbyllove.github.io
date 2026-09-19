/* ================================================================
 * 爱心表面贴图：初始化默认贴图 + 用户上传贴图
 *
 * - 启动读取配置后探测 assets/texture/default.jpg：
 *   - 文件存在 → 直接作为爱心默认表面贴图，并把爱心颜色切白色以显示原图；
 *   - 文件不存在 / 解码失败 → 不改材质，继续使用原有颜色配置；
 * - 上传后自动压缩（≤1024、JPEG）生成 Texture，赋给 heartMaterial.map，
 *   图片按正面投影「贴」满爱心表面，背面共享镜像投影
 * - 自定义贴图优先于默认贴图；「清除贴图」会同时去掉自定义 / 默认贴图，
 *   并恢复项目默认的粉红色 #ff2d55（这个清除选择随配置保存，刷新不会被默认贴图盖回）
 * - 爱心颜色作为色调（与图片相乘）；贴图期间仍可调颜色当实时色调
 * - 钻石形状使用独立折射材质，不应用贴图
 * - 自定义贴图随配置保存（压缩后的 dataURL）；默认贴图文件本身不写入配置，
 *   但「是否已被用户主动清除」会写入配置
 * ================================================================ */
import * as THREE from 'three';
import { $ } from './dom.js';
import { heartMaterial } from './heart.js';
import { setHeartColor, setHeartTextureBaseColor } from './colors.js';
import { saveConfig, registerConfig } from './config.js';

const MAX_TEX_CHARS = 900000;
const DEFAULT_TEXTURE_PATH = 'assets/texture/default.jpg';
const DEFAULT_TEXTURE_URL_KEY = '__HEART_DEFAULT_TEXTURE_URL__';
const DEFAULT_HEART_COLOR = '#ff2d55'; // 与初始材质 / 整体粉色环境一致

let customTexDataUrl = '';
let texPrevColor = '';   // 兼容旧配置：首次应用自定义贴图前的颜色
let defaultTexAvailable = false;
let defaultTexDisabled = false; // 用户点过「清除贴图」：刷新后也不要自动恢复默认贴图
let defaultTextureInitialized = false;
let defaultColorApplied = false;
let defaultTexPrevColor = '';
let texObj = null;
let textureGeneration = 0;
const texLoader = new THREE.TextureLoader();

function defaultTextureUrl() {
  const injected = window[DEFAULT_TEXTURE_URL_KEY];
  return typeof injected === 'string' && injected ? injected : DEFAULT_TEXTURE_PATH;
}

function setHeartColorUI(hex) {
  setHeartColor(hex);
  const input = $('heartColor');
  if (input) input.value = hex;
}
function setHeartTextureBaseUI(hex) {
  setHeartTextureBaseColor(hex);
}

function configureTexture(texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function applyHeartTexture() {
  const generation = ++textureGeneration;
  const source = customTexDataUrl ? 'custom' : (defaultTexAvailable ? 'default' : null);
  const url = source === 'custom'
    ? customTexDataUrl
    : (source === 'default' ? defaultTextureUrl() : '');

  if (texObj) {
    texObj.dispose();
    texObj = null;
  }
  heartMaterial.map = null;

  if (!source || !url) {
    heartMaterial.needsUpdate = true;
    syncTexUI();
    return;
  }

  const texture = configureTexture(texLoader.load(
    url,
    () => {
      // TextureLoader 会异步解码；只有这张仍是当前贴图时才触发材质刷新。
      if (generation === textureGeneration) heartMaterial.needsUpdate = true;
    },
    undefined,
    (err) => {
      texture.dispose();
      if (generation !== textureGeneration) return;
      if (source === 'default') {
        // 探测失败（如 404 / 图片损坏）= 视为默认贴图不存在，回退原颜色配置。
        defaultTexAvailable = false;
        defaultColorApplied = false;
        applyHeartTexture();
        if (defaultTexPrevColor) {
          setHeartColorUI(defaultTexPrevColor);
          defaultTexPrevColor = '';
        }
      } else {
        customTexDataUrl = '';
        applyHeartTexture();
      }
      console.warn('爱心贴图加载失败:', err);
    }
  ));

  texObj = texture;
  heartMaterial.map = texture;

  if (source === 'default' && !defaultColorApplied) {
    defaultTexPrevColor = '#' + heartMaterial.color.getHexString();
    defaultColorApplied = true;
    setHeartTextureBaseColor('#ffffff', DEFAULT_HEART_COLOR); // 图片用白基调，文字保持粉红
  }

  heartMaterial.needsUpdate = true;
  syncTexUI();
}

async function initDefaultHeartTexture() {
  // 已保存的自定义贴图优先；默认贴图只在启动时探测一次。
  if (defaultTextureInitialized || customTexDataUrl || defaultTexDisabled) return;
  defaultTextureInitialized = true;

  // 先用 Image 探测图片是否真的可解码，成功后才切材质/颜色；
  // 文件 404 或损坏时爱心完全保持原有颜色配置，不会出现短暂变白。
  const url = defaultTextureUrl();
  const usable = await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  }).catch(() => false);

  if (!usable || customTexDataUrl) {
    syncTexUI();
    return;
  }
  defaultTexAvailable = true;
  applyHeartTexture();
}

function syncTexUI() {
  const name = $('heartTexName');
  if (name) {
    if (customTexDataUrl) {
      name.textContent = '已应用：自定义图片已贴在爱心表面；点「清除贴图」会去掉所有贴图并恢复默认粉红色';
    } else if (defaultTexAvailable) {
      name.textContent = '已应用：assets/texture/default.jpg；点「清除贴图」会去掉所有贴图并恢复默认粉红色';
    } else if (defaultTexDisabled) {
      name.textContent = '已清除：爱心不使用贴图，按当前颜色配置显示；上传图片会重新应用贴图';
    } else {
      name.textContent = '未应用：爱心显示纯色；上传图片后会贴在爱心表面，颜色作为色调';
    }
  }
  if ($('heartTexClear')) $('heartTexClear').disabled = !(customTexDataUrl || defaultTexAvailable);
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
      if (!customTexDataUrl) {
        // 保留旧配置字段；实际点击「清除贴图」会统一恢复项目默认粉红色。
        texPrevColor = '#' + heartMaterial.color.getHexString();
        setHeartColorUI('#ffffff');
      }
      customTexDataUrl = dataUrl;
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
    // 「清除贴图」= 全部清空：用户上传图和 assets/texture/default.jpg 都不再贴；
    // 恢复项目默认粉红色。清除状态随配置保存，刷新后不会被默认贴图自动盖回。
    customTexDataUrl = '';
    texPrevColor = '';
    defaultTexAvailable = false;
    defaultTexDisabled = true;
    defaultColorApplied = false;
    defaultTexPrevColor = '';
    applyHeartTexture();
    setHeartColorUI(DEFAULT_HEART_COLOR);
    saveConfig();
  });
}

registerConfig({
  save: () => {
    if (customTexDataUrl) {
      return { heartTex: { dataUrl: customTexDataUrl, prevColor: texPrevColor, defaultDisabled: defaultTexDisabled } };
    }
    return { heartTex: defaultTexDisabled ? { defaultDisabled: true } : null };
  },
  load: (cfg) => {
    const tex = cfg && cfg.heartTex;
    if (tex && typeof tex.dataUrl === 'string' && tex.dataUrl.startsWith('data:')) {
      texPrevColor = typeof tex.prevColor === 'string' ? tex.prevColor : '';
      defaultTexDisabled = tex.defaultDisabled === true;
      customTexDataUrl = tex.dataUrl;
      applyHeartTexture();
      return;
    }
    customTexDataUrl = '';
    defaultTexDisabled = !!(tex && tex.defaultDisabled === true);
    if (defaultTexDisabled) applyHeartTexture();
    else syncTexUI();
  },
});

window.__heartTexDebug = {
  hasCustom: () => !!customTexDataUrl,
  hasDefault: () => defaultTexAvailable,
  defaultDisabled: () => defaultTexDisabled,
  prevColor: () => texPrevColor,
  materialHasMap: () => !!heartMaterial.map,
};

export { applyHeartTexture, initDefaultHeartTexture, syncTexUI };
