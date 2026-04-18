// Build the print-ready HTML (equivalent to templates/layout.html).
// The output is injected into the .preview container; native window.print()
// turns it into the final PDF with the @page rules in css/print.css.

function escapeText(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

export function buildPrintHtml(deckGroups, theme, opts = {}) {
  const fontFamily = opts.fontFamily || 'Gowun Dodum';
  const fontSize = opts.fontSize || 9;
  const showDeckTitle = opts.showDeckTitle !== false;

  // CSS custom properties let one sheet serve all themes.
  // Use single quotes inside the CSS value so they don't collide with the
  // double-quoted style="…" attribute (previous bug: font-family's inner
  // double quotes terminated the attribute, nullifying every var).
  const cssVars = [
    `--title-color: ${theme.title_color}`,
    `--question-bg: ${theme.question_bg}`,
    `--answer-bg: ${theme.answer_bg}`,
    `--answer-border: ${theme.answer_border}`,
    `--font-family: '${fontFamily}', 'Malgun Gothic', '맑은 고딕', sans-serif`,
    `--font-size: ${fontSize}pt`,
    `--title-size: ${fontSize + 3}pt`,
  ].join('; ');

  const parts = [`<div class="print-root" style="${cssVars}">`];
  for (const group of deckGroups) {
    if (!group.cards || !group.cards.length) continue;
    if (showDeckTitle) {
      parts.push(`<div class="deck-title">${escapeText(group.title)}</div>`);
    }
    for (const card of group.cards) {
      parts.push(renderCard(card));
    }
  }
  parts.push('</div>');
  return parts.join('');
}

function renderCard(card) {
  const num = `<span class="card-number">${card.number}.</span>`;
  let body = '';
  if (card.card_type === 'cloze' || card.card_type === 'image_occlusion') {
    body += `<div class="cloze-card">${num} ${card.question_html}</div>`;
  } else {
    body += `<div class="basic-question">${num} ${card.question_html}</div>`;
  }
  for (const [, fieldHtml] of card.answer_fields) {
    body += `<div class="basic-answer">${fieldHtml}</div>`;
  }
  return `<div class="card">${body}</div>`;
}
