// Theme icon loading, tinting, and pattern tile composition.
//
// Icons live in icons/<theme>/<name>.svg and must paint with `currentColor`
// so they can take the theme color. A hard-coded color inside a file (the
// white seam on the tennis ball, say) is left alone.

const cache = {};

export async function loadIcon(key) {
  if (!key) return null;
  if (key in cache) return cache[key];
  try {
    const res = await fetch(`icons/${key}.svg`);
    cache[key] = res.ok ? await res.text() : null;
  } catch {
    cache[key] = null;
  }
  return cache[key];
}

export async function loadIcons(keys = []) {
  const all = await Promise.all(keys.map(loadIcon));
  return all.filter(Boolean);
}

// Swap currentColor for a real color and apply group opacity.
// `opacity` on the root <svg> covers both fills and strokes, unlike
// fill-opacity, so stroke-drawn icons fade the same way.
export function tint(svg, color, opacity = 1) {
  return svg
    .replaceAll('currentColor', color)
    .replace(/<svg\b/i, `<svg opacity="${opacity}"`);
}

// Pack an SVG string into a CSS url() value.
// Single-quoted because the result is dropped into a double-quoted
// style="…" attribute; %27 keeps a stray apostrophe from closing it early.
export function toDataUri(svg) {
  const body = encodeURIComponent(svg.replace(/\s+/g, ' ').trim())
    .replaceAll("'", '%27');
  return `url('data:image/svg+xml,${body}')`;
}

// ── Pattern layer ────────────────────────────────────────────────
// The pattern is emitted as real SVG elements in the document, not as a CSS
// background-image: Chrome rasterises background images (and SVG <pattern>
// fills) at their CSS pixel size, so at 300dpi a tiled one came out visibly
// stair-stepped. Plain shapes in the DOM print as vector and stay sharp.
//
// Nothing is tiled, either. A repeating tile puts every motif back at the same
// height and the same spacing on every repeat, and the eye reads that as rows
// or diagonal chains no matter how the tile itself is arranged. Motifs are
// instead sampled across the whole page area at once:
//
//   scatter — Poisson-disk sampling, which guarantees a minimum gap between
//             motifs (no clumps) without any repeating structure
//   lattice — a deliberate staggered grid with connecting dashes, for chess,
//             where regularity is the point

// mulberry32 — same seed, same pattern, every render.
function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = s => [...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

// Pull the root <svg>'s presentation attributes out with the markup — stroke,
// fill and friends usually live there and a bare innerHTML would drop them.
// stroke-width comes back separately rather than carried: the layer sets its
// own, and a duplicate attribute is a fatal XML parse error.
function dissect(svg) {
  const m = svg.match(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/i);
  if (!m) return null;
  const [, attrText, inner] = m;
  const attrs = {};
  for (const a of attrText.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
  const vb = (attrs.viewBox || '0 0 24 24').trim().split(/\s+/).map(Number);
  const dropped = ['xmlns', 'xmlns:xlink', 'viewBox', 'width', 'height',
                   'id', 'class', 'opacity', 'stroke-width'];
  return {
    inner,
    carry: Object.entries(attrs)
      .filter(([k]) => !dropped.includes(k))
      .map(([k, v]) => `${k}="${v}"`).join(' '),
    stroked: 'stroke' in attrs && attrs.stroke !== 'none',
    // Motifs are not square — a racket is tall, a deer is wide. Scaling by the
    // longer side keeps every motif the same visual weight.
    unit: Math.max(vb[2] || 24, vb[3] || 24),
    ox: vb[0] || 0, oy: vb[1] || 0, w: vb[2] || 24, h: vb[3] || 24,
  };
}

// Bridson's Poisson-disk sampling: every point lands at least `radius` from
// its neighbours, with no grid or tile behind it. `avoid` is an optional
// {points, grid, cell, clearance} to keep a second pass (the accents) off the
// first one (the motifs).
function poisson(w, h, radius, rand, cap = 4000) {
  const cell = radius / Math.SQRT2;
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grid = new Int32Array(gw * gh).fill(-1);
  const pts = [];
  const active = [];
  const add = p => {
    grid[Math.floor(p[1] / cell) * gw + Math.floor(p[0] / cell)] = pts.length;
    pts.push(p); active.push(pts.length - 1);
  };
  const ok = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let j = Math.max(0, gy - 2); j <= Math.min(gh - 1, gy + 2); j++) {
      for (let i = Math.max(0, gx - 2); i <= Math.min(gw - 1, gx + 2); i++) {
        const k = grid[j * gw + i];
        if (k < 0) continue;
        if (Math.hypot(pts[k][0] - x, pts[k][1] - y) < radius) return false;
      }
    }
    return true;
  };
  add([rand() * w, rand() * h]);
  while (active.length && pts.length < cap) {
    const ai = Math.floor(rand() * active.length);
    const [px, py] = pts[active[ai]];
    let placed = false;
    for (let k = 0; k < 20; k++) {
      const ang = rand() * Math.PI * 2;
      const r = radius * (1 + rand());
      const x = px + Math.cos(ang) * r, y = py + Math.sin(ang) * r;
      if (ok(x, y)) { add([x, y]); placed = true; break; }
    }
    if (!placed) active.splice(ai, 1);
  }
  return pts;
}

