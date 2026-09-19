// Шум и процедурный рельеф: детерминированный PRNG + value noise + fbm.

// mulberry32 — компактный детерминированный генератор случайных чисел
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D value noise: пермутированная решётка + fade-интерполяция
export function makeValueNoise2D(rand) {
  const p = new Uint8Array(512);
  const order = [];
  for (let i = 0; i < 256; i++) order.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = order[i];
    order[i] = order[j];
    order[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = order[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function noise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const x0 = xi & 255;
    const y0 = yi & 255;
    const a = p[p[x0] + y0] / 255;
    const b = p[p[x0 + 1] + y0] / 255;
    const c = p[p[x0] + y0 + 1] / 255;
    const d = p[p[x0 + 1] + y0 + 1] / 255;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

// фрактальный шум (fbm): сумма октав
export function fbm(noise, x, y, octaves, lacunarity, gain) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

const smoothstep = (t, a, b) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};

// Формы рельефа: n — базовый шум [0..1], d — нормализованное расстояние от центра
export const FORMS = {
  mountains: (n) => Math.pow(n, 1.15),
  hills: (n) => n,
  island: (n, d) => Math.min(1.6, n * 1.5) * (1 - smoothstep(d, 0.28, 1)),
  canyon: (n) => Math.pow(1 - Math.abs(2 * n - 1), 1.4),
  ridges: (n) => 1 - Math.abs(2 * n - 1),
};

// Процедурная карта высот size×size (значения [0..1] в среднем)
export function createProceduralHeightmap(size, opts) {
  const rand = mulberry32(opts.seed >>> 0);
  const noise = makeValueNoise2D(rand);
  const form = opts.form || ((n) => n);
  const out = new Float32Array(size * size);
  const half = size / 2;
  const maxDist = Math.hypot(half, half) || 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(noise, x / opts.scale, y / opts.scale, opts.octaves, opts.lacunarity || 2, opts.gain || 0.5);
      const d = Math.hypot(x - half, y - half) / maxDist;
      out[y * size + x] = form(n, d);
    }
  }
  return out;
}