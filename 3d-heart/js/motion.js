/* ================================================================
 * 运动参数：自动旋转 / 全局动画速度 / 心跳曲线
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';

// 自动旋转 / 动画速度（提前声明，便于配置保存/读取）
const autoRotateParams = { enabled: true, speed: 12 }; // speed 单位：度/秒
const animParams = { speed: 1.0 };                      // 全局动画速度倍率

function heartbeatScale(time) {
  // “怦—怦”双跳：每 1.4s 一个心动周期
  const cycle = (time % 1.4) / 1.4;
  const lub = Math.exp(-Math.pow((cycle - 0.1) * 16, 2));
  const dub = Math.exp(-Math.pow((cycle - 0.3) * 16, 2)) * 0.6;
  return 1 + 0.055 * (lub + dub);
}

/* ---------- UI 同步与事件 ---------- */
function syncMotionUI() {
  if ($('autoRotateEnabled')) $('autoRotateEnabled').checked = !!autoRotateParams.enabled;
  if ($('autoRotateSpeed')) {
    $('autoRotateSpeed').value = String(autoRotateParams.speed);
    $('autoRotateSpeedVal').textContent = Math.round(autoRotateParams.speed) + '°/s';
  }
  if ($('animSpeed')) {
    $('animSpeed').value = String(animParams.speed);
    $('animSpeedVal').textContent = animParams.speed.toFixed(2) + '×';
  }
}
if ($('autoRotateEnabled'))
  $('autoRotateEnabled').addEventListener('change', (e) => {
    autoRotateParams.enabled = e.target.checked;
    saveConfig();
  });
if ($('autoRotateSpeed'))
  $('autoRotateSpeed').addEventListener('input', (e) => {
    autoRotateParams.speed = Number(e.target.value);
    $('autoRotateSpeedVal').textContent = Math.round(autoRotateParams.speed) + '°/s';
    saveConfig();
  });
if ($('animSpeed'))
  $('animSpeed').addEventListener('input', (e) => {
    animParams.speed = Number(e.target.value);
    $('animSpeedVal').textContent = animParams.speed.toFixed(2) + '×';
    saveConfig();
  });

registerConfig({
  save: () => ({ autoRotate: autoRotateParams, animSpeed: animParams.speed }),
  load: (cfg) => {
    if (cfg.autoRotate) {
      if (typeof cfg.autoRotate.enabled === 'boolean') autoRotateParams.enabled = cfg.autoRotate.enabled;
      if (typeof cfg.autoRotate.speed === 'number')
        autoRotateParams.speed = Math.min(60, Math.max(2, cfg.autoRotate.speed));
    }
    if (typeof cfg.animSpeed === 'number')
      animParams.speed = Math.min(2.5, Math.max(0.2, cfg.animSpeed));
  },
});

export { autoRotateParams, animParams, heartbeatScale, syncMotionUI };
