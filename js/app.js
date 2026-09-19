// Main UI controller — wires file upload → parse → field selector →
// theme/font settings → preview → print-to-PDF.

import { THEMES, DEFAULT_THEME } from './themes.js';
import { ApkgParser, MediaHandler } from './apkg-parser.js';
import { processCards } from './card-processor.js';
import { buildPrintHtml } from './render.js';
import { loadIcon, loadIcons, paintPatternLayer } from './icons.js';

// ── Global state ────────────────────────────────────────────────
const state = {
  fileName: '',
  parser: null,
  mediaHandler: null,
  deckGroups: [],           // raw, pre-processed (AnkiCard groups)
  totalCards: 0,
  // field selection: model_id -> Set(field names)
  includedFields: new Map(),
  themeKey: DEFAULT_THEME,
  fontFamily: 'Gowun Dodum',
  fontSize: 9,
  showDeckTitle: true,
};

// ── DOM refs ────────────────────────────────────────────────────
const $ = sel => document.querySelector(sel);
const dropZone = $('#dropZone');
const fileInput = $('#fileInput');
const stepLoad = $('#step-load');
const stepConfig = $('#step-config');
const fileLabel = $('#fileLabel');
const cardCount = $('#cardCount');
const deckCount = $('#deckCount');
const fieldGroups = $('#fieldGroups');
const themeGrid = $('#themeGrid');
const fontSelect = $('#fontFamily');
const fontSizeSlider = $('#fontSize');
const fontSizeValue = $('#fontSizeValue');
const deckTitleToggle = $('#deckTitleToggle');
const previewBtn = $('#previewBtn');
const printBtn = $('#printBtn');
const resetBtn = $('#resetBtn');
const preview = $('#preview');
const printTarget = $('#print-target');
const toast = $('#toast');
const loadingOverlay = $('#loadingOverlay');
const loadingText = $('#loadingText');

// ── Initialize ──────────────────────────────────────────────────
init();

async function init() {
  initThemeGrid();
  await initFontOptions();
  bindFileEvents();
  bindButtonEvents();
  updateFontSizeDisplay();
  syncPrintFooter();
  primeSqlJs();
  // Recount right before printing: web fonts may have finished loading since
  // the preview was built, and Ctrl+P skips the print button's own refresh.
  window.addEventListener('beforeprint', paintPageNumbers);
}

