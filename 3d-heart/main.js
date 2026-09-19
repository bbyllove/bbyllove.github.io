/* ================================================================
 * main.js —— 入口：初始化序列 + 主渲染循环
 *
 * 模块化拆分后，各功能位于 js/ 目录：
 *   dom.js        $ 选择器
 *   config.js     配置注册表 + save/load（localStorage）
 *   core.js       渲染器 / 场景 / 相机 / 灯光 / 时钟
 *   panel.js      设置面板开关 / 重置
 *   heart.js      爱心几何体 / 材质风格 / 钻石参数 / 形状面板
 *   text3d.js     真 3D 文字管线 / 文字特效 / 文字渐变 / 文字面板
 *   colors.js     爱心颜色 / 文字颜色 / 颜色跟随
 *   background.js 暮光 / 星空 / 自定义图片 / 流星
 *   particles.js  周边粒子 / 天气模式
 *   fx2d.js       2D 点击烟花 / 连点彩蛋
 *   fx3d.js       3D 形状烟花 / 点击判定
 *   themes.js     预设主题
 *   music.js      音乐同步
 *   sfx.js        音效合成（WebAudio）
 *   bloom.js      Bloom 泛光后处理
 *   view.js       轨道视角 / 缩放条
 *   motion.js     自动旋转 / 动画速度 / 心跳曲线
 *   export.js     导出 PNG / WebM
 *   fps.js        FPS 帧率显示
 *   perf.js       性能画质三档 + 低帧率建议（11/44）
 *   shortcuts.js  键盘快捷键（空格/R/H）
 * ================================================================ */
import { $ } from './js/dom.js';
import { playIntro } from './js/intro.js';   // 开场闪屏（51）
import { scene, camera, renderer, clock } from './js/core.js';
import { loadConfig } from './js/config.js';
import './js/panel.js';
import {
  heartGroup, heartMaterialStyle, applyHeartMaterialStyle,
  syncRoundnessUI, syncDiamondUI,
} from './js/heart.js';
import {
  textState, rebuildText, bindTextControls, applyTextOutline,
  syncTextEffectUI, syncTextGradientUI, updateTextAnimation,
} from './js/text3d.js';
import { setTextColor, syncLinkedTextColor } from './js/colors.js';
import { initDefaultHeartTexture } from './js/hearttex.js'; // 爱心表面贴图（45 + 默认贴图）

/* ---------- 开场闪屏（51）：先于一切 UI 露面播；返回的 Promise 供首访引导排队 ---------- */
const introDone = playIntro();
import { isGalleryOpen } from './js/gallery.js'; // 相册陈列室
import { applyBackground, syncMeteorUI, syncBgImageUI, updateMeteors, updateStarfield } from './js/background.js';
import {
  applyParticleStyle, syncParticleUI, getAmbientParticleStyle,
  updateParticles, syncWeatherUI,
} from './js/particles.js';
import { fxShape, syncFxUI } from './js/fx2d.js';
import { updateFireworks3D } from './js/fx3d.js';
import './js/themes.js';
import { musicPlaying, musicEnergy, musicBeat, updateMusicSync, syncMusicUI } from './js/music.js';
import './js/export.js';
import { soundParams, sfxHeartbeat, syncSoundUI } from './js/sfx.js';
import { bloomSetupTargets, renderMain, syncBloomUI } from './js/bloom.js';
import {
  view, pressedKeys, activePointers, clamp,
  KEY_ROTATE_SPEED, MIN_PHI, MAX_PHI,
  zoomSlider, zoomLabel, DEFAULT_RADIUS, radiusToSlider,
} from './js/view.js';
import { autoRotateParams, animParams, heartbeatScale, syncMotionUI } from './js/motion.js';
import { fpsTick, syncFpsUI } from './js/fps.js';
import { perfTick } from './js/perf.js';
import { syncEasterUI, easterSpin, easterPulse } from './js/easter.js';
import { demoTick, syncDemoUI } from './js/demo.js'; // 演示模式（39）
import './js/plans.js'; // 方案与备份（导入 / 导出 / 多版本保存）
import './js/shortcuts.js';

/* ================================================================
 * 初始化：读取配置 → 应用到场景与面板
 * ================================================================ */
loadConfig();
initDefaultHeartTexture(); // 探测 assets/texture/default.jpg；缺失时保持原颜色配置
setTextColor(textState.color);
syncLinkedTextColor();
bindTextControls('top', textState.top, 'top');
bindTextControls('bottom', textState.bottom, 'bottom');
rebuildText('top');
rebuildText('bottom');
syncRoundnessUI();
syncDiamondUI();
applyBackground();
syncMeteorUI();
syncBgImageUI();
syncParticleUI();
syncTextEffectUI();
syncTextGradientUI();
syncEasterUI();
syncMusicUI();
applyTextOutline();
applyHeartMaterialStyle(heartMaterialStyle);
if ($('fxShapeGrid')) {
  document.querySelectorAll('#fxShapeGrid button').forEach((b) =>
    b.classList.toggle('active', b.dataset.fxshape === fxShape)
  );
}
applyParticleStyle(getAmbientParticleStyle());
syncFxUI();
syncMotionUI();
syncDemoUI();
syncWeatherUI();
syncFpsUI();
syncBloomUI();
syncSoundUI();

/* ================================================================
 * 主渲染循环
 * ================================================================ */
let animPhase = 0;   // 全局动画相位（按动画速度累加，供浮动/轻摆/粒子使用）
let heartPhase = 0;  // 心跳相位（按动画速度累加）

