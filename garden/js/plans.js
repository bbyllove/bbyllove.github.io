/* ================================================================
 * 方案与备份：
 *   - 配置导出：当前全部设置打包成 JSON 文件下载，便于备份 / 分享
 *   - 配置导入：选择 JSON 文件 → 校验解析 → 写入配置 → 刷新生效
 *   - 多版本保存：把当前设置存为命名方案（最多 8 套，独立于配置存储），
 *     一键应用 / 删除，切换方案不需要重新手动调滑杆
 * ================================================================ */
import { $ } from './dom.js';
import { CONFIG_KEY, saveConfig, currentConfigObject, writeRawConfig } from './config.js';

const PLANS_KEY = 'heart3d-plans-v1';
const PLAN_LIMIT = 8;

/* ---------- 方案存储 ---------- */
function loadPlans() {
  try {
    const list = JSON.parse(localStorage.getItem(PLANS_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function savePlans(list) {
  try {
    localStorage.setItem(PLANS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
// 存储超限兜底：剥离超长字符串（base64 图片），参数类设置保留
function stripLargeStrings(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 200000) obj[k] = '';
    else if (v && typeof v === 'object') stripLargeStrings(v);
  }
}
function setHint(text) {
  const el = $('planHint');
  if (el) el.textContent = text;
}

/* ---------- 方案列表渲染 ---------- */
function formatTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function renderPlanList() {
  const box = $('planList');
  if (!box) return;
  box.textContent = '';
  const list = loadPlans();
  if (!list.length) {
    const empty = document.createElement('p');
    empty.className = 'group-hint';
    empty.textContent = '暂无保存的方案';
    box.appendChild(empty);
    return;
  }
  for (const plan of list) {
    const row = document.createElement('div');
    row.className = 'plan-row';
    const meta = document.createElement('div');
    meta.className = 'plan-meta';
    const name = document.createElement('span');
    name.className = 'plan-name';
    name.textContent = plan.name;
    const time = document.createElement('span');
    time.className = 'plan-time';
    time.textContent = formatTime(plan.time);
    meta.append(name, time);
    const actions = document.createElement('div');
    actions.className = 'plan-actions';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'panel-action-btn plan-btn';
    applyBtn.textContent = '应用';
    applyBtn.dataset.planApply = plan.id;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'panel-action-btn plan-btn';
    delBtn.textContent = '删除';
    delBtn.dataset.planDelete = plan.id;
    actions.append(applyBtn, delBtn);
    row.append(meta, actions);
    box.appendChild(row);
  }
}

/* ---------- 保存当前方案 ---------- */
function saveCurrentPlan() {
  saveConfig(); // 先把最新状态落盘再快照
  const list = loadPlans();
  const nameInput = $('planName');
  let name = ((nameInput && nameInput.value) || '').trim();
  if (!name) name = `方案 ${list.length + 1}`;
  list.unshift({
    id: String(Date.now()),
    name: name.slice(0, 12),
    time: Date.now(),
    data: currentConfigObject(),
  });
  while (list.length > PLAN_LIMIT) list.pop();
  if (!savePlans(list)) {
    for (const p of list) stripLargeStrings(p.data);
    if (!savePlans(list)) {
      setHint('浏览器存储空间不足，方案保存失败');
      return;
    }
    setHint('存储空间紧张：方案已保存，但其中的大图（背景 / 彩蛋图片）被剥离');
  } else {
    setHint('方案已保存，可在下方列表一键应用');
  }
  if (nameInput) nameInput.value = '';
  renderPlanList();
}

/* ---------- 应用 / 删除方案 ---------- */
function applyPlan(id) {
  const plan = loadPlans().find((p) => p.id === id);
  if (!plan || !plan.data) return;
  try {
    writeRawConfig(plan.data);
  } catch {
    setHint('方案写入失败（存储空间不足？）');
    return;
  }
  location.reload();
}
function deletePlan(id) {
  savePlans(loadPlans().filter((p) => p.id !== id));
  renderPlanList();
}

/* ---------- 配置导出 / 导入 ---------- */
function exportConfig() {
  saveConfig();
  const blob = new Blob([JSON.stringify(currentConfigObject(), null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  a.download = `BBYL-3DHeart-config-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  setHint('配置已导出为 JSON 文件');
}
async function handleImportFile(file) {
  if (!file) return;
  let obj = null;
  try {
    obj = JSON.parse(await file.text());
  } catch {
    setHint('解析失败：不是合法的 JSON 配置文件');
    return;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    setHint('导入失败：文件内容不是配置对象');
    return;
  }
  try {
    writeRawConfig(obj);
  } catch {
    setHint('导入失败：写入浏览器存储出错');
    return;
  }
  location.reload();
}

/* ---------- UI 绑定 ---------- */
if ($('configExport')) $('configExport').addEventListener('click', exportConfig);
if ($('configImport')) $('configImport').addEventListener('click', () => $('configImportInput') && $('configImportInput').click());
if ($('configImportInput')) {
  $('configImportInput').addEventListener('change', (e) => {
    handleImportFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });
}
if ($('planSave')) $('planSave').addEventListener('click', saveCurrentPlan);
if ($('planList')) {
  $('planList').addEventListener('click', (e) => {
    const applyBtn = e.target.closest('button[data-plan-apply]');
    if (applyBtn) { applyPlan(applyBtn.dataset.planApply); return; }
    const delBtn = e.target.closest('button[data-plan-delete]');
    if (delBtn) deletePlan(delBtn.dataset.planDelete);
  });
}

renderPlanList();

export { renderPlanList };
