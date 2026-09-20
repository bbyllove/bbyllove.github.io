import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);

// 环境反射（让爱心表面有通透的光泽感）
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
pmrem.dispose();
/* ================================================================
 * 灯光
 * ================================================================ */
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(4, 6, 5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.bias = -0.0004;
keyLight.shadow.radius = 6;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xff4d8d, 3.2);
rimLight.position.set(-5, 3, -6);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0xff7ba3, 12, 20);
fillLight.position.set(0, -1.5, 4);
scene.add(fillLight);

scene.add(new THREE.AmbientLight(0x58203a, 1.4));


const clock = new THREE.Clock();

export { canvas, renderer, scene, camera, clock, keyLight };
