// Browser port of core/card_processor.py — cleans HTML, converts Cloze
// deletions, delegates Image Occlusion rendering.

import { processIoCards } from './image-occlusion.js';

const CLOZE_RE = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/gs;

export async function processCards(cards, mediaHandler, includedFields = null, borderHex = '#B5838D') {
  const ioCards = cards.filter(c => c.card_type === 'image_occlusion');
  const ioResults = ioCards.length ? await processIoCards(ioCards, mediaHandler, borderHex) : new Map();

  const seenNotes = new Set();
  const processed = [];
  let number = 1;

  for (const card of cards) {
    // Content-based fallback: basic with cloze syntax -> treat as cloze
    let effective = card.card_type;
    if (effective === 'basic' && card.field_names.length) {
      const firstVal = card.fields[card.field_names[0]] || '';
      if (hasCloze(firstVal)) effective = 'cloze';
    }

    if (seenNotes.has(card.note_id)) continue;
    seenNotes.add(card.note_id);

    const answerFieldNames = getAnswerFieldNames(card, includedFields);

    let result;
    if (effective === 'image_occlusion') {
      result = processIo(card, number, mediaHandler, ioResults, answerFieldNames);
    } else if (effective === 'cloze') {
      result = processCloze(card, number, mediaHandler, answerFieldNames);
    } else {
      result = processBasic(card, number, mediaHandler, answerFieldNames);
    }

    if (result) { processed.push(result); number++; }
  }

  return processed;
}

function hasCloze(text) {
  CLOZE_RE.lastIndex = 0;
  return CLOZE_RE.test(text);
}

function getAnswerFieldNames(card, included) {
  if (!card.field_names || card.field_names.length < 2) return [];
  const remaining = card.field_names.slice(1);
  if (included && included.has(card.model_id)) {
    const set = included.get(card.model_id);
    return remaining.filter(n => set.has(n));
  }
  return remaining;
}

function processBasic(card, number, mediaHandler, answerFieldNames) {
  if (!card.field_names.length) return null;
  const qName = card.field_names[0];
  const question = cleanHtml(card.fields[qName] || '', mediaHandler);

  const answerFields = [];
  for (const name of answerFieldNames) {
    const val = card.fields[name] || '';
    const cleaned = cleanHtml(val, mediaHandler);
    if (cleaned.trim()) answerFields.push([name, cleaned]);
  }

  if (!question.trim() && !answerFields.length) return null;
  return { number, card_type: 'basic', question_html: question, answer_fields: answerFields };
}

function processCloze(card, number, mediaHandler, answerFieldNames) {
  if (!card.field_names.length) return null;
  const text = card.fields[card.field_names[0]] || '';
  if (!text.trim()) return null;

  const converted = cleanHtml(
    text.replace(CLOZE_RE, (_, inner) => `<span class="cloze-highlight">${inner}</span>`),
    mediaHandler
  );

  const answerFields = [];
  for (const name of answerFieldNames) {
    const val = card.fields[name] || '';
    const cleaned = cleanHtml(val, mediaHandler);
    if (cleaned.trim()) answerFields.push([name, cleaned]);
  }

  return { number, card_type: 'cloze', question_html: converted, answer_fields: answerFields };
}

function processIo(card, number, mediaHandler, ioResults, answerFieldNames) {
  const annotated = ioResults.get(card.note_id) || '';
  if (!annotated) return processBasic(card, number, mediaHandler, answerFieldNames);

  const answerFields = [];
  for (const name of answerFieldNames) {
    const val = card.fields[name] || '';
    if (val.includes('<img')) continue;
    const cleaned = cleanHtml(val, mediaHandler);
    if (cleaned.trim()) answerFields.push([name, cleaned]);
  }

  return { number, card_type: 'image_occlusion', question_html: annotated, answer_fields: answerFields };
}

function cleanHtml(html, mediaHandler) {
  if (!html || !html.trim()) return '';

  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html');
  const root = doc.getElementById('root');
  if (!root) return '';

  // Strip scripts, styles, replay buttons
  root.querySelectorAll('script, style, .replay-button, a.replay-button, div.replay-button')
      .forEach(n => n.remove());

  // Rewrite images to data URIs + tag with .card-image
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (src && mediaHandler && !src.startsWith('data:')) {
      const uri = mediaHandler.getBase64Uri(src);
      if (uri) img.setAttribute('src', uri);
    }
    img.classList.add('card-image');
  }

  let out = root.innerHTML;
  out = out.replace(/<p>\s*<\/p>/g, '').replace(/<br\s*\/?>\s*$/i, '');
  return out.trim();
}