function primeSqlJs() {
  if (!window.sqlJsReady) {
    window.sqlJsReady = window.initSqlJs({
      locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.11.0/${f}`
    });
  }
}

// ── Theme grid ──────────────────────────────────────────────────
function initThemeGrid() {
  themeGrid.innerHTML = '';
  for (const [key, theme] of Object.entries(THEMES)) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'theme-tile' + (key === state.themeKey ? ' is-active' : '');
    tile.dataset.theme = key;
    tile.innerHTML = `
      <div class="theme-swatch" style="
        background: ${theme.page_bg || theme.question_bg};
        border: 1.5px solid ${theme.answer_border};
      ">
        <span class="theme-emoji">${theme.emoji}</span>
        <span class="theme-dot" style="background: ${theme.title_color};"></span>
      </div>
      <span class="theme-name">${theme.name}</span>
    `;
    tile.addEventListener('click', () => selectTheme(key));
    themeGrid.appendChild(tile);
  }
}

function selectTheme(key) {
  state.themeKey = key;
  for (const tile of themeGrid.querySelectorAll('.theme-tile')) {
    tile.classList.toggle('is-active', tile.dataset.theme === key);
  }
  syncPrintFooter();
  renderPreview();
}

function syncPrintFooter() {
  // @page rules resolve CSS variables against :root, so the footer page
  // number picks up whatever theme / font is currently selected.
  const root = document.documentElement.style;
  const theme = THEMES[state.themeKey];
  if (theme) {
    root.setProperty('--print-footer-color', theme.title_color);
  }
  if (state.fontFamily) {
    root.setProperty('--print-footer-font', `"${state.fontFamily}", sans-serif`);
  }
}

// The flat page tint rides on <html>, whose background propagates to the page
// canvas and so covers every sheet, including the tail of a short last page.
// The motifs are a separate vector layer inside .print-root (see
// paintPatternLayer) — a background-image would print rasterised.
function syncPageCanvas(theme) {
  document.documentElement.style.setProperty('--page-bg', theme.page_bg || '#fff');
  syncPageSetup(theme);
}

// The zero-margin page setup for illustrated themes. @page rules can't be
// scoped to a class, so css/print.css holds the plain setup and this override
// is swapped in while an illustrated theme is selected. It comes after
// print.css in the document, so it wins.
// Chrome draws no margin boxes on a zero margin, so the page numbers come from
// paintPageNumbers instead; content: none keeps a browser that does draw them
// from printing a second set.
const ILLUSTRATED_PAGE_CSS = `@media print {
  @page {
    margin: 0;
    @bottom-center { content: none; }
  }
}`;
let pageSetupStyle = null;

function syncPageSetup(theme) {
  if (!pageSetupStyle) {
    pageSetupStyle = document.createElement('style');
    pageSetupStyle.id = 'illustrated-page-setup';
    document.head.appendChild(pageSetupStyle);
  }
  pageSetupStyle.textContent = theme.page_bg ? ILLUSTRATED_PAGE_CSS : '';
  document.documentElement.classList.toggle('illustrated-page', !!theme.page_bg);
}

// Stamp the pattern across both rendered copies. Has to run after layout —
// the tile grid is sized from the block's real width and height.
function paintPatterns(theme, patternSvgs, accentSvg) {
  if (!theme.pattern) return;
  const cfg = { color: theme.answer_border, seed: theme.name, accentSvg, ...theme.pattern };
  const layerOf = host => host?.querySelector('.print-root > .page-pattern');

  const previewRoot = preview.querySelector('.print-root');
  const previewLayer = layerOf(preview);
  if (previewRoot && previewLayer) {
    paintPatternLayer(previewLayer, patternSvgs, cfg,
      previewRoot.clientWidth, previewRoot.scrollHeight);
  }

  // #print-target is display:none on screen, so it can't be measured. Its
  // width is known from the @page rules (zero margin, so the full A4 width) and
  // its height is estimated from the preview, scaled by the width ratio and
  // then padded generously — stamps that fall past the block are clipped, so
  // overshooting costs a few unused <use> elements and undershooting would
  // leave bare paper.
  const printLayer = layerOf(printTarget);
  if (printLayer) {
    const PRINT_WIDTH = 794;   // 210mm at 96dpi
    const height = previewRoot && previewRoot.clientWidth
      ? previewRoot.scrollHeight * (previewRoot.clientWidth / PRINT_WIDTH) * 1.4 + 2000
      : 12000;
    paintPatternLayer(printLayer, patternSvgs, cfg, PRINT_WIDTH, height);
  }
}

// Page numbers for illustrated themes. The zero @page margin leaves Chrome no
// room for the @bottom-center footer, so the numbers are stamped into the print
// copy's pattern layer instead: one label per page, at the foot of each A4
// slot. The layer is a single SVG, so the labels ride across page breaks the
// same way the motifs do, above the motifs and below the cards.
const PRINT_PAGE_HEIGHT = 1123;   // A4 page stride in CSS px, as Chrome paginates it

function paintPageNumbers() {
  const theme = THEMES[state.themeKey];
  const root = printTarget.querySelector('.print-root');
  const layer = root?.querySelector(':scope > .page-pattern');
  if (!layer) return;
  layer.querySelector('.page-numbers')?.remove();
  if (!theme?.page_bg) return;

  const total = countPrintPages(root);
  const labels = [];
  for (let n = 1; n <= total; n++) {
    labels.push(`<text x="50%" y="${n * PRINT_PAGE_HEIGHT - 30}">${n} / ${total}</text>`);
  }
  layer.insertAdjacentHTML('beforeend',
    '<g class="page-numbers" text-anchor="middle" style="font-size: 10pt; ' +
    'font-family: var(--print-footer-font, sans-serif); fill: var(--print-footer-color)">' +
    `${labels.join('')}</g>`);
}

// The printed page count, found by replaying the illustrated print layout on
// screen: a box of A4-wide, A4-tall columns stands in for the pages, and the
// print block laid out inside it fragments the same way it does on paper. One
// deck at a time, since every deck title starts a new page. The print copy
// itself can't be measured (display: none on screen).
function countPrintPages(printRoot) {
  const decks = [];
  for (const el of printRoot.children) {
    if (el.classList.contains('page-pattern')) continue;
    if (el.classList.contains('deck-title') || !decks.length) decks.push([]);
    decks[decks.length - 1].push(el);
  }

  const host = document.createElement('div');
  host.style.cssText = 'position: absolute; left: -100000px; top: 0; visibility: hidden';
  document.body.appendChild(host);
  let total = 0;
  for (const deck of decks) {
    const pages = document.createElement('div');
    pages.style.cssText = 'width: 210mm; height: 297mm; column-width: 210mm; ' +
      'column-gap: 0; column-fill: auto';
    // Mirrors #print-target > .print-root.is-illustrated in css/print.css.
    const block = printRoot.cloneNode(false);
    block.style.cssText += '; column-count: 2; column-gap: 7mm; margin: 0; ' +
      'padding: 10mm 10mm 14mm 10mm; box-decoration-break: clone; -webkit-box-decoration-break: clone';
    for (const el of deck) block.appendChild(el.cloneNode(true));
    const title = block.querySelector('.deck-title');
    if (title) title.style.marginTop = '0';
    pages.appendChild(block);
    host.appendChild(pages);
    // One client rect per page-column the block spans.
    total += new Set([...block.getClientRects()].map(r => Math.round(r.left))).size;
  }
  host.remove();
  return total;
}

// ── Font options ────────────────────────────────────────────────
async function initFontOptions() {
  // Built-in web fonts loaded via <link> in index.html.
  const builtIn = [
    { family: 'Gowun Dodum',    label: 'Gowun Dodum' },
    { family: 'Noto Sans KR',   label: 'Noto Sans KR' },
    { family: 'Nanum Gothic',   label: 'Nanum Gothic' },
    { family: 'Nanum Myeongjo', label: 'Nanum Myeongjo' },
    { family: 'Pretendard',     label: 'Pretendard' },
    { family: 'Malgun Gothic',  label: 'Malgun Gothic (시스템)' },
    { family: 'sans-serif',     label: 'sans-serif' },
    { family: 'serif',          label: 'serif' },
  ];

  // User-uploaded fonts registered in fonts/fonts.json.
  const custom = await loadCustomFonts();

  const all = [...builtIn, ...custom.map(c => ({ family: c.family, label: c.label || c.family }))];

  fontSelect.innerHTML = all.map(
    f => `<option value="${escapeAttr(f.family)}" ${f.family === state.fontFamily ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
  ).join('');

  fontSelect.addEventListener('change', () => {
    state.fontFamily = fontSelect.value;
    syncPrintFooter();
    renderPreview();
  });
  fontSizeSlider.addEventListener('input', () => {
    state.fontSize = Number(fontSizeSlider.value);
    updateFontSizeDisplay();
    renderPreview();
  });
  deckTitleToggle.addEventListener('change', () => {
    state.showDeckTitle = deckTitleToggle.checked;
    renderPreview();
  });
}

async function loadCustomFonts() {
  // fonts/fonts.json is a manifest: [{ family, file, label?, weight?, style? }, ...]
  // Each entry is registered as a FontFace but the binary is fetched on demand
  // by the browser the first time the family is actually used (keeps initial
  // page load light even with dozens of MB of fonts in the folder).
  try {
    const res = await fetch('fonts/fonts.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const manifest = await res.json();
    if (!Array.isArray(manifest)) return [];
    const registered = [];
    for (const entry of manifest) {
      if (!entry.family || !entry.file) continue;
      try {
        const ff = new FontFace(
          entry.family,
          `url("fonts/${encodeURIComponent(entry.file)}")`,
          { weight: entry.weight || 'normal', style: entry.style || 'normal' }
        );
        document.fonts.add(ff);
        registered.push(entry);
      } catch (e) {
        console.warn(`Failed to register font ${entry.file}:`, e);
      }
    }
    return registered;
  } catch {
    return [];
  }
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;');
}

function updateFontSizeDisplay() {
  fontSizeValue.textContent = `${state.fontSize}pt`;
}

// ── File upload ─────────────────────────────────────────────────
function bindFileEvents() {
  // <label for="fileInput"> auto-opens the picker on click, so we only need
  // a keyboard handler (labels aren't keyboard-activatable by default).
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  });
  ['dragenter', 'dragover'].forEach(ev => {
    dropZone.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropZone.addEventListener(ev, e => {
      e.preventDefault();
      dropZone.classList.remove('is-dragover');
    });
  });
  dropZone.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  });
}

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.apkg')) {
    showToast('.apkg 파일만 업로드할 수 있습니다.', 'error');
    return;
  }

  showLoading('덱 분석 중...');
  try {
    state.fileName = file.name;
    state.parser = new ApkgParser();
    state.deckGroups = await state.parser.parse(file);
    state.mediaHandler = new MediaHandler(state.parser);
    state.totalCards = state.deckGroups.reduce((s, g) => s + g.cards.length, 0);

    // Default field selection: all fields except the first (question)
    state.includedFields = new Map();
    for (const schema of state.parser.modelSchemas) {
      const set = new Set(schema.field_names.slice(1));
      state.includedFields.set(schema.model_id, set);
    }

    fileLabel.textContent = file.name;
    cardCount.textContent = state.totalCards.toLocaleString();
    deckCount.textContent = state.deckGroups.length.toLocaleString();

    renderFieldGroups();
    stepLoad.classList.add('is-complete');
    stepConfig.classList.remove('is-hidden');
    stepConfig.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast(`${state.totalCards.toLocaleString()}장의 카드를 불러왔습니다.`, 'success');
    await renderPreview();
  } catch (err) {
    console.error(err);
    showToast(`파일을 읽을 수 없습니다: ${err.message}`, 'error');
  } finally {
    hideLoading();
  }
}

