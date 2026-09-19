// Смоук-тест чистых модулей (без браузера): node test/smoke.mjs
import { createProceduralHeightmap, FORMS, fbm, makeValueNoise2D, mulberry32 } from '../js/noise.js';
import { normalize01, bilinearUpscale } from '../js/heightmap.js';
import { chaikin, computeContours, polylinesToSVG } from '../js/contours.js';

let failed = 0;
function check(name, cond) {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name);
  if (!cond) failed++;
}

// --- шум ---
const rand = mulberry32(42);
const noise = makeValueNoise2D(rand);
let inRange = true;
for (let i = 0; i < 5000; i++) {
  const n = noise(rand() * 10, rand() * 10);
  if (!(n >= 0 && n <= 1) || Number.isNaN(n)) inRange = false;
}
check('value noise в диапазоне [0..1], без NaN', inRange);

const n1 = fbm(noise, 3.14, 2.71, 6, 2, 0.5);
check('fbm даёт число', Number.isFinite(n1));

// --- процедурные пресеты ---
for (const name of Object.keys(FORMS)) {
  const h = createProceduralHeightmap(128, { seed: 7, scale: 16, octaves: 6, gain: 0.5, form: FORMS[name] });
  let finite = true;
  for (let i = 0; i < h.length; i++) if (!Number.isFinite(h[i])) finite = false;
  const norm = normalize01(h);
  check(`пресет "${name}": 128×128 конечные значения`, finite);
  check(`пресет "${name}": нормализация в [0..1]`, norm[0] >= 0 && norm[0] <= 1 && Math.max(...norm) <= 1);
}

// --- ресемплинг ---
const up = bilinearUpscale([0, 1, 0.5, 1], 2, 2, 64, 64);
check('билинейный апскейл 2×2 → 64×64', up.length === 64 * 64 && Number.isFinite(up[0]));

// --- горизонтали ---
const h = normalize01(createProceduralHeightmap(128, { seed: 5, scale: 18, octaves: 6, gain: 0.5, form: FORMS.mountains }));
const pls = computeContours(h, 128, 12);
check('контуры: ломаные есть', pls.length > 0);
let consistent = true;
for (const { level, points } of pls) {
  if (points.length < 2) consistent = false;
  for (const [x, y] of points) {
    if (x < 0 || x > 127 || y < 0 || y > 127 || !Number.isFinite(x) || !Number.isFinite(y)) consistent = false;
  }
  // все точки ломаной должны лежать на своём уровне ±epsilon
  for (const [x, y] of points) {
    const v = bilinear(h, x, y, 128);
    if (Math.abs(v - level) > 0.06) consistent = false;
  }
}
check('контуры: точки в пределах карты, уровни соблюдены', consistent);

// без сглаживания точки должны лежать точнее — проверка внутренностей:
function bilinear(d, x, y, s) {
  const x0 = Math.min(s - 2, Math.floor(x)), y0 = Math.min(s - 2, Math.floor(y));
  const fx = x - x0, fy = y - y0;
  const a = d[y0 * s + x0], b = d[y0 * s + x0 + 1], c = d[(y0 + 1) * s + x0], e = d[(y0 + 1) * s + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

// --- SVG ---
const svg = polylinesToSVG(pls, 128, 128, (t) => '#123456');
check('SVG: строка с <svg> и путями', svg.startsWith('<svg') && svg.includes('<path') && svg.endsWith('</svg>'));

// --- chaikin ---
const ch = chaikin([[0, 0], [10, 0], [10, 10]], 2);
check('chaikin: точек стало больше, концы на месте', ch.length > 3 && ch[0][0] === 0 && ch[ch.length - 1][1] === 10);

console.log(failed === 0 ? '\nВСЕ ТЕСТЫ ПРОШЛИ' : `\n${failed} ТЕСТОВ ПРОВАЛЕНО`);
process.exit(failed === 0 ? 0 : 1);