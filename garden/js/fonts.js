/* ================================================================
 * 字体表：全站共用的「可选字体」清单
 *
 * 主场景三维文字（text3d.js）与相册陈列室台词轮播（galleryquotes.js）
 * 共用同一份列表，保证两处下拉框的字体名称 / 顺序一致。
 * stack 为 CSS font-family 栈：既用于 Canvas 绘制文字轮廓，
 * 也直接用于 DOM 台词的 font-family。
 * ================================================================ */
const FONT_LIST = [
  { name: '默认圆润', stack: `ui-rounded, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif` },
  { name: '苹方 / 雅黑', stack: `'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif` },
  { name: '楷体', stack: `'Kaiti SC', 'STKaiti', 'KaiTi', 'BiauKai', serif` },
  { name: '宋体', stack: `'Songti SC', 'STSong', 'SimSun', serif` },
  { name: '黑体', stack: `'Heiti SC', 'SimHei', 'PingFang SC', sans-serif` },
  { name: 'Georgia 衬线', stack: `Georgia, 'Times New Roman', 'Songti SC', serif` },
  { name: 'Impact 粗体', stack: `Impact, 'Arial Black', 'PingFang SC', sans-serif` },
  { name: '手写花体', stack: `'Brush Script MT', 'Segoe Script', 'Savoye LET', cursive` },
  { name: '卡通', stack: `'Comic Sans MS', 'Chalkboard SE', 'Yuanti SC', cursive` },
  { name: '等宽 Courier', stack: `'Courier New', Courier, monospace` },
];

export { FONT_LIST };
