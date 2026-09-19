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

function setHeartColor(hex) {
  const color = new THREE.Color(hex);
  heartMaterial.color.copy(color);
  heartMaterial.sheenColor.copy(
    color.clone().lerp(new THREE.Color(0xffffff), 0.55)
  );
  if (heartMaterialStyle === 'neon') heartMaterial.emissive.copy(color);
  if (textColorLinked && currentShape !== 'diamond') {
    setTextColor(hex);
    const textColorInput = document.getElementById('textColor');
    if (textColorInput) textColorInput.value = hex;
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
    heartColor: '#' + heartMaterial.color.getHexString(),
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
      setHeartColor(cfg.heartColor);
      $('heartColor').value = cfg.heartColor;
    }
    syncTextColorDisabled();
  },
});

export { setHeartColor, setTextColor, syncLinkedTextColor };
