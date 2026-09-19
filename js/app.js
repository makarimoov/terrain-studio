// Terrain Studio — главный модуль: Three.js 3D-сцена + UI.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createProceduralHeightmap, FORMS } from './noise.js';
import {
  normalize01,
  bilinearUpscale,
  parseHeightmapPixels,
  heightmapToCanvas,
  downloadBlob,
  fetchElevationGrid,
} from './heightmap.js';
import { computeContours, polylinesToSVG } from './contours.js';
import { createAreaPicker } from './map.js';

/* ---------- палитры ---------- */
const COLORMAPS = {
  earth: ['#0e3b2c', '#2e6b45', '#57a04b', '#9db94e', '#dfc979', '#a9824f', '#f4eee0'],
  depth: ['#041b33', '#0a3d66', '#12699e', '#2f9bcf', '#9fd9ec'],
  fire: ['#170404', '#51100f', '#a32117', '#e3591f', '#ffb02e', '#ffe9a8'],
  mono: ['#0d0d0d', '#3c3c3c', '#6e6e6e', '#a4a4a4', '#dcdcdc', '#ffffff'],
};

// Цвет палитры в точке t∈[0..1]
function rampColor(stops, t) {
  t = Math.min(1, Math.max(0, t));
  const seg = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  const f = seg - i;
  return new THREE.Color(stops[i]).lerp(new THREE.Color(stops[i + 1]), f);
}
const rampCss = (stops, t) => '#' + rampColor(stops, t).getHexString();

/* ---------- состояние ---------- */
const state = {
  source: 'proc',
  size: 128,
  seed: 42,
  preset: 'mountains',
  scale: 16,
  octaves: 6,
  gain: 0.5,
  map: 'earth',
  exc: 1.6,
  wire: false,
  rot: true,
  contours: false,
  contourLevels: 12,
};

let sourceData = null; // сырые данные текущего источника (не нормализованные)
let sourceSize = 0;
let sourceMeta = null; // { planeUnits } для метрического режима координат
let sourceLabel = '';
let uploadName = '';
let coordsLabel = '';
let currentH = null; // нормализованная карта высот размером state.size
let lastSvg = '';
let mesh = null;
let toastTimer = null;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const stageEl = $('stage');
const view3dEl = $('view3d');
const toastEl = $('toast');
const dropzoneEl = $('dropzone');
const contourBox = $('contourBox');

/* ---------- Three.js ---------- */
let renderer = null;
let scene = null;
let camera = null;
let controls = null;

function initScene() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch (e) {
    view3dEl.innerHTML = '<div class="webgl-fallback">WebGL недоступен в этом браузере.<br>Откройте страницу в Chrome, Firefox или Safari.</div>';
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(stageEl.clientWidth, stageEl.clientHeight);
  view3dEl.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  camera = new THREE.PerspectiveCamera(50, stageEl.clientWidth / stageEl.clientHeight, 0.1, 10000);
  camera.position.set(120, 120, 120);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = state.rot;
  controls.autoRotateSpeed = 1.4;

  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x2a2f3a, 1.15));
  const sun = new THREE.DirectionalLight(0xffffff, 2.0);
  sun.position.set(-140, 220, -100);
  scene.add(sun);

  window.addEventListener('resize', onResize);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
  return true;
}

function onResize() {
  if (!renderer) return;
  const w = stageEl.clientWidth;
  const h = stageEl.clientHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function frameCamera(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const sp = box.getBoundingSphere(new THREE.Sphere());
  const r = sp.radius * 2.0;
  const az = 0.85;
  const el = 0.6;
  camera.position.set(
    sp.center.x + Math.cos(az) * Math.cos(el) * r,
    sp.center.y * 0.15 + Math.sin(el) * r,
    sp.center.z + Math.sin(az) * Math.cos(el) * r
  );
  controls.target.copy(sp.center);
  controls.update();
  scene.fog = new THREE.Fog(0x0b1220, r * 1.4, r * 3.2);
}

/* ---------- построение меша ---------- */
// heights — фактические значения Y (уже с учётом усиления),
// h — нормализованная карта высот [0..1] для цвета, planeUnits — ширина сцены в юнитах.
function buildMesh3D(heights, h, planeUnits) {
  const size = state.size;
  const geo = new THREE.PlaneGeometry(planeUnits, planeUnits, size - 1, size - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const stops = COLORMAPS[state.map];
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, heights[i]);
    const c = rampColor(stops, h[i]);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    wireframe: state.wire,
    roughness: 0.9,
    metalness: 0.02,
    side: THREE.DoubleSide,
  });

  if (mesh) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  frameCamera(mesh);
}

