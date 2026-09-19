/* ================================================================
 * 预设主题：一键切换形状 / 颜色 / 背景 / 粒子 / 烟花 / 材质 / 字体风格
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig } from './config.js';
import {
  HEART_SHAPES, setHeartShape, applyHeartMaterialStyle,
  diamondParams, applyDiamondMaterial, syncDiamondPresetUI,
} from './heart.js';
import { setHeartColor, setTextColor } from './colors.js';
import { textState, rebuildText } from './text3d.js';
import { bgState, applyBackground, meteorParams, syncMeteorUI, resetMeteorSpawn } from './background.js';
import { PARTICLE_STYLES, applyParticleStyle } from './particles.js';
import { setFxShape } from './fx2d.js';

const THEME_PRESETS = {
  romantic: { name: '浪漫粉', shape: 'plump', material: 'default', heartColor: '#ff2d55', textColor: '#ffe3ec', topFont: 0, bottomFont: 5, bgStyle: 'twilight', bg: { base: '#170818', accent: '#ff3d6e' }, particle: 'petal', fxShape: 'heart', meteor: { density: 6, speed: 60, length: 16, brightness: 1.0 } },
  starry: { name: '星空蓝', shape: 'mc', material: 'glass', heartColor: '#9ed8ff', textColor: '#e6f0ff', topFont: 0, bottomFont: 6, bgStyle: 'star', bg: { base: '#05070f', accent: '#8fb8ff' }, particle: 'snow', fxShape: 'star', meteor: { density: 8, speed: 80, length: 20, brightness: 1.1 } },
  mono: { name: '极简黑白', shape: 'classic', material: 'matte', heartColor: '#ffffff', textColor: '#f2f2f2', topFont: 4, bottomFont: 4, bgStyle: 'twilight', bg: { base: '#0a0a0a', accent: '#777777' }, particle: 'glow', fxShape: 'ring', meteor: { density: 0, speed: 60, length: 16, brightness: 1.0 } },
  birthday: { name: '生日主题', shape: 'gem', material: 'jelly', heartColor: '#ff85a8', textColor: '#ffe3ec', topFont: 8, bottomFont: 6, bgStyle: 'twilight', bg: { base: '#1a0a2a', accent: '#ffb400' }, particle: 'confetti', fxShape: 'confetti', meteor: { density: 10, speed: 70, length: 22, brightness: 1.2 } },
  anniversary: { name: '纪念日', shape: 'diamond', material: 'glass', heartColor: '#ff2d55', textColor: '#ffe3ec', topFont: 2, bottomFont: 5, bgStyle: 'star', bg: { base: '#0a0612', accent: '#ff3d6e' }, particle: 'firefly', fxShape: 'petal', meteor: { density: 6, speed: 60, length: 18, brightness: 1.0 }, diamondColor: '#ff9ec7' },
};

function applyTheme(key) {
  const theme = THEME_PRESETS[key];
  if (!theme) return;

  if (theme.shape && HEART_SHAPES[theme.shape]) setHeartShape(theme.shape);
  if (theme.material) applyHeartMaterialStyle(theme.material);

  if (theme.heartColor) {
    setHeartColor(theme.heartColor);
    const heartColorInput = document.getElementById('heartColor');
    if (heartColorInput) heartColorInput.value = theme.heartColor;
  }
  if (theme.textColor) {
    setTextColor(theme.textColor);
    const textColorInput = document.getElementById('textColor');
    if (textColorInput) textColorInput.value = theme.textColor;
  }
  if (typeof theme.topFont === 'number') {
    textState.top.fontIndex = theme.topFont;
    const topFontSelect = document.getElementById('topFont');
    if (topFontSelect) topFontSelect.value = String(theme.topFont);
    rebuildText('top');
  }
  if (typeof theme.bottomFont === 'number') {
    textState.bottom.fontIndex = theme.bottomFont;
    const bottomFontSelect = document.getElementById('bottomFont');
    if (bottomFontSelect) bottomFontSelect.value = String(theme.bottomFont);
    rebuildText('bottom');
  }

  if (theme.bgStyle === 'twilight' || theme.bgStyle === 'star') {
    bgState.style = theme.bgStyle;
    if (theme.bg) {
      bgState[bgState.style].base = theme.bg.base;
      bgState[bgState.style].accent = theme.bg.accent;
    }
    applyBackground();
  }

  if (theme.particle && PARTICLE_STYLES[theme.particle]) {
    applyParticleStyle(theme.particle);
  }

  if (theme.fxShape) {
    setFxShape(theme.fxShape);
  }

  if (theme.meteor) {
    meteorParams.density = theme.meteor.density;
    meteorParams.speed = theme.meteor.speed;
    meteorParams.length = theme.meteor.length;
    meteorParams.brightness = theme.meteor.brightness;
    if (theme.meteor.density === 0) resetMeteorSpawn();
    syncMeteorUI();
  }

  if (theme.diamondColor && /^#[0-9a-fA-F]{6}$/.test(theme.diamondColor)) {
    diamondParams.color = theme.diamondColor;
    const diamondColorInput = document.getElementById('diamondColor');
    if (diamondColorInput) diamondColorInput.value = theme.diamondColor;
    applyDiamondMaterial();
    syncDiamondPresetUI();
  }

  saveConfig();
}

if ($('themeGrid')) {
  $('themeGrid').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-theme]');
    if (!button) return;
    applyTheme(button.dataset.theme);
  });
}

