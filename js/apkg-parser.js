// Browser port of core/apkg_parser.py — parses .apkg files entirely in-browser.
// Depends on global JSZip, initSqlJs (sql.js), fzstd (loaded as ESM-less scripts).

// ── Minimal protobuf varint helpers ──────────────────────────────
function readVarint(data, pos) {
  let result = 0, shift = 0;
  while (pos < data.length) {
    const b = data[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [result, pos];
}

function extractStringField(msg, fieldNum) {
  let pos = 0;
  const decoder = new TextDecoder('utf-8');
  while (pos < msg.length) {
    const tag = msg[pos++];
    const fn = tag >> 3;
    const wt = tag & 0x07;
    if (wt === 2) {
      let flen;
      [flen, pos] = readVarint(msg, pos);
      if (fn === fieldNum) return decoder.decode(msg.slice(pos, pos + flen));
      pos += flen;
    } else if (wt === 0) {
      [, pos] = readVarint(msg, pos);
    } else break;
  }
  return null;
}

function extractVarintField(msg, fieldNum) {
  let pos = 0;
  while (pos < msg.length) {
    let tag;
    [tag, pos] = readVarint(msg, pos);
    const fn = tag >> 3;
    const wt = tag & 0x07;
    if (wt === 0) {
      let val;
      [val, pos] = readVarint(msg, pos);
      if (fn === fieldNum) return val;
    } else if (wt === 2) {
      let flen;
      [flen, pos] = readVarint(msg, pos);
      pos += flen;
    } else if (wt === 5) {
      pos += 4;
    } else if (wt === 1) {
      pos += 8;
    } else break;
  }
  return null;
}

// ── zstd detection ───────────────────────────────────────────────
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
function isZstd(bytes) {
  return bytes.length >= 4 && bytes[0] === ZSTD_MAGIC[0] && bytes[1] === ZSTD_MAGIC[1]
      && bytes[2] === ZSTD_MAGIC[2] && bytes[3] === ZSTD_MAGIC[3];
}

function zstdDecompress(bytes) {
  // fzstd is loaded as a global via CDN (window.fzstd)
  if (!window.fzstd) throw new Error('fzstd library not loaded');
  return window.fzstd.decompress(bytes);
}

// ── Main parser ──────────────────────────────────────────────────
export class ApkgParser {
  constructor() {
    this.mediaMap = {};        // "0" -> "realname.png"
    this.mediaBlobs = new Map(); // realname -> Uint8Array
    this.modelSchemas = [];
  }

  async parse(file) {
    const arrayBuf = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuf);
    await this._loadMedia(zip);
    const cards = await this._parseDatabase(zip);
    return this._groupByDeck(cards);
  }

  getMediaBytes(filename) {
    // Direct hit
    if (this.mediaBlobs.has(filename)) return this.mediaBlobs.get(filename);
    // Via media_map (numeric key)
    for (const [num, real] of Object.entries(this.mediaMap)) {
      if (real === filename && this.mediaBlobs.has(num)) {
        return this.mediaBlobs.get(num);
      }
    }
    return null;
  }

  async _loadMedia(zip) {
    // Step 1: buffer every numeric-named file (these are the blobs)
    const fileEntries = Object.values(zip.files).filter(f => !f.dir);
    for (const entry of fileEntries) {
      const name = entry.name;
      if (['collection.anki2', 'collection.anki21', 'collection.anki21b', 'meta'].includes(name)) continue;
      if (name === 'media') continue;
      const bytes = new Uint8Array(await entry.async('uint8array'));
      const decompressed = isZstd(bytes) ? zstdDecompress(bytes) : bytes;
      this.mediaBlobs.set(name, decompressed);
    }

    // Step 2: parse `media` index (maps numeric key -> real filename)
    const mediaEntry = zip.file('media');
    if (!mediaEntry) return;
    const rawBytes = new Uint8Array(await mediaEntry.async('uint8array'));
    if (rawBytes.length === 0) return;

    // Strategy A: JSON (older Anki)
    if (rawBytes[0] === 0x7b /* '{' */) {
      try {
        const text = new TextDecoder('utf-8').decode(rawBytes);
        this.mediaMap = JSON.parse(text);
      } catch {
        // try cp949? browsers lack cp949 reliably — skip
      }
    } else if (isZstd(rawBytes)) {
      // Strategy B: zstd-compressed protobuf (Anki 23.10+)
      this.mediaMap = this._parseZstdMedia(rawBytes);
    }

    // Mirror numeric-keyed blobs under their real names for easy lookup.
    for (const [num, real] of Object.entries(this.mediaMap)) {
      if (this.mediaBlobs.has(num) && !this.mediaBlobs.has(real)) {
        this.mediaBlobs.set(real, this.mediaBlobs.get(num));
      }
    }
  }

  _parseZstdMedia(rawBytes) {
    let decompressed;
    try {
      decompressed = zstdDecompress(rawBytes);
    } catch {
      return {};
    }
    const map = {};
    let pos = 0, index = 0;
    while (pos < decompressed.length) {
      if (decompressed[pos] !== 0x0a) { pos++; continue; }
      pos++;
      let msgLen;
      [msgLen, pos] = readVarint(decompressed, pos);
      if (msgLen <= 0 || pos + msgLen > decompressed.length) break;
      const msg = decompressed.slice(pos, pos + msgLen);
      pos += msgLen;
      const name = extractStringField(msg, 1);
      if (name) {
        map[String(index)] = name;
        index++;
      }
    }
    return map;
  }

  async _parseDatabase(zip) {
    const [dbBytes, isNewSchema] = await this._findDb(zip);
    const SQL = await window.sqlJsReady;
    const db = new SQL.Database(dbBytes);
    // Add a dummy 'unicase' collation — some Anki DBs use it in indexes.
    try { db.create_function && db.create_function('unicase', (a, b) => (a > b) - (a < b)); } catch {}
    try {
      if (isNewSchema && this._hasNewTables(db)) {
        return this._extractCardsNew(db);
      }
      return this._extractCardsOld(db);
    } finally {
      db.close();
    }
  }

  async _findDb(zip) {
    const anki21b = zip.file('collection.anki21b');
    if (anki21b) {
      const bytes = new Uint8Array(await anki21b.async('uint8array'));
      if (isZstd(bytes)) {
        return [zstdDecompress(bytes), true];
      }
      // Raw SQLite
      return [bytes, true];
    }
    for (const name of ['collection.anki21', 'collection.anki2']) {
      const f = zip.file(name);
      if (f) return [new Uint8Array(await f.async('uint8array')), false];
    }
    throw new Error('No Anki database found in .apkg file');
  }

  _hasNewTables(db) {
    const res = db.exec("SELECT name FROM sqlite_master WHERE type='table'");
    if (!res.length) return false;
    const names = new Set(res[0].values.map(r => r[0]));
    return names.has('notetypes') && names.has('fields') && names.has('decks');
  }

  _detectCardType(name, fieldNames) {
    const lower = (name || '').toLowerCase();
    if (lower.includes('image occlusion')) return 'image_occlusion';
    if (lower.includes('cloze')) return 'cloze';
    if (fieldNames && fieldNames.length && fieldNames[0].toLowerCase() === 'occlusion') {
      return 'image_occlusion';
    }
    return 'basic';
  }

  _rowsToObjects(res) {
    if (!res.length) return [];
    const cols = res[0].columns;
    return res[0].values.map(r => Object.fromEntries(cols.map((c, i) => [c, r[i]])));
  }

  _extractCardsNew(db) {
    // Decks
    const deckNames = new Map();
    for (const row of this._rowsToObjects(db.exec('SELECT id, name FROM decks'))) {
      deckNames.set(Number(row.id), String(row.name).replace(/\x1f/g, '::'));
    }

    // Notetypes
    const notetypeRows = new Map();
    for (const row of this._rowsToObjects(db.exec('SELECT id, name, config FROM notetypes'))) {
      notetypeRows.set(Number(row.id), { name: row.name, config: row.config });
    }

    // Fields per notetype
    const ntFields = new Map();
    for (const row of this._rowsToObjects(db.exec('SELECT ntid, ord, name FROM fields ORDER BY ntid, ord'))) {
      const ntid = Number(row.ntid);
      if (!ntFields.has(ntid)) ntFields.set(ntid, []);
      ntFields.get(ntid).push(row.name);
    }

    this.modelSchemas = [];
    const modelInfo = new Map();
    for (const [ntid, { name, config }] of notetypeRows) {
      const flds = ntFields.get(ntid) || [];
      let isClozeConfig = false;
      if (config && config.length) {
        const bytes = config instanceof Uint8Array ? config : new Uint8Array(config);
        const kind = extractVarintField(bytes, 7);
        if (kind === 1) isClozeConfig = true;
      }
      let cardType;
      if (isClozeConfig) {
        const lower = (name || '').toLowerCase();
        if (lower.includes('image occlusion') || (flds[0] && flds[0].toLowerCase() === 'occlusion')) {
          cardType = 'image_occlusion';
        } else {
          cardType = 'cloze';
        }
      } else {
        cardType = this._detectCardType(name, flds);
      }
      modelInfo.set(ntid, { name, flds, cardType });
      this.modelSchemas.push({ model_id: ntid, model_name: name, field_names: flds, card_type: cardType });
    }

    // Notes
    const notes = new Map();
    for (const row of this._rowsToObjects(db.exec('SELECT id, mid, flds FROM notes'))) {
      notes.set(Number(row.id), [Number(row.mid), row.flds]);
    }

    // Cards
    const cards = [];
    for (const row of this._rowsToObjects(db.exec('SELECT id, nid, did FROM cards ORDER BY ord'))) {
      const cid = Number(row.id), nid = Number(row.nid), did = Number(row.did);
      if (!notes.has(nid)) continue;
      const [mid, fldsStr] = notes.get(nid);
      if (!modelInfo.has(mid)) continue;
      const { name: modelName, flds: fieldNames, cardType } = modelInfo.get(mid);
      const fieldValues = String(fldsStr).split('\x1f');
      const fields = {};
      fieldNames.forEach((fn, i) => { fields[fn] = fieldValues[i] || ''; });
      cards.push({
        card_id: cid, note_id: nid,
        deck_path: deckNames.get(did) || 'Default',
        card_type: cardType,
        model_id: mid, model_name: modelName,
        field_names: fieldNames, fields,
      });
    }
    return cards;
  }

  _extractCardsOld(db) {
    const colRes = this._rowsToObjects(db.exec('SELECT decks, models FROM col'));
    if (!colRes.length) return [];
    const decks = JSON.parse(colRes[0].decks);
    const models = JSON.parse(colRes[0].models);

    const deckNames = new Map();
    for (const [didStr, info] of Object.entries(decks)) {
      deckNames.set(Number(didStr), info.name || 'Default');
    }

    this.modelSchemas = [];
    const modelInfo = new Map();
    for (const [midStr, model] of Object.entries(models)) {
      const mid = Number(midStr);
      const flds = (model.flds || []).map(f => f.name);
      const modelName = model.name || 'Unknown';
      const isCloze = (model.type || 0) === 1;
      const lower = modelName.toLowerCase();
      let cardType;
      if (lower.includes('image occlusion')) cardType = 'image_occlusion';
      else if (isCloze) cardType = 'cloze';
      else cardType = 'basic';
      modelInfo.set(mid, { name: modelName, flds, cardType });
      this.modelSchemas.push({ model_id: mid, model_name: modelName, field_names: flds, card_type: cardType });
    }

    const notes = new Map();
    for (const row of this._rowsToObjects(db.exec('SELECT id, mid, flds FROM notes'))) {
      notes.set(Number(row.id), [Number(row.mid), row.flds]);
    }

    const cards = [];
    for (const row of this._rowsToObjects(db.exec('SELECT id, nid, did FROM cards ORDER BY ord'))) {
      const cid = Number(row.id), nid = Number(row.nid), did = Number(row.did);
      if (!notes.has(nid)) continue;
      const [mid, fldsStr] = notes.get(nid);
      if (!modelInfo.has(mid)) continue;
      const { name: modelName, flds: fieldNames, cardType } = modelInfo.get(mid);
      const fieldValues = String(fldsStr).split('\x1f');
      const fields = {};
      fieldNames.forEach((fn, i) => { fields[fn] = fieldValues[i] || ''; });
      cards.push({
        card_id: cid, note_id: nid,
        deck_path: deckNames.get(did) || 'Default',
        card_type: cardType,
        model_id: mid, model_name: modelName,
        field_names: fieldNames, fields,
      });
    }
    return cards;
  }

  _groupByDeck(cards) {
    const groups = new Map();
    for (const card of cards) {
      const key = card.deck_path;
      if (!groups.has(key)) {
        groups.set(key, { title: key.replace(/::/g, ' / '), cards: [] });
      }
      groups.get(key).cards.push(card);
    }
    return Array.from(groups.values());
  }
}

// ── MediaHandler (base64 URI conversion + mime guess) ────────────
const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4',
  mp4: 'video/mp4', webm: 'video/webm',
};

function guessMime(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  return MIME_BY_EXT[ext] || 'image/png';
}

function bytesToBase64(bytes) {
  // Chunked conversion to avoid stack overflow on large buffers.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export class MediaHandler {
  constructor(parser) { this.parser = parser; }

  getBase64Uri(filename) {
    const bytes = this.parser.getMediaBytes(filename);
    if (!bytes) return null;
    let data = bytes;
    if (isZstd(data)) {
      try { data = zstdDecompress(data); } catch {}
    }
    return `data:${guessMime(filename)};base64,${bytesToBase64(data)}`;
  }

  getRawBytes(filename) {
    const bytes = this.parser.getMediaBytes(filename);
    if (!bytes) return null;
    if (isZstd(bytes)) {
      try { return zstdDecompress(bytes); } catch { return bytes; }
    }
    return bytes;
  }
}