// ── Field selector ──────────────────────────────────────────────
function renderFieldGroups() {
  fieldGroups.innerHTML = '';
  if (!state.parser || !state.parser.modelSchemas.length) return;

  for (const schema of state.parser.modelSchemas) {
    if (!schema.field_names.length) continue;

    const group = document.createElement('div');
    group.className = 'field-group';

    const header = document.createElement('header');
    header.className = 'field-group__header';
    header.innerHTML = `
      <div>
        <h4>${escapeHtml(schema.model_name)}</h4>
        <span class="field-group__badge">${cardTypeLabel(schema.card_type)}</span>
      </div>
      <span class="field-group__count">${schema.field_names.length}개 필드</span>
    `;
    group.appendChild(header);

    const list = document.createElement('div');
    list.className = 'field-list';
    schema.field_names.forEach((name, idx) => {
      const isQuestion = idx === 0;
      const id = `fld-${schema.model_id}-${idx}`;
      const included = state.includedFields.get(schema.model_id) || new Set();

      const item = document.createElement('label');
      item.className = 'field-item' + (isQuestion ? ' is-question' : '');
      item.innerHTML = `
        <input type="checkbox" id="${id}"
               ${isQuestion ? 'checked disabled' : (included.has(name) ? 'checked' : '')}
               data-field="${escapeHtml(name)}">
        <span class="field-item__label">${escapeHtml(name)}</span>
        <span class="field-item__role">${isQuestion ? '문제' : '답'}</span>
      `;
      if (!isQuestion) {
        item.querySelector('input').addEventListener('change', e => {
          toggleField(schema.model_id, name, e.target.checked);
        });
      }
      list.appendChild(item);
    });
    group.appendChild(list);
    fieldGroups.appendChild(group);
  }
}

