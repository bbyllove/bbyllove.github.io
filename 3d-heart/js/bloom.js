/* ================================================================
 * Bloom 泛光后处理（自研管线：场景 → 亮度提取 → 高斯模糊 → 合成）
 * 为霓虹爱心 / 3D 烟花粒子 / 流星 / 星空 / 文字发光等加柔和辉光；
 * 2D 点击烟花画在独立 DOM 画布层上，不在泛光范围内。
 * 低配设备可关闭泛光开关以节省渲染开销。
 * ================================================================ */
import * as THREE from 'three';
import { $ } from './dom.js';
import { renderer, scene, camera } from './core.js';
import { saveConfig, registerConfig } from './config.js';
import { perfBloomAllowed } from './perf.js';

const bloomParams = { enabled: false, strength: 0.85, threshold: 0.5 };

const POST_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;
const brightMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { tex: { value: null }, threshold: { value: 0.5 } },
  vertexShader: POST_VERT,
  fragmentShader: `
uniform sampler2D tex;
uniform float threshold;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tex, vUv);
  float lum = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  float f = smoothstep(threshold, threshold + 0.4, lum);
  gl_FragColor = vec4(c.rgb * f, c.a);
}
`,
});
const blurMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: {
    tex: { value: null },
    dir: { value: new THREE.Vector2(1, 0) },
    res: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: POST_VERT,
  fragmentShader: `
uniform sampler2D tex;
uniform vec2 dir;
uniform vec2 res;
varying vec2 vUv;
void main() {
  vec2 px = dir / res;
  vec3 sum = texture2D(tex, vUv).rgb * 0.227027;
  sum += (texture2D(tex, vUv + px * 1.0).rgb + texture2D(tex, vUv - px * 1.0).rgb) * 0.1945946;
  sum += (texture2D(tex, vUv + px * 2.0).rgb + texture2D(tex, vUv - px * 2.0).rgb) * 0.1216216;
  sum += (texture2D(tex, vUv + px * 3.0).rgb + texture2D(tex, vUv - px * 3.0).rgb) * 0.054054;
  sum += (texture2D(tex, vUv + px * 4.0).rgb + texture2D(tex, vUv - px * 4.0).rgb) * 0.016216;
  gl_FragColor = vec4(sum, 1.0);
}
`,
});
const compositeMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: {
    sceneTex: { value: null },
    bloomTex: { value: null },
    strength: { value: 0.85 },
  },
  vertexShader: POST_VERT,
  fragmentShader: `
uniform sampler2D sceneTex;
uniform sampler2D bloomTex;
uniform float strength;
varying vec2 vUv;
void main() {
  vec4 base = texture2D(sceneTex, vUv);
  vec3 bloom = texture2D(bloomTex, vUv).rgb;
  gl_FragColor = vec4(base.rgb + bloom * strength, base.a);
}
`,
});
const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postScene = new THREE.Scene();
const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), brightMat);
postQuad.frustumCulled = false;
postScene.add(postQuad);

let rtScene = null, rtBloomA = null, rtBloomB = null;
function bloomSetupTargets() {
  const w = Math.max(2, renderer.domElement.width);
  const h = Math.max(2, renderer.domElement.height);
  if (rtScene) { rtScene.dispose(); rtBloomA.dispose(); rtBloomB.dispose(); }
  rtScene = new THREE.WebGLRenderTarget(w, h);
  const qw = Math.max(2, Math.floor(w / 4));
  const qh = Math.max(2, Math.floor(h / 4));
  rtBloomA = new THREE.WebGLRenderTarget(qw, qh, { depthBuffer: false });
  rtBloomB = new THREE.WebGLRenderTarget(qw, qh, { depthBuffer: false });
}
bloomSetupTargets();
window.addEventListener('heart-perf-change', () => bloomSetupTargets());

function renderMain() {
  if (!bloomParams.enabled || !perfBloomAllowed() || !rtScene) {
    renderer.render(scene, camera);
    return;
  }
  // 1) 场景渲染到离屏目标
  renderer.setRenderTarget(rtScene);
  renderer.render(scene, camera);
  // 2) 亮度提取（1/4 分辨率）
  postQuad.material = brightMat;
  brightMat.uniforms.tex.value = rtScene.texture;
  brightMat.uniforms.threshold.value = bloomParams.threshold;
  renderer.setRenderTarget(rtBloomA);
  renderer.render(postScene, postCam);
  // 3) 两轮可分离高斯模糊（水平/垂直交替，乒乓缓存）
  blurMat.uniforms.res.value.set(rtBloomA.width, rtBloomA.height);
  let src = rtBloomA, dst = rtBloomB;
  for (let i = 0; i < 2; i++) {
    postQuad.material = blurMat;
    blurMat.uniforms.tex.value = src.texture;
    blurMat.uniforms.dir.value.set(1, 0);
    renderer.setRenderTarget(dst);
    renderer.render(postScene, postCam);
    let tmp = src; src = dst; dst = tmp;
    blurMat.uniforms.tex.value = src.texture;
    blurMat.uniforms.dir.value.set(0, 1);
    renderer.setRenderTarget(dst);
    renderer.render(postScene, postCam);
    tmp = src; src = dst; dst = tmp;
  }
  // 4) 合成：原图 + 泛光
  postQuad.material = compositeMat;
  compositeMat.uniforms.sceneTex.value = rtScene.texture;
  compositeMat.uniforms.bloomTex.value = src.texture;
  compositeMat.uniforms.strength.value = bloomParams.strength;
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}


/* ---------- UI 同步与事件 ---------- */
function syncBloomUI() {
  if ($('bloomEnabled')) $('bloomEnabled').checked = !!bloomParams.enabled;
  if ($('bloomStrength')) {
    $('bloomStrength').value = String(bloomParams.strength);
    $('bloomStrengthVal').textContent = bloomParams.strength.toFixed(2);
  }
  if ($('bloomThreshold')) {
    $('bloomThreshold').value = String(bloomParams.threshold);
    $('bloomThresholdVal').textContent = bloomParams.threshold.toFixed(2);
  }
}
if ($('bloomEnabled'))
  $('bloomEnabled').addEventListener('change', (e) => {
    bloomParams.enabled = e.target.checked;
    saveConfig();
  });
if ($('bloomStrength'))
  $('bloomStrength').addEventListener('input', (e) => {
    bloomParams.strength = Number(e.target.value);
    $('bloomStrengthVal').textContent = bloomParams.strength.toFixed(2);
    saveConfig();
  });
if ($('bloomThreshold'))
  $('bloomThreshold').addEventListener('input', (e) => {
    bloomParams.threshold = Number(e.target.value);
    $('bloomThresholdVal').textContent = bloomParams.threshold.toFixed(2);
    saveConfig();
  });

registerConfig({
  save: () => ({ bloom: bloomParams }),
  load: (cfg) => {
    if (cfg.bloom) {
      if (typeof cfg.bloom.enabled === 'boolean') bloomParams.enabled = cfg.bloom.enabled;
      if (typeof cfg.bloom.strength === 'number')
        bloomParams.strength = Math.min(2, Math.max(0, cfg.bloom.strength));
      if (typeof cfg.bloom.threshold === 'number')
        bloomParams.threshold = Math.min(0.95, Math.max(0, cfg.bloom.threshold));
    }
  },
});

export { bloomParams, renderMain, bloomSetupTargets, syncBloomUI };
