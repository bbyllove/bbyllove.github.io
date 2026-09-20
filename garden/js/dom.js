/* DOM 工具：全局 $ 选择器 + 表单焦点判断 */
export const $ = (id) => document.getElementById(id);

/* 焦点正落在表单控件 / 可编辑区域上吗？
   方向键、空格等全局快捷键在这些控件里必须让位给原生行为
   （文本框移光标、下拉换选项、复选框空格勾选、按钮空格触发），
   view.js / gallery.js / shortcuts.js 共用此判断，避免三处各写一套漏掉某种控件。 */
export function isFormTarget(el) {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLButtonElement ||
    !!(el && el.isContentEditable)
  );
}
