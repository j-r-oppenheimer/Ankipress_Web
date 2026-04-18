// Browser port of core/image_occlusion.py — draws border outlines around
// occlusion regions on the original image using the <canvas> API.

const BUILTIN_RECT_RE = /image-occlusion:rect:left=(\d*\.?\d+):top=(\d*\.?\d+):width=(\d*\.?\d+):height=(\d*\.?\d+)/g;
const BUILTIN_ELLIPSE_RE = /image-occlusion:ellipse:left=(\d*\.?\d+):top=(\d*\.?\d+):width=(\d*\.?\d+):height=(\d*\.?\d+)/g;
const ABS_RECT_RE = /rect[:\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)/g;

function findImageSrc(card) {
  const preferred = ['Image', 'image', '이미지', 'Original'];
  for (const name of preferred) {
    const val = card.fields[name] || '';
    if (val.includes('<img')) {
      const m = val.match(/<img[^>]*src\s*=\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
  }
  for (const name of card.field_names) {
    const low = name.toLowerCase();
    if (['occlusion', 'mask', 'question mask', 'answer mask'].includes(low)) continue;
    const val = card.fields[name] || '';
    if (val.includes('<img')) {
      const m = val.match(/<img[^>]*src\s*=\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
  }
  return null;
}

function extractBuiltinRects(card, imgW, imgH) {
  const rects = [];
  for (const name of card.field_names) {
    const val = card.fields[name] || '';
    if (!val) continue;
    BUILTIN_RECT_RE.lastIndex = 0;
    let m;
    while ((m = BUILTIN_RECT_RE.exec(val)) !== null) {
      const x = Math.round(parseFloat(m[1]) * imgW);
      const y = Math.round(parseFloat(m[2]) * imgH);
      const w = Math.round(parseFloat(m[3]) * imgW);
      const h = Math.round(parseFloat(m[4]) * imgH);
      if (w > 0 && h > 0) rects.push([x, y, w, h]);
    }
    BUILTIN_ELLIPSE_RE.lastIndex = 0;
    while ((m = BUILTIN_ELLIPSE_RE.exec(val)) !== null) {
      const x = Math.round(parseFloat(m[1]) * imgW);
      const y = Math.round(parseFloat(m[2]) * imgH);
      const w = Math.round(parseFloat(m[3]) * imgW);
      const h = Math.round(parseFloat(m[4]) * imgH);
      if (w > 0 && h > 0) rects.push([x, y, w, h]);
    }
  }
  return rects;
}

function parseSvgRects(svgContent) {
  const rects = [];
  const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml');
  for (const r of doc.querySelectorAll('rect')) {
    const x = parseFloat(r.getAttribute('x') || '0');
    const y = parseFloat(r.getAttribute('y') || '0');
    const w = parseFloat(r.getAttribute('width') || '0');
    const h = parseFloat(r.getAttribute('height') || '0');
    if (w > 0 && h > 0) rects.push([Math.round(x), Math.round(y), Math.round(w), Math.round(h)]);
  }
  return rects;
}

function extractSvgRects(card, mediaHandler) {
  const rects = [];
  for (const name of card.field_names) {
    if (!name.toLowerCase().includes('mask')) continue;
    const val = card.fields[name] || '';
    if (!val) continue;
    let svgContent = null;
    if (val.includes('<img')) {
      const m = val.match(/<img[^>]*src\s*=\s*["']([^"']+)["']/);
      if (m && m[1].toLowerCase().endsWith('.svg')) {
        const raw = mediaHandler.getRawBytes(m[1]);
        if (raw) {
          try { svgContent = new TextDecoder('utf-8').decode(raw); } catch {}
        }
      }
    }
    if (!svgContent && /<svg/i.test(val)) svgContent = val;
    if (svgContent) rects.push(...parseSvgRects(svgContent));
  }
  return rects;
}

function extractAbsoluteRects(card) {
  const rects = [];
  for (const name of card.field_names) {
    const val = card.fields[name] || '';
    if (!val) continue;
    ABS_RECT_RE.lastIndex = 0;
    let m;
    while ((m = ABS_RECT_RE.exec(val)) !== null) {
      const x = Math.round(parseFloat(m[1]));
      const y = Math.round(parseFloat(m[2]));
      const w = Math.round(parseFloat(m[3]));
      const h = Math.round(parseFloat(m[4]));
      rects.push([x, y, w, h]);
    }
  }
  return rects;
}

function loadImage(uri) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = uri;
  });
}

function drawRoundedRect(ctx, x, y, w, h, radius) {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
  ctx.stroke();
}

async function buildAnnotatedImage(card, mediaHandler, borderHex) {
  const src = findImageSrc(card);
  if (!src) return '';
  const uri = mediaHandler.getBase64Uri(src);
  if (!uri) return '';

  let img;
  try { img = await loadImage(uri); } catch { return `<img src="${uri}" class="card-image">`; }

  const imgW = img.naturalWidth, imgH = img.naturalHeight;

  let rects = extractBuiltinRects(card, imgW, imgH);
  if (!rects.length) rects = extractSvgRects(card, mediaHandler);
  if (!rects.length) rects = extractAbsoluteRects(card);
  if (!rects.length) return `<img src="${uri}" class="card-image">`;

  const canvas = document.createElement('canvas');
  canvas.width = imgW; canvas.height = imgH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const borderWidth = Math.max(2, Math.floor(Math.min(imgW, imgH) / 200));
  const cornerRadius = Math.max(4, Math.floor(Math.min(imgW, imgH) / 80));
  ctx.strokeStyle = borderHex;
  ctx.lineWidth = borderWidth;
  for (const [x, y, w, h] of rects) {
    drawRoundedRect(ctx, x, y, w, h, cornerRadius);
  }

  const dataUrl = canvas.toDataURL('image/png');
  return `<img src="${dataUrl}" class="card-image">`;
}

export async function processIoCards(cards, mediaHandler, borderHex = '#B5838D') {
  const noteGroups = new Map();
  for (const c of cards) {
    if (c.card_type !== 'image_occlusion') continue;
    if (!noteGroups.has(c.note_id)) noteGroups.set(c.note_id, []);
    noteGroups.get(c.note_id).push(c);
  }
  const results = new Map();
  for (const [nid, group] of noteGroups) {
    const html = await buildAnnotatedImage(group[0], mediaHandler, borderHex);
    results.set(nid, html);
  }
  return results;
}