/* ---------- рендер контуров ---------- */
function renderContours() {
  if (!currentH) return;
  const pls = computeContours(currentH, state.size, state.contourLevels);
  lastSvg = polylinesToSVG(pls, state.size, state.size, (t) => rampCss(COLORMAPS[state.map], t));
  contourBox.innerHTML = lastSvg;
}

/* ---------- пересборка всего ---------- */
function rebuild() {
  let data;
  let size;

  if (state.source === 'proc') {
    data = createProceduralHeightmap(state.size, {
      seed: state.seed,
      scale: state.scale,
      octaves: state.octaves,
      gain: state.gain,
      form: FORMS[state.preset],
    });
    size = state.size;
    sourceLabel = `Процедурный рельеф · сид ${state.seed} · ${state.preset}`;
  } else if (sourceData) {
    data = sourceData;
    size = sourceSize;
    sourceLabel = state.source === 'upload' ? `Heightmap: ${uploadName || 'PNG'}` : `SRTM ${coordsLabel}`;
  } else {
    data = createProceduralHeightmap(state.size, { seed: state.seed, scale: state.scale, octaves: state.octaves, gain: state.gain, form: FORMS.mountains });
    size = state.size;
  }

  let raw = size === state.size ? data : bilinearUpscale(data, size, size, state.size, state.size);
  let h = normalize01(raw);
  currentH = h;

  // Геометрия: относительный режим (процедурный/файл) или реальные метры (координаты)
  const n = raw.length;
  const heights = new Float32Array(n);
  let planeUnits = state.size;
  if (state.source === 'coords' && sourceMeta && sourceMeta.planeUnits) {
    let minR = Infinity;
    for (let i = 0; i < n; i++) if (raw[i] < minR) minR = raw[i];
    for (let i = 0; i < n; i++) heights[i] = (raw[i] - minR) * state.exc;
    planeUnits = sourceMeta.planeUnits;
  } else {
    const amp = state.exc * state.size * 0.09;
    for (let i = 0; i < n; i++) heights[i] = h[i] * amp;
  }

  buildMesh3D(heights, h, planeUnits);
  $('sourceInfo').textContent = sourceLabel;
  if (state.contours) renderContours();
}

/* ---------- тосты ---------- */
function toast(msg, ok = true) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.classList.toggle('err', !ok);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 3500);
}

/* ---------- табы источника ---------- */
function setTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tabpage').forEach((p) => (p.hidden = p.id !== 'tab-' + name));
}
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.source = btn.dataset.tab;
    setTab(state.source);
    if (state.source === 'coords') ensureAreaPicker();
    rebuild();
  });
});

/* ---------- процедурный источник ---------- */
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === chip));
    state.preset = chip.dataset.preset;
    rebuild();
  });
});

$('randomSeed').addEventListener('click', () => {
  state.seed = Math.floor(Math.random() * 1000000);
  $('seed').value = state.seed;
  rebuild();
});
$('seed').addEventListener('change', () => {
  state.seed = Math.max(0, parseInt($('seed').value, 10) || 0);
  $('seed').value = state.seed;
  rebuild();
});

/* ---------- слайдеры ---------- */
let ready = false;
function bindRange(id, key, onChange) {
  const el = $(id);
  const out = el.parentElement.querySelector('output');
  const apply = () => {
    state[key] = parseFloat(el.value);
    out.value = el.value;
    if (ready && onChange) onChange();
  };
  el.addEventListener('input', apply);
  apply();
}
bindRange('rangeScale', 'scale', rebuild);
bindRange('rangeOct', 'octaves', rebuild);
bindRange('rangeGain', 'gain', rebuild);
bindRange('rangeExc', 'exc', rebuild);
bindRange('rangeContour', 'contourLevels', () => {
  if (state.contours) renderContours();
});

