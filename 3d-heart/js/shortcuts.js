/* ================================================================
 * 键盘快捷键（30）：空格 = 音乐播放/停止，R = 复位视角，H = 隐藏 UI
 * 输入框 / 按钮聚焦时不劫持，避免破坏表单交互
 * ================================================================ */
import { toggleMusic } from './music.js';
import { isFormTarget } from './dom.js';
import { resetView } from './view.js';

window.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('gallery-open')) return; // 相册模式由 gallery.js 处理按键
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if (isFormTarget(e.target)) return;
  switch (e.key) {
    case ' ': // 音乐播放 / 停止
      e.preventDefault();
      toggleMusic();
      break;
    case 'r':
    case 'R': // 复位视角
      resetView();
      break;
    case 'h':
    case 'H': // 纯净模式：隐藏 / 显示全部 UI
      document.body.classList.toggle('zen-mode');
      break;
  }
});
