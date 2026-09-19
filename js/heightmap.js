// Работа с картами высот: нормализация, ресемплинг, парсинг PNG, экспорт, SRTM.

// Привести данные к диапазону [0..1]
export function normalize01(data) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = (data[i] - min) / range;
  return out;
}

// Билинейное увеличение (или уменьшение) сетки
export function bilinearUpscale(src, sw, sh, tw, th) {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    const gy = ((y + 0.5) * sh) / th - 0.5;
    const y0 = Math.max(0, Math.floor(gy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = gy - y0;
    for (let x = 0; x < tw; x++) {
      const gx = ((x + 0.5) * sw) / tw - 0.5;
      const x0 = Math.max(0, Math.floor(gx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = gx - x0;
      const a = src[y0 * sw + x0];
      const b = src[y0 * sw + x1];
      const c = src[y1 * sw + x0];
      const d = src[y1 * sw + x1];
      out[y * tw + x] =
        (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    }
  }
  return out;
}

// Превратить загруженное изображение в карту высот size×size (яркость = высота)
export function parseHeightmapPixels(img, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const id = ctx.getImageData(0, 0, size, size);
  const out = new Float32Array(size * size);
  for (let i = 0, p = 0; i < id.data.length; i += 4, p++) {
    out[p] = (0.299 * id.data[i] + 0.587 * id.data[i + 1] + 0.114 * id.data[i + 2]) / 255;
  }
  return out;
}

// Карта высот [0..1] → canvas с градациями серого (для экспорта PNG)
export function heightmapToCanvas(data, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0, p = 0; i < img.data.length; i += 4, p++) {
    const g = Math.round(Math.min(1, Math.max(0, data[p])) * 255);
    img.data[i] = g;
    img.data[i + 1] = g;
    img.data[i + 2] = g;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Сетка высот по координатам через бесплатный API Open-Meteo Elevation
// (данные SRTM, ~90 м на точку). Нативный CORS, до 100 точек на запрос.
const ELEVATION_API = 'https://api.open-meteo.com/v1/elevation';

async function fetchElevations(points) {
  const lat = points.map((p) => p[0]).join(',');
  const lon = points.map((p) => p[1]).join(',');
  const url = `${ELEVATION_API}?latitude=${lat}&longitude=${lon}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  if (!Array.isArray(json.elevation)) throw new Error(json.reason || 'нет данных');
  return json.elevation;
}

export async function fetchElevationGrid(centerLat, centerLon, points, spanDeg) {
  const pts = [];
  for (let j = 0; j < points; j++) {
    const lat = centerLat + ((j / (points - 1)) - 0.5) * spanDeg;
    for (let i = 0; i < points; i++) {
      const lon = centerLon + ((i / (points - 1)) - 0.5) * spanDeg;
      pts.push([lat, lon]);
    }
  }
  const data = new Float32Array(points * points);
  const CHUNK = 100; // лимит API на один запрос
  for (let c = 0; c < pts.length; c += CHUNK) {
    const part = pts.slice(c, c + CHUNK);
    const elev = await fetchElevations(part);
    for (let k = 0; k < part.length; k++) {
      data[c + k] = elev[k] == null ? 0 : elev[k];
    }
    if (c + CHUNK < pts.length) await new Promise((r) => setTimeout(r, 120));
  }
  return data; // размер points×points, высоты в метрах
}