function animate() {
  requestAnimationFrame(animate);
  if (document.body.classList.contains('intro-playing')) return; // 开场闪屏（51）：幕布不透明盖着整屏，主场景先歇着，把主线程预算让给倒计时
  if (isGalleryOpen()) return; // 相册陈列室打开时主场景暂停
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  fpsTick(dt);
  perfTick(dt);

  /* --- 方向键持续旋转 --- */
  if (pressedKeys.has('ArrowLeft')) view.thetaTarget -= KEY_ROTATE_SPEED * dt;
  if (pressedKeys.has('ArrowRight')) view.thetaTarget += KEY_ROTATE_SPEED * dt;
  if (pressedKeys.has('ArrowUp'))
    view.phiTarget = clamp(view.phiTarget - KEY_ROTATE_SPEED * 0.8 * dt, MIN_PHI, MAX_PHI);
  if (pressedKeys.has('ArrowDown'))
    view.phiTarget = clamp(view.phiTarget + KEY_ROTATE_SPEED * 0.8 * dt, MIN_PHI, MAX_PHI);

  /* --- 自动旋转（手动拖拽时暂停） --- */
  if (autoRotateParams.enabled && activePointers.size === 0) {
    view.thetaTarget += (autoRotateParams.speed * Math.PI / 180) * dt;
  }

  /* --- 演示模式：idle 进入 / 环绕 / 自动烟花彩蛋 --- */
  demoTick(dt, performance.now());

  /* --- 平滑阻尼 --- */
  const damp = 1 - Math.exp(-8 * dt);
  view.theta += (view.thetaTarget - view.theta) * damp;
  view.phi += (view.phiTarget - view.phi) * damp;
  view.radius += (view.radiusTarget - view.radius) * damp;

  /* --- 球坐标 -> 相机位置 --- */
  camera.position.set(
    view.radius * Math.sin(view.phi) * Math.sin(view.theta),
    view.radius * Math.cos(view.phi),
    view.radius * Math.sin(view.phi) * Math.cos(view.theta)
  );
  camera.lookAt(0, 0.05, 0);

  /* --- 缩放控制条同步 --- */
  const sliderPos = radiusToSlider(view.radiusTarget);
  if (Math.abs(Number(zoomSlider.value) - sliderPos) > 0.002) {
    zoomSlider.value = sliderPos;
  }
  const zoomPct = Math.round((DEFAULT_RADIUS / view.radius) * 100) + '%';
  if (zoomLabel.textContent !== zoomPct) zoomLabel.textContent = zoomPct;

  /* --- 音乐节奏同步 --- */
  updateMusicSync(t, dt);
  const musicPulse = musicEnergy * 0.12 + musicBeat * 0.14;

  /* --- 全局动画速度：相位累加，滑杆变速时不会跳变 --- */
  const aspeed = animParams.speed;
  animPhase += dt * aspeed;
  const prevHeartPhase = heartPhase;
  heartPhase += dt * aspeed;

  /* --- 心跳 / 浮动 / 轻摆（文字随 heartGroup 一起运动） --- */
  heartGroup.scale.setScalar(heartbeatScale(heartPhase) * (1 + musicPulse + easterPulse(performance.now())));
  heartGroup.position.y = Math.sin(animPhase * 0.9) * 0.08;
  heartGroup.rotation.y = Math.sin(animPhase * 0.3) * 0.22 + easterSpin(performance.now());

  /* --- 心跳声：检测心跳相位穿过「怦(0.1)」与「怦(0.3)」 --- */
  if (soundParams.enabled && soundParams.heartbeat) {
    const cyc = (p) => (((p % 1.4) + 1.4) % 1.4) / 1.4;
    const pf = cyc(prevHeartPhase), nf = cyc(heartPhase);
    const crossed = (mark) =>
      pf <= nf ? (pf < mark && nf >= mark) : (pf < mark || nf >= mark);
    if (crossed(0.1)) sfxHeartbeat(true);
    if (crossed(0.3)) sfxHeartbeat(false);
  }

  /* --- 文字特效：浮动 + 入场动画 --- */
  updateTextAnimation(animPhase);

  /* --- 粒子漂浮 / 天气模式定向飘落（音乐节奏强时略快、略亮） --- */
  updateParticles(t, dt, aspeed, animPhase, musicEnergy, musicBeat, musicPlaying);

  /* --- 星空闪烁 / 缓慢旋转 --- */
  updateStarfield(t);

  updateMeteors(dt * aspeed);
  updateFireworks3D(dt);

  renderMain();
}

animate();

/* ================================================================
 * 自适应窗口
 * ================================================================ */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  bloomSetupTargets();
});

/* ================================================================
 * 运行时信号：标记主脚本已成功加载并执行完毕
 * （index.html 中的内联脚本据此判断 main.js 是否真正运行；
 *  通过 file:// 打开或脚本加载/执行失败时此行不会执行，
 *  页面会弹出可操作的修复指引，避免「控制项静默失效」。）
 * ================================================================ */
window.__mainLoaded = true;

/* ---------- 首次打开引导提示（localStorage 标记，只显示一次） ---------- */
(function initFirstHint() {
  const KEY = 'heart3d-first-hint-shown';
  let shown = true;
  try { shown = !!localStorage.getItem(KEY); } catch { shown = true; }
  const el = $('firstHint');
  if (!el || shown) return;
  introDone.then(() => setTimeout(() => {   // 排在开场闪屏之后，否则首访提示会被闪屏盖住
    el.hidden = false;
    try { localStorage.setItem(KEY, '1'); } catch { /* 隐私模式忽略 */ }
    const dismiss = () => {
      window.removeEventListener('click', dismiss);
      el.classList.add('bye');
      setTimeout(() => { el.hidden = true; el.classList.remove('bye'); }, 600);
    };
    setTimeout(dismiss, 4200); // 几秒后自动淡出
    window.addEventListener('click', dismiss); // 任意点击即视为“已发现”
  }, 1200)); // 等页面稳定后再淡入
})();