function toggleField(modelId, name, on) {
  const set = state.includedFields.get(modelId) || new Set();
  if (on) set.add(name); else set.delete(name);
  state.includedFields.set(modelId, set);
  renderPreview();
}

function cardTypeLabel(t) {
  return { basic: 'Basic', cloze: 'Cloze', image_occlusion: 'Image Occlusion' }[t] || t;
}

// ── Preview ─────────────────────────────────────────────────────
let previewPending = null;
async function renderPreview() {
  if (!state.parser || !state.deckGroups.length) return;
  // Debounce
  if (previewPending) clearTimeout(previewPending);
  previewPending = setTimeout(doRenderPreview, 100);
}

async function doRenderPreview() {
  const theme = THEMES[state.themeKey];
  // Flatten + process with current field selection.
  // Note: processCards returns a flat list of processed cards. We need to
  // re-group them by deck so deck titles render at the right positions.
  const processedGroups = [];
  let runningNumber = 1;

  for (const group of state.deckGroups) {
    const processed = await processCards(
      group.cards,
      state.mediaHandler,
      state.includedFields,
      theme.title_color
    );
    // Re-number continuously across all decks
    processed.forEach(p => { p.number = runningNumber++; });
    if (processed.length) {
      processedGroups.push({ title: group.title, cards: processed });
    }
  }

  const [iconSvg, patternSvgs, accentSvg] = await Promise.all([
    loadIcon(theme.title_icon),
    loadIcons(theme.icons || []),
    Array.isArray(theme.accent) ? loadIcons(theme.accent) : loadIcon(theme.accent),
  ]);
  syncPageCanvas(theme);

  const html = buildPrintHtml(processedGroups, theme, {
    fontFamily: state.fontFamily,
    fontSize: state.fontSize,
    showDeckTitle: state.showDeckTitle,
    iconSvg,
    patternSvgs,
    accentSvg,
  });

  preview.innerHTML = html;
  // Mirror into the print target so the PDF uses page-level CSS, not the
  // scrollable preview container's CSS.
  printTarget.innerHTML = html;

  paintPatterns(theme, patternSvgs, accentSvg);
  paintPageNumbers();
}

// ── Buttons ─────────────────────────────────────────────────────
function bindButtonEvents() {
  previewBtn.addEventListener('click', async () => {
    showLoading('미리보기 생성 중...');
    try { await doRenderPreview(); }
    finally { hideLoading(); }
    preview.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  printBtn.addEventListener('click', async () => {
    showLoading('PDF 준비 중...');
    try {
      await doRenderPreview();
      // Force the chosen font to load (needed for web fonts) before printing.
      if (document.fonts && state.fontFamily) {
        try {
          await document.fonts.load(`${state.fontSize}pt "${state.fontFamily}"`);
        } catch {}
        await document.fonts.ready;
      }
    } finally {
      hideLoading();
    }

    // Chrome's "Save as PDF" uses document.title as the default filename.
    // Use the deck the whole export shares — the common "::" prefix of every
    // group — so a parent deck with subdecks saves as the parent's name, not
    // its first subdeck's. Segments are joined with "_" (Chrome turns "/" into
    // "_" anyway, but leaves the surrounding spaces).
    const originalTitle = document.title;
    const rootDeck = commonDeckPath(state.deckGroups.map(g => g.path || g.title.replace(/\s*\/\s*/g, '::')));
    if (rootDeck) document.title = rootDeck.replace(/::/g, '_');
    const restoreTitle = () => {
      document.title = originalTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };
    window.addEventListener('afterprint', restoreTitle);

    setTimeout(() => window.print(), 50);
  });

  resetBtn.addEventListener('click', () => {
    state.fileName = '';
    state.parser = null;
    state.mediaHandler = null;
    state.deckGroups = [];
    state.totalCards = 0;
    state.includedFields = new Map();
    fileInput.value = '';
    stepLoad.classList.remove('is-complete');
    stepConfig.classList.add('is-hidden');
    fieldGroups.innerHTML = '';
    preview.innerHTML = '';
    printTarget.innerHTML = '';
    fileLabel.textContent = '.apkg 파일을 끌어다 놓거나 클릭해서 선택';
    cardCount.textContent = '0';
    deckCount.textContent = '0';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ── UI helpers ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function showToast(msg, kind = 'info') {
  toast.textContent = msg;
  toast.className = `toast toast--${kind} is-visible`;
  setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

function showLoading(msg) {
  loadingText.textContent = msg;
  loadingOverlay.classList.add('is-visible');
}

function hideLoading() {
  loadingOverlay.classList.remove('is-visible');
}

// Longest "::" path shared by every deck in the export. With a single deck it
// is that deck; with a parent and its subdecks it is the parent; with unrelated
// top-level decks nothing is shared, so fall back to the first deck's root.
function commonDeckPath(paths) {
  const list = paths.filter(Boolean);
  if (!list.length) return '';
  let common = list[0].split('::');
  for (const p of list.slice(1)) {
    const segs = p.split('::');
    let i = 0;
    while (i < common.length && i < segs.length && common[i] === segs[i]) i++;
    common = common.slice(0, i);
    if (!common.length) break;
  }
  return (common.length ? common : [list[0].split('::')[0]]).join('::');
}
