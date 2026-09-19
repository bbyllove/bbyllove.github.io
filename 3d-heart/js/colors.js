/* ================================================================
 * 颜色设置：爱心颜色 / 文字颜色 / 文字颜色跟随爱心·钻石
 * ================================================================ */
import * as THREE from 'three';
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';
import { heartMaterial, heartMaterialStyle, currentShape, diamondParams, onShapeChange } from './heart.js';
import {
  textState, textMaterial, isTextGradientEnabled, onTextGradientChange,
} from './text3d.js';

function setHeartMaterialColor(hex) {
  const color = new THREE.Color(hex);
  heartMaterial.color.copy(color);
  heartMaterial.sheenColor.copy(
    color.clone().lerp(new THREE.Color(0xffffff), 0.55)
  );
  if (heartMaterialStyle === 'neon') heartMaterial.emissive.copy(color);
}

function setHeartColor(hex) {
  // 用户真实调整爱心颜色时，恢复「文字颜色跟随爱心」的正常联动。
  heartMaterial.userData.textureBaseOnly = false;
  setHeartMaterialColor(hex);
  if (textColorLinked && currentShape !== 'diamond') {
    setTextColor(hex);
    const textColorInput = document.getElementById('textColor');
    if (textColorInput) textColorInput.value = hex;
  }
}

/* 默认贴图显示原图时，材质基色需要临时切白；
 * 这只是纹理相乘的技术基色，不应该把上下 3D 文字也带成白色。
 * 因此这里只改爱心材质，不改变文字颜色。 */
function setHeartTextureBaseColor(hex, preferredTextColor) {
  // 记住贴图前的真实主题色；材质上的白色只是显示纹理用的技术基色，
  // 不能把它作为“爱心颜色配置”保存，否则下次文件缺失时会变成白心。
  if (!heartMaterial.userData.textureBaseOnly) {
    heartMaterial.userData.textureBaseSavedColor =
      preferredTextColor || '#' + heartMaterial.color.getHexString();
  }
  heartMaterial.userData.textureBaseOnly = true;
  setHeartMaterialColor(hex);
  const heartColorInput = document.getElementById('heartColor');
  if (heartColorInput) heartColorInput.value = hex;

  // 默认贴图只改爱心材质基色，不改主题文字色；
  // preferredTextColor 缺省时保留用户已保存的文字颜色。
  if (!isTextGradientEnabled()) {
    const textHex = preferredTextColor || textState.color;
    setTextColor(textHex);
    const textColorInput = document.getElementById('textColor');
    if (textColorInput) textColorInput.value = textHex;
  }
}

function setTextColor(hex) {
  textState.color = hex;
  if (isTextGradientEnabled()) return; // 渐变模式：材质颜色由渐变接管
  const color = new THREE.Color(hex);
  textMaterial.color.copy(color);
  textMaterial.emissive.copy(color);
}

// 文字颜色默认跟随爱心 / 钻石颜色，手动改过文字颜色后断开跟随
let textColorLinked = true;
function syncLinkedTextColor() {
  if (isTextGradientEnabled()) return; // 渐变模式：跳过跟随
  if (!textColorLinked) return;
  // 默认贴图的“白色”只是让图片原色正确显示，不是页面主题色；
  // 上下文字继续使用自己的配置色（默认粉红），不被这个技术基色覆盖。
  if (heartMaterial.userData.textureBaseOnly) {
    setTextColor(textState.color);
    const textColorInput = document.getElementById('textColor');
    if (textColorInput) textColorInput.value = textState.color;
    return;
  }
  const hex = currentShape === 'diamond'
    ? diamondParams.color
    : '#' + heartMaterial.color.getHexString();
  setTextColor(hex);
  const textColorInput = document.getElementById('textColor');
  if (textColorInput) textColorInput.value = hex;
}

// 渐变开启时禁用“文字颜色”选择器（颜色由渐变接管）
function syncTextColorDisabled() {
  const textColorInput = document.getElementById('textColor');
  if (textColorInput) textColorInput.disabled = isTextGradientEnabled();
}
onTextGradientChange(() => {
  syncTextColorDisabled();
  if (!isTextGradientEnabled()) {
    // 关闭渐变：恢复跟随色或手动色
    if (textColorLinked) syncLinkedTextColor();
    else setTextColor(textState.color);
  }
});


// 颜色选择器监听
$('heartColor').addEventListener('input', (e) => {
  setHeartColor(e.target.value);
  saveConfig();
});
$('textColor').addEventListener('input', (e) => {
  if (isTextGradientEnabled()) return;
  textColorLinked = false;
  setTextColor(e.target.value);
  saveConfig();
});

// 爱心形状切换时，跟随态的文字颜色同步（经钩子订阅，避免循环依赖）
onShapeChange(() => syncLinkedTextColor());

// 钻石颜色变化时，跟随态的文字颜色同步（监听与 heart 模块独立，避免循环依赖）
if ($('diamondColor')) {
  $('diamondColor').addEventListener('input', () => syncLinkedTextColor());
}
if ($('diamondPresets')) {
  $('diamondPresets').addEventListener('click', (e) => {
    if (e.target.closest('button[data-dcolor]')) syncLinkedTextColor();
  });
}

registerConfig({
  save: () => ({
    heartColor: (heartMaterial.userData.textureBaseOnly && heartMaterial.userData.textureBaseSavedColor)
      ? heartMaterial.userData.textureBaseSavedColor
      : '#' + heartMaterial.color.getHexString(),
    textColor: textState.color,
    textColorLinked: textColorLinked,
  }),
  load: (cfg) => {
    if (cfg.textColor) {
      textState.color = cfg.textColor;
      $('textColor').value = cfg.textColor;
    }
    if (typeof cfg.textColorLinked === 'boolean') {
      textColorLinked = cfg.textColorLinked;
    }
    if (cfg.heartColor) {
      // 配置恢复阶段只把颜色写进爱心材质；文字颜色使用已保存的 textColor，
      // 避免默认贴图留下的“技术性白色基色”在下次加载时把文字再次带白。
      setHeartMaterialColor(cfg.heartColor);
      $('heartColor').value = cfg.heartColor;
    }
    syncTextColorDisabled();
  },
});

export { setHeartColor, setHeartTextureBaseColor, setTextColor, syncLinkedTextColor };