// Each layer gets its own def ids. Ids are document-global, so two layers on
// one page (preview + print copy, or a stale theme) would otherwise resolve
// each other's <use> to whichever defs came first.
let layerSeq = 0;

export function buildPatternLayerMarkup(iconSvgs, cfg = {}, width, height) {
  const {
    layout = 'scatter', size = 200, icon = 36, count = 5,
    accentSvg = null, accentSize = 14, accents = 6,
    angle = -16, tilt = 12, flip = true,
    color = '#000', iconColors = null, accentColor = color,
    opacity = 0.6, accentOpacity = 0.5, strokeWidth = 1.15,
    dash = false, dashWidth = 1, rows = 4,
    // One A4 page of extra rows past the end of the block: on the last page
    // the cards stop partway down and the pattern has to keep going.
    overrun = 1123,
    seed = 'x',
  } = cfg;

  // iconColors lines up with the theme's icons array, so a pattern can hold
  // motifs in different colors — cream rackets and yellow balls, say.
  const list = (Array.isArray(iconSvgs) ? iconSvgs : [iconSvgs]).filter(Boolean)
    .map((svg, i) => svg.replaceAll('currentColor', (iconColors && iconColors[i]) || color));
  if (!list.length || !width || !height) return '';
  const sprites = list.map(dissect).filter(Boolean);
  if (!sprites.length) return '';
  // One accent or several; each gap picks one at random.
  const accentSprites = (Array.isArray(accentSvg) ? accentSvg : [accentSvg]).filter(Boolean)
    .map(svg => dissect(svg.replaceAll('currentColor', accentColor || color)))
    .filter(Boolean);

  const W = Math.ceil(width), H = Math.ceil(height + overrun);
  const rand = rng(hash(seed) >>> 0);
  const defs = [], motifs = [], accentUses = [], dashes = [];

  const layerId = ++layerSeq;
  const define = (sp, key, scale) => {
    const id = `p${layerId}-${key}`;
    if (!defs.some(d => d.startsWith(`<g id="${id}"`))) {
      const sw = sp.stroked ? ` stroke-width="${(strokeWidth / scale).toFixed(2)}"` : '';
      defs.push(`<g id="${id}" ${sp.carry}${sw}>${sp.inner}</g>`);
    }
    return id;
  };

  const place = (sp, key, cx, cy, px, rot, mirror, sink) => {
    const scale = px / sp.unit;
    const id = define(sp, key, scale);
    const x = cx - (sp.w * scale) / 2 - sp.ox * scale;
    const y = cy - (sp.h * scale) / 2 - sp.oy * scale;
    const t = [`translate(${x.toFixed(1)} ${y.toFixed(1)})`];
    if (rot) t.push(`rotate(${rot.toFixed(1)} ${(cx - x).toFixed(1)} ${(cy - y).toFixed(1)})`);
    if (mirror) t.push(`translate(${(2 * (cx - x)).toFixed(1)} 0) scale(-1 1)`);
    t.push(`scale(${scale.toFixed(3)})`);
    sink.push(`<use href="#${id}" transform="${t.join(' ')}"/>`);
  };

  if (layout === 'lattice') {
    // Staggered rows across the whole sheet. Columns sit twice as far apart as
    // the rows, so the diagonal to a neighbour is 45° and the diamonds the
    // dashes draw come out square.
    const rowCount = rows % 2 ? rows + 1 : rows;
    const rowStep = size / rowCount;
    const colStep = rowStep * 2;
    const len = Math.hypot(colStep / 2, rowStep) * 0.3;
    let i = 0;
    for (let r = -1; r * rowStep < H + rowStep; r++) {
      const cy = r * rowStep + rowStep / 2;
      const shift = (r % 2 ? colStep / 2 : 0) + colStep / 4;
      for (let c = -1; c * colStep + shift < W + colStep; c++, i++) {
        const cx = c * colStep + shift;
        const key = i % sprites.length;
        place(sprites[key], key, cx, cy, icon, 0, false, motifs);
        if (!dash) continue;
        for (const sx of [-1, 1]) {
          const mx = cx + (sx * colStep) / 4, my = cy + rowStep / 2;
          const ang = Math.atan2(rowStep, (sx * colStep) / 2);
          const dx = (Math.cos(ang) * len) / 2, dy = (Math.sin(ang) * len) / 2;
          dashes.push(`<line x1="${(mx - dx).toFixed(1)}" y1="${(my - dy).toFixed(1)}" ` +
                      `x2="${(mx + dx).toFixed(1)}" y2="${(my + dy).toFixed(1)}"/>`);
        }
      }
    }
  } else {
    // `size` and `count` describe one notional tile's worth of motifs; that
    // becomes a minimum spacing for the sampler.
    const spacing = (size / Math.sqrt(Math.max(1, count))) * 0.92;
    // Sample a band past every edge and shift back, so motifs straddle the
    // paper edge and get cut off there instead of the edges thinning out.
    const bleed = Math.ceil(icon * 0.6);
    const SW = W + 2 * bleed, SH = H + 2 * bleed;
    const pts = poisson(SW, SH, spacing, rand, 12000);
    for (const [cx, cy] of pts) {
      const key = Math.floor(rand() * sprites.length);
      place(sprites[key], key, cx - bleed, cy - bleed, icon * (0.85 + rand() * 0.3),
            angle + (rand() - 0.5) * 2 * tilt, flip && rand() < 0.5, motifs);
    }

    if (accents > 0) {
      const aSpacing = (size / Math.sqrt(accents)) * 0.92;
      const clear = icon * 0.5 + accentSize * 0.55;
      // Index the motifs so the clearance test stays cheap.
      const cell = Math.max(spacing, clear);
      const gw = Math.ceil(SW / cell), gh = Math.ceil(SH / cell);
      const buckets = Array.from({ length: gw * gh }, () => []);
      for (const [x, y] of pts) {
        buckets[Math.min(gh - 1, Math.floor(y / cell)) * gw + Math.min(gw - 1, Math.floor(x / cell))].push([x, y]);
      }
      const free = (x, y) => {
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
        for (let j = Math.max(0, gy - 1); j <= Math.min(gh - 1, gy + 1); j++) {
          for (let i2 = Math.max(0, gx - 1); i2 <= Math.min(gw - 1, gx + 1); i2++) {
            for (const [mx, my] of buckets[j * gw + i2]) {
              if (Math.hypot(mx - x, my - y) < clear) return false;
            }
          }
        }
        return true;
      };
      for (const [sx, sy] of poisson(SW, SH, aSpacing, rand, 16000)) {
        if (!free(sx, sy)) continue;
        const cx = sx - bleed, cy = sy - bleed;
        const px = accentSize * (0.8 + rand() * 0.4);
        if (accentSprites.length) {
          const k = Math.floor(rand() * accentSprites.length);
          place(accentSprites[k], `a${k}`, cx, cy, px, rand() * 360, false, accentUses);
        }
        else accentUses.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(px / 4).toFixed(2)}"/>`);
      }
    }
  }

  // The backdrop rect carries the page tint. The layer sits behind the block's
  // own background, so painting the tint here rather than on .print-root is
  // what lets the motifs show through at all.
  const backdrop = `<rect x="0" y="0" width="${W}" height="${H}" ` +
    `style="fill: var(--page-bg, transparent)"/>`;
  const dashLayer = dashes.length
    ? `<g stroke="${accentColor}" stroke-width="${dashWidth}" stroke-linecap="round" opacity="${accentOpacity}">${dashes.join('')}</g>`
    : '';
  const accentLayer = accentUses.length
    ? `<g fill="${accentColor}" opacity="${accentOpacity}">${accentUses.join('')}</g>`
    : '';

  return `<defs>${defs.join('')}</defs>${backdrop}${dashLayer}` +
    `<g opacity="${opacity}">${motifs.join('')}</g>${accentLayer}`;
}

// The layer element carries no viewBox on purpose: without one the SVG user
// unit is a CSS pixel, so motifs keep their intended size in both the preview
// and the print copy.
export function paintPatternLayer(svgEl, iconSvgs, cfg = {}, width, height) {
  svgEl.innerHTML = buildPatternLayerMarkup(iconSvgs, cfg, width, height);
}
