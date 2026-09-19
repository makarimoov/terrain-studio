// Горизонтали: марширующие квадраты (marching squares) + сглаживание Чайкина + SVG.

// Сегменты изолинии на одном уровне
function segmentsAt(data, size, level) {
  const segs = [];
  for (let j = 0; j < size - 1; j++) {
    for (let i = 0; i < size - 1; i++) {
      const idx = j * size + i;
      const tl = data[idx];
      const tr = data[idx + 1];
      const br = data[idx + size + 1];
      const bl = data[idx + size];

      const bits =
        (tl >= level ? 1 : 0) |
        (tr >= level ? 2 : 0) |
        (br >= level ? 4 : 0) |
        (bl >= level ? 8 : 0);
      if (bits === 0 || bits === 15) continue;

      // точки пересечения рёбер
      const lx = (level - tl) / (tr - tl || 1e-9);
      const ry = (level - tr) / (br - tr || 1e-9);
      const bx = (level - bl) / (br - bl || 1e-9);
      const ly = (level - tl) / (bl - tl || 1e-9);
      const P = {
        top: [i + lx, j],
        right: [i + 1, j + ry],
        bottom: [i + bx, j + 1],
        left: [i, j + ly],
      };

      const crossing = [];
      if ((tl >= level) !== (tr >= level)) crossing.push('top');
      if ((tr >= level) !== (br >= level)) crossing.push('right');
      if ((bl >= level) !== (br >= level)) crossing.push('bottom');
      if ((tl >= level) !== (bl >= level)) crossing.push('left');

      if (crossing.length === 2) {
        segs.push([P[crossing[0]], P[crossing[1]]]);
      } else if (crossing.length === 4) {
        // седловина: выбор пары по значению в центре ячейки (асимптотический решатель)
        const center = (tl + tr + br + bl) / 4;
        const high = center >= level;
        const pairA = high ? ['top', 'right'] : ['top', 'left'];
        const pairB = high ? ['bottom', 'left'] : ['bottom', 'right'];
        segs.push([P[pairA[0]], P[pairA[1]]], [P[pairB[0]], P[pairB[1]]]);
      }
    }
  }
  return segs;
}

const ptKey = (pt) => `${Math.round(pt[0] * 100)},${Math.round(pt[1] * 100)}`;
const samePoint = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

// Склеить сегменты в ломаные
function chainSegments(segs) {
  const adj = new Map(); // ключ точки → список {si, end}
  const push = (k, v) => {
    if (!adj.has(k)) adj.set(k, []);
    adj.get(k).push(v);
  };
  segs.forEach((s, si) => {
    push(ptKey(s[0]), { si, end: 1 });
    push(ptKey(s[1]), { si, end: 0 });
  });

  const used = new Set();
  const chains = [];
  for (let si = 0; si < segs.length; si++) {
    if (used.has(si)) continue;
    const chain = [];
    let curSi = si;
    let flip = false;
    while (curSi != null && !used.has(curSi)) {
      used.add(curSi);
      const s = segs[curSi];
      const head = flip ? s[1] : s[0];
      const tail = flip ? s[0] : s[1];
      if (chain.length === 0 || !samePoint(chain[chain.length - 1], head)) chain.push(head);
      chain.push(tail);
      const cands = (adj.get(ptKey(tail)) || []).filter((c) => !used.has(c.si));
      if (!cands.length) { curSi = null; break; }
      const nxt = cands[0];
      curSi = nxt.si;
      flip = nxt.end === 0;
    }
    if (chain.length >= 2) chains.push(chain);
  }
  return chains;
}

// Сглаживание Чайкина
export function chaikin(pts, iterations = 2) {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i];
      const q = cur[i + 1];
      next.push([p[0] + 0.25 * (q[0] - p[0]), p[1] + 0.25 * (q[1] - p[1])]);
      next.push([p[0] + 0.75 * (q[0] - p[0]), p[1] + 0.75 * (q[1] - p[1])]);
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

// Все уровни → список ломаных с привязкой к уровню
export function computeContours(data, size, levels) {
  const polylines = [];
  for (let k = 1; k <= levels; k++) {
    const level = k / (levels + 1);
    const chains = chainSegments(segmentsAt(data, size, level));
    for (const ch of chains) {
      polylines.push({ level, points: chaikin(ch, 2) });
    }
  }
  return polylines;
}

// Ломаные → SVG-строка. ramp(t) — функция цвета для уровня t∈[0..1]
export function polylinesToSVG(polylines, width, height, ramp) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`];
  parts.push(`<rect width="${width}" height="${height}" fill="#faf8f2"/>`);
  for (const { level, points } of polylines) {
    const d = points
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)},${(height - 1 - y).toFixed(2)}`)
      .join(' ');
    const col = ramp ? ramp(level) : '#8a5a3a';
    parts.push(
      `<path d="${d}" fill="none" stroke="${col}" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>`
    );
  }
  parts.push('</svg>');
  return parts.join('');
}