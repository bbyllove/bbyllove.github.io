/* ================================================================
 * 设置面板开关 / 重置（面板与底部提示、缩放条联动）
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';

const panel = $('panel');
const panelToggle = $('panelToggle');
const setPanelOpen = (open) => {
  panel.classList.toggle('open', open);
  document.body.classList.toggle('panel-open', open);
  panelToggle.setAttribute('aria-label', open ? '收起面板' : '打开设置');
};
panelToggle.addEventListener('click', () =>
  setPanelOpen(!panel.classList.contains('open'))
);
$('panelClose').addEventListener('click', () => setPanelOpen(false));
const panelReset = $('panelReset');
if (panelReset) {
  panelReset.addEventListener('click', () => {
    try {
      localStorage.removeItem('heart3d-config-v1');
      localStorage.removeItem('heart3d-first-hint-shown'); // 重置后重新展示首访引导
    } catch (err) {
      /* 隐私模式等场景下忽略 */
    }
    window.location.reload();
  });
}
// 小屏与触控设备默认收起面板：手机横屏宽度可能超过 720px，但仍属于移动端，
// 不应让右侧设置面板先遮住画面（尤其影响点击四周触发放烟花）。
const isTouchLikeViewport =
  window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
if (window.innerWidth >= 720 && !isTouchLikeViewport) setPanelOpen(true);

/* ---------- 分组折叠（<details>）状态保存 ---------- */
const groupDetails = Array.from(document.querySelectorAll('details.group[data-group]'));
groupDetails.forEach((d) =>
  d.addEventListener('toggle', () => saveConfig())
);

/* ---------- 全部展开 / 全部收起（逐个触发 toggle → 状态自动保存） ---------- */
const setAllGroups = (open) => groupDetails.forEach((d) => { d.open = open; });
if ($('panelExpandAll')) $('panelExpandAll').addEventListener('click', () => setAllGroups(true));
if ($('panelCollapseAll')) $('panelCollapseAll').addEventListener('click', () => setAllGroups(false));
registerConfig({
  save: () => ({
    groups: Object.fromEntries(groupDetails.map((d) => [d.dataset.group, d.open])),
  }),
  load: (cfg) => {
    if (cfg.groups) {
      groupDetails.forEach((d) => {
        const v = cfg.groups[d.dataset.group];
        if (typeof v === 'boolean') d.open = v;
      });
    }
  },
});

export { panel, setPanelOpen };
