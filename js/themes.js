// Color theme definitions — ported and expanded from themes/color_themes.py
// Each theme: { name (Korean), emoji, title_color, question_bg, answer_bg, answer_border }
//
// Optional fields (illustrated themes only — plain themes fall back safely):
//   page_bg         full-page background behind the cards; omit for white
//   highlight       cloze highlight + table header fill; defaults to question_bg
//   icons           motifs for the page pattern, as icons/<path>.svg
//   accent          small shape scattered in the gaps (a ball, a snowflake);
//                   an array mixes several
//   title_icon      the one shown beside the deck title
//   pattern         tile settings — see buildPatternSvg in js/icons.js:
//                   layout ('scatter' | 'lattice'), size, icon, count,
//                   accents, accentSize, angle, tilt, opacity, accentOpacity,
//                   accentColor, dash

export const THEMES = {
  rose:       { name: '장미',     emoji: '🌹', title_color: '#B5838D', question_bg: '#F5E6E0', answer_bg: '#FDF6F4', answer_border: '#E8D5D0' },
  ocean:      { name: '바다',     emoji: '🌊', title_color: '#5B8A9A', question_bg: '#E0EEF2', answer_bg: '#F3F9FB', answer_border: '#CBDEE5' },
  forest:     { name: '숲',       emoji: '🌲', title_color: '#6B8F71', question_bg: '#E2EDE3', answer_bg: '#F4F9F4', answer_border: '#CDDECE' },
  desert:     { name: '사막',     emoji: '🏜️', title_color: '#B8976A', question_bg: '#F0E8DB', answer_bg: '#FAF7F2', answer_border: '#E2D8C8' },
  cosmos:     { name: '우주',     emoji: '🌌', title_color: '#7B79A8', question_bg: '#E4E3F0', answer_bg: '#F5F4FA', answer_border: '#D1D0E2' },
  lavender:   { name: '라벤더',   emoji: '💜', title_color: '#9B8EC0', question_bg: '#EDE8F5', answer_bg: '#F8F6FC', answer_border: '#DDD6EC' },
  peach:      { name: '피치',     emoji: '🍑', title_color: '#C4956A', question_bg: '#F5EBDF', answer_bg: '#FBF7F2', answer_border: '#E6D9CA' },
  blossom:    { name: '벚꽃',     emoji: '🌸', title_color: '#C48B9F', question_bg: '#F5E4EC', answer_bg: '#FCF5F8', answer_border: '#E8D3DD' },
  // Extended palette
  mint:       { name: '민트',     emoji: '🌿', title_color: '#5FA69A', question_bg: '#DCEEEA', answer_bg: '#F0F8F6', answer_border: '#C4DED8' },
  lemon:      { name: '레몬',     emoji: '🍋', title_color: '#C9AE4A', question_bg: '#F5EFC9', answer_bg: '#FBF8E6', answer_border: '#E6DEAE' },
  sky:        { name: '하늘',     emoji: '☁️',  title_color: '#6B95C4', question_bg: '#DCE8F5', answer_bg: '#F0F5FB', answer_border: '#C8D8EC' },
  coral:      { name: '코랄',     emoji: '🐠', title_color: '#D87A6A', question_bg: '#F8DED7', answer_bg: '#FCF0EC', answer_border: '#EDC8BF' },
  autumn:     { name: '가을',     emoji: '🍂', title_color: '#B06B3E', question_bg: '#F2DDCA', answer_bg: '#FAF0E5', answer_border: '#E4CBB2' },
  winter:     { name: '겨울',     emoji: '❄️',  title_color: '#5B7A92', question_bg: '#D8E2EB', answer_bg: '#EDF2F7', answer_border: '#C2CFDB' },
  grape:      { name: '포도',     emoji: '🍇', title_color: '#7F5FA3', question_bg: '#E4DBEF', answer_bg: '#F5F0FA', answer_border: '#D2C5E2' },
  charcoal:   { name: '차콜',     emoji: '🌑', title_color: '#4A4A4A', question_bg: '#DCDCDC', answer_bg: '#F2F2F2', answer_border: '#C4C4C4' },
  matcha:     { name: '말차',     emoji: '🍵', title_color: '#7A8F5A', question_bg: '#E5EBD4', answer_bg: '#F4F7EC', answer_border: '#CDD7B8' },
  berry:      { name: '베리',     emoji: '🫐', title_color: '#6B6AA8', question_bg: '#DFDEF0', answer_bg: '#F1F0F9', answer_border: '#C7C6E0' },
  sunset:     { name: '노을',     emoji: '🌇', title_color: '#C7795D', question_bg: '#F5DDD0', answer_bg: '#FCEFE7', answer_border: '#E8C8B6' },
  cocoa:      { name: '코코아',   emoji: '🍫', title_color: '#8C6146', question_bg: '#E8D9CA', answer_bg: '#F6EEE4', answer_border: '#D6C2B0' },

  // ── Illustrated themes: colored page, white cards, motif pattern ──
  // Palettes follow the reference patterns rather than the muted house style:
  // the motifs are meant to read as artwork, not as a faint watermark.
  chess: {
    name: '체스', emoji: '♟️',
    icons: ['chess/pawn', 'chess/knight', 'chess/rook', 'chess/bishop', 'chess/queen', 'chess/king'],
    title_icon: 'chess/queen',
    title_color: '#3F3A34',
    page_bg: '#EFEBE3', question_bg: '#F7F4EE', answer_bg: '#FFFFFF',
    answer_border: '#DAD2C4', highlight: '#E3DBCB',
    // Pieces stand upright on a staggered grid linked by dashes — the chess
    // paper arrangement. rows must stay even or the grid seams every tile.
    pattern: { layout: 'lattice', rows: 4, size: 230, icon: 28, dash: true,
               dashWidth: 1, accents: 0,
               color: '#4F4A44', accentColor: '#4F4A44',
               opacity: 0.55, accentOpacity: 0.38 },
  },
  tennis: {
    name: '테니스', emoji: '🎾',
    icons: ['tennis/racket'],
    accent: 'tennis/ball', title_icon: 'tennis/ball',
    title_color: '#415A33',
    page_bg: '#BDCFA6', question_bg: '#F1F6EA', answer_bg: '#FFFFFF',
    answer_border: '#9DB287', highlight: '#DFE9CE',
    pattern: { size: 235, icon: 50, count: 5, accents: 5, accentSize: 16,
               angle: -25, tilt: 20,
               iconColors: ['#FFFDF6'], accentColor: '#EFEC55',
               opacity: 1, accentOpacity: 1 },
  },
  sven: {
    name: '스벤', emoji: '🦌',
    icons: ['sven/deer-a', 'sven/deer-b'],
    accent: 'sven/snowflake', title_icon: 'sven/deer-a',
    title_color: '#2C3547',
    page_bg: '#F3EBD9', question_bg: '#FAF6ED', answer_bg: '#FFFFFF',
    answer_border: '#DACDB2', highlight: '#EADFC6',
    // Deer stand on the ground, so barely any tilt — the variety comes from
    // mirroring and from the snowflakes between them.
    pattern: { size: 320, icon: 54, count: 8, accents: 8, accentSize: 22,
               angle: 0, tilt: 4,
               color: '#4A5366', accentColor: '#4A5366',
               opacity: 0.42, accentOpacity: 0.32 },
  },
};

export const DEFAULT_THEME = 'rose';