/* ---------- вид ---------- */
$('selectMap').addEventListener('change', () => {
  state.map = $('selectMap').value;
  rebuild();
});
$('chkWire').addEventListener('change', () => {
  state.wire = $('chkWire').checked;
  if (mesh) mesh.material.wireframe = state.wire;
});
$('chkRot').addEventListener('change', () => {
  state.rot = $('chkRot').checked;
  controls.autoRotate = state.rot;
});
$('chkContour').addEventListener('change', () => {
  state.contours = $('chkContour').checked;
  contourBox.classList.toggle('open', state.contours);
  if (state.contours) renderContours();
});

/* ---------- загрузка файла ---------- */
function handleFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('Нужен PNG или JPEG', false);
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    sourceData = parseHeightmapPixels(img, state.size);
    sourceSize = state.size;
    uploadName = file.name;
    state.source = 'upload';
    setTab('upload');
    rebuild();
    toast('Heightmap загружен: ' + file.name);
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    toast('Не удалось прочитать изображение', false);
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

$('fileInput').addEventListener('change', (e) => {
  handleFile(e.target.files[0]);
  e.target.value = '';
});

let dragDepth = 0;
stageEl.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  dropzoneEl.hidden = false;
});
stageEl.addEventListener('dragover', (e) => e.preventDefault());
stageEl.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzoneEl.hidden = true;
});
stageEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropzoneEl.hidden = true;
  handleFile(e.dataTransfer.files[0]);
});

/* ---------- координаты (SRTM) ---------- */
let areaPicker = null;
function ensureAreaPicker() {
  if (!areaPicker) areaPicker = createAreaPicker({ latEl: $('coordLat'), lonEl: $('coordLon'), spanEl: $('coordSpan') });
  else areaPicker.invalidate();
}
$('btnCoords').addEventListener('click', async () => {
  const lat = parseFloat($('coordLat').value);
  const lon = parseFloat($('coordLon').value);
  const pts = Math.min(24, Math.max(8, parseInt($('coordPts').value, 10) || 16));
  const span = parseFloat($('coordSpan').value);
  if (!isFinite(lat) || !isFinite(lon)) {
    toast('Введите корректные координаты', false);
    return;
  }
  const btn = $('btnCoords');
  btn.disabled = true;
  btn.textContent = 'Загрузка…';
  try {
    const grid = await fetchElevationGrid(lat, lon, pts, span);
    sourceData = grid;
    sourceSize = pts;
    // реальный масштаб: 1 юнит сцены = 1 метр
    const latM = span * 111320;
    const lonM = span * 111320 * Math.cos((lat * Math.PI) / 180);
    sourceMeta = { planeUnits: (latM + lonM) / 2 };
    coordsLabel = `${lat.toFixed(4)}, ${lon.toFixed(4)} · ${pts}×${pts} точек`;
    state.source = 'coords';
    setTab('coords');
    rebuild();
    toast('Рельеф SRTM загружен');
  } catch (e) {
    toast('Ошибка загрузки: ' + e.message, false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Загрузить рельеф SRTM';
  }
});

/* ---------- экспорт ---------- */
$('btnShot').addEventListener('click', () => {
  if (!renderer) return;
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = 'terrain-3d.png';
  a.click();
});

$('btnPng').addEventListener('click', () => {
  if (!currentH) return;
  const cvs = heightmapToCanvas(currentH, state.size);
  cvs.toBlob((b) => downloadBlob(b, 'heightmap.png'), 'image/png');
});

$('btnSvg').addEventListener('click', () => {
  if (!currentH) return;
  if (!state.contours) renderContours();
  downloadBlob(new Blob([lastSvg], { type: 'image/svg+xml' }), 'contours.svg');
});

/* ---------- старт ---------- */
if (initScene()) {
  ready = true;
  setTab('proc');
  rebuild();
}