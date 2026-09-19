/* ================================================================
 * FPS 帧率显示（31）：开关 + 左上角实时帧率角标
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';

const fpsMeter = document.createElement('div');
fpsMeter.id = 'fpsMeter';
fpsMeter.className = 'fps-meter';
fpsMeter.hidden = true;
document.body.appendChild(fpsMeter);

let fpsEnabled = false;
let acc = 0;       // 累计时间
let frames = 0;    // 累计帧数

// 主循环每帧调用：0.5 秒窗口取平均，避免数字抖动
function fpsTick(dt) {
  if (!fpsEnabled) return;
  acc += dt;
  frames += 1;
  if (acc >= 0.5) {
    fpsMeter.textContent = `${Math.round(frames / acc)} FPS`;
    acc = 0;
    frames = 0;
  }
}

function syncFpsUI() {
  fpsMeter.hidden = !fpsEnabled;
  if ($('fpsEnabled')) $('fpsEnabled').checked = fpsEnabled;
}

if ($('fpsEnabled')) {
  $('fpsEnabled').addEventListener('change', (e) => {
    fpsEnabled = e.target.checked;
    fpsMeter.hidden = !fpsEnabled;
    saveConfig();
  });
}

registerConfig({
  save: () => ({ fps: fpsEnabled }),
  load: (cfg) => {
    if (typeof cfg.fps === 'boolean') fpsEnabled = cfg.fps;
    syncFpsUI();
  },
});

export { fpsTick, syncFpsUI };
