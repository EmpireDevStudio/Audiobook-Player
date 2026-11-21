/* ==========================================================================
   CADENCE AUDIOBOOK COMMAND CENTRE — CORE ENGINE v3.0 "LUMEN PRO"
   Local-First | Coverage & Recovery | Web Audio EQ & Analyser | Binary Parser
   v3 Upgrades: Virtualized Transcripts + Search, Background-Safe Coverage,
   Wall vs Content Time, FLAC/OGG/ID3v1/Dynamic ID3v2 Parsing, Relink Audio,
   Smart Rewind, Sleep Fade, Month-Nav Calendar, Batch Select, Gap Queue,
   Up Next Queue, Command Palette (Cmd+K), Markdown/CSV Export, Glossary,
   Backlinks, Per-Narrator Profiles, Ambient Cover Palette, Service Worker.
   ========================================================================== */

'use strict';

const APP_CONFIG = {
  appName: 'Cadence',
  version: '3.2.0',
  schemaVersion: 1,
  dbName: 'cadence_audiobook_command_centre',
  defaultPalette: 'graphite',
  defaultThemeMode: 'dark'
};

const BANNER_CONFIG = {
  enabled: false,
  message: '',
  showButton: false,
  buttonText: '',
  buttonUrl: '',
  openInNewTab: false
};

/* --------------------------------------------------------------------------
   1. UTILITIES & GENERATIVE COVER / AMBIENT COLOR HELPERS
   -------------------------------------------------------------------------- */

const Utils = {
  uid(prefix = 'id') {
    if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  },
  clamp(val, min, max) { return Math.min(max, Math.max(min, val)); },
  nextFrame() { return new Promise(resolve => requestAnimationFrame(() => resolve())); },
  haptic(ms = 8) {
    if (window.__cadenceHaptics && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch { /* noop */ }
    }
  },
  formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  },
  formatDurationHuman(sec) {
    if (!Number.isFinite(sec) || sec <= 0) return '0m';
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    if (h === 0) return `${m}m`;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  },
  formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let idx = 0, v = bytes;
    while (v >= 1024 && idx < units.length - 1) { v /= 1024; idx++; }
    return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  },
  localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  },
  dateKeyOffset(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return Utils.localDateKey(d);
  },
  escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);
  },
  initials(title) {
    const words = String(title || 'AB').trim().split(/\s+/).slice(0, 2);
    return words.map(w => w[0]?.toUpperCase() || '').join('') || 'AB';
  },
  hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },
  generativeCoverSvg(title, author = '') {
    const seed = Utils.hashString(`${title}|${author}`);
    const hue1 = seed % 360;
    const hue2 = (hue1 + 42) % 360;
    const ini = Utils.escapeHtml(Utils.initials(title));
    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${Utils.escapeHtml(title)}">
      <defs><linearGradient id="g${seed}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue1},45%,26%)"/><stop offset="100%" stop-color="hsl(${hue2},40%,14%)"/>
      </linearGradient></defs>
      <rect width="200" height="200" fill="url(#g${seed})"/>
      <rect x="14" y="0" width="6" height="200" fill="rgba(255,255,255,0.08)"/>
      <circle cx="150" cy="48" r="${28 + (seed % 26)}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2"/>
      <text x="105" y="114" text-anchor="middle" fill="rgba(255,255,255,0.9)" font-family="system-ui,sans-serif" font-size="46" font-weight="800">${ini}</text>
    </svg>`;
  },
  async extractAccentRgb(dataUrl) {
    if (!dataUrl) return null;
    try {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 16; c.height = 16;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      let rSum = 0, gSum = 0, bSum = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        if (max - min > 28 && max > 55 && min < 220) {
          rSum += r; gSum += g; bSum += b; count++;
        }
      }
      if (!count) return null;
      return `${Math.round(rSum / count)}, ${Math.round(gSum / count)}, ${Math.round(bSum / count)}`;
    } catch { return null; }
  },
  isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false; }
  },
  setRangeFill(input) {
    const min = Number(input.min) || 0, max = Number(input.max) || 1, val = Number(input.value);
    const pct = ((val - min) / Math.max(0.0001, max - min)) * 100;
    input.style.setProperty('--range-fill', `${Utils.clamp(pct, 0, 100)}%`);
  },
  detectCapabilities() {
    const audioTest = document.createElement('audio');
    return {
      indexedDB: typeof indexedDB !== 'undefined',
      opfs: !!(navigator.storage && navigator.storage.getDirectory),
      fileSystemAccess: typeof window.showOpenFilePicker === 'function',
      folderPicker: typeof window.showDirectoryPicker === 'function' || 'webkitdirectory' in document.createElement('input'),
      webAudio: typeof (window.AudioContext || window.webkitAudioContext) === 'function',
      mediaSession: 'mediaSession' in navigator,
      persistentStorage: !!(navigator.storage && navigator.storage.persist),
      serviceWorker: 'serviceWorker' in navigator,
      codecs: {
        mp3: audioTest.canPlayType('audio/mpeg') || 'no',
        m4b: audioTest.canPlayType('audio/mp4; codecs="mp4a.40.2"') || 'no',
        ogg: audioTest.canPlayType('audio/ogg; codecs="opus"') || audioTest.canPlayType('audio/ogg; codecs="vorbis"') || 'no',
        flac: audioTest.canPlayType('audio/flac') || 'no',
        wav: audioTest.canPlayType('audio/wav') || 'no'
      }
    };
  }
};

/* --------------------------------------------------------------------------
   2. TOAST (WITH UNDO SUPPORT) & FOCUS-TRAPPED MODAL SYSTEM
   -------------------------------------------------------------------------- */

const UI = {
  toast(msg, kind = 'info', duration = 3600, undoAction = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${kind === 'error' ? 'is-error' : kind === 'success' ? 'is-success' : ''}`;
    const iconChar = kind === 'error' ? '!' : kind === 'success' ? '✓' : 'i';
    el.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${iconChar}</span>
      <span class="toast-msg">${Utils.escapeHtml(msg)}</span>
      ${undoAction ? `<button type="button" class="btn btn-secondary btn-xs toast-undo-btn">Undo</button>` : ''}
      <span class="toast-progress" style="animation-duration:${duration}ms"></span>
    `;
    let undone = false;
    const dismiss = () => {
      if (!el.isConnected) return;
      el.remove();
    };
    if (undoAction) {
      el.querySelector('.toast-undo-btn').addEventListener('click', () => {
        undone = true;
        undoAction();
        dismiss();
      });
    }
    container.appendChild(el);
    setTimeout(() => { if (!undone) dismiss(); }, duration);
    return () => undone;
  },

  _lastFocus: null,

  openModal({ title, bodyEl, bodyHtml, footerButtons = [], onClose = null }) {
    this._lastFocus = document.activeElement;
    this._onClose = onClose || null;
    const backdrop = document.getElementById('modal-backdrop');
    document.getElementById('modal-title').textContent = title;
    const body = document.getElementById('modal-body');
    const footer = document.getElementById('modal-footer');
    body.innerHTML = '';
    if (bodyEl) body.appendChild(bodyEl);
    else if (bodyHtml) body.innerHTML = bodyHtml;

    footer.innerHTML = '';
    if (footerButtons.length > 0) {
      footer.hidden = false;
      footerButtons.forEach(cfg => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn btn-sm ${cfg.className || 'btn-secondary'}`;
        btn.textContent = cfg.label;
        btn.addEventListener('click', () => cfg.onClick?.());
        footer.appendChild(btn);
      });
    } else {
      footer.hidden = true;
    }
    backdrop.hidden = false;
    document.body.classList.add('is-modal-open');
    document.getElementById('modal-close-btn').focus();
  },

  closeModal() {
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop.hidden) return;
    backdrop.hidden = true;
    document.body.classList.remove('is-modal-open');
    if (this._onClose) { const fn = this._onClose; this._onClose = null; fn(); }
    if (this._lastFocus && typeof this._lastFocus.focus === 'function') this._lastFocus.focus();
  },

  trapFocus(e) {
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop.hidden || e.key !== 'Tab') return;
    const dialog = document.getElementById('modal-dialog');
    const focusables = Array.from(dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!dialog.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  },

  confirm({ title, message, confirmLabel = 'Confirm', danger = false }) {
    return new Promise(resolve => {
      this.openModal({
        title,
        bodyHtml: `<p>${Utils.escapeHtml(message)}</p>`,
        footerButtons: [
          { label: 'Cancel', className: 'btn-secondary', onClick: () => { this.closeModal(); resolve(false); } },
          { label: confirmLabel, className: danger ? 'btn-danger' : 'btn-primary', onClick: () => { this.closeModal(); resolve(true); } }
        ]
      });
    });
  }
};

/* --------------------------------------------------------------------------
   3. DATABASE & OPFS STORAGE LAYER
   -------------------------------------------------------------------------- */

class DatabaseManager {
  constructor() { this.db = null; }
  init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(APP_CONFIG.dbName, APP_CONFIG.schemaVersion);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (e.oldVersion < 1) {
          const books = db.createObjectStore('books', { keyPath: 'id' });
          books.createIndex('title', 'title', { unique: false });
          books.createIndex('lastPlayedAt', 'lastPlayedAt', { unique: false });
          const files = db.createObjectStore('files', { keyPath: 'id' });
          files.createIndex('bookId', 'bookId', { unique: false });
          files.createIndex('hash', 'hash', { unique: false });
          const chapters = db.createObjectStore('chapters', { keyPath: 'id' });
          chapters.createIndex('bookId', 'bookId', { unique: false });
          db.createObjectStore('progress', { keyPath: 'bookId' });
          db.createObjectStore('coverage', { keyPath: 'bookId' });
          const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
          sessions.createIndex('dateKey', 'dateKey', { unique: false });
          sessions.createIndex('bookId', 'bookId', { unique: false });
          const bookmarks = db.createObjectStore('bookmarks', { keyPath: 'id' });
          bookmarks.createIndex('bookId', 'bookId', { unique: false });
          const notes = db.createObjectStore('notes', { keyPath: 'id' });
          notes.createIndex('bookId', 'bookId', { unique: false });
          db.createObjectStore('collections', { keyPath: 'id' });
          db.createObjectStore('transcripts', { keyPath: 'id' });
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  }
  _tx(storeNames, mode = 'readonly') { return this.db.transaction(storeNames, mode); }
  getAll(storeName) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName).objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  get(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName).objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
  getByIndex(storeName, indexName, val) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName).objectStore(storeName).index(indexName).getAll(val);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  put(storeName, record) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').objectStore(storeName).put(record);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }
  putMany(storeName, records) {
    return new Promise((resolve, reject) => {
      if (!records.length) return resolve();
      const tx = this._tx(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      records.forEach(r => store.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  delete(storeName, key) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
  clearStore(storeName) {
    return new Promise((resolve, reject) => {
      const req = this._tx(storeName, 'readwrite').objectStore(storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}

const MediaStorage = {
  async saveAudioCopy(fileId, fileOrBlob) {
    if (navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('cadence_audio', { create: true });
        const fh = await dir.getFileHandle(fileId, { create: true });
        const writable = await fh.createWritable();
        await writable.write(fileOrBlob);
        await writable.close();
        return { storageKind: 'opfs', blob: null };
      } catch { /* fallback */ }
    }
    return { storageKind: 'idb', blob: fileOrBlob };
  },
  async hasAudioAvailable(fileRec) {
    if (!fileRec) return false;
    if (fileRec.storageMode === 'local-copy') {
      if (fileRec.storageKind === 'opfs' && navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle('cadence_audio');
          await dir.getFileHandle(fileRec.id);
          return true;
        } catch { return false; }
      }
      return !!fileRec.blob;
    }
    return fileRec.storageMode === 'reference' && !!fileRec.fileHandle;
  },
  async readAudioFile(fileRec) {
    if (fileRec.storageMode === 'local-copy') {
      if (fileRec.storageKind === 'opfs' && navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle('cadence_audio');
          const fh = await dir.getFileHandle(fileRec.id);
          return await fh.getFile();
        } catch { return null; }
      }
      if (fileRec.blob) return fileRec.blob;
    }
    if (fileRec.storageMode === 'reference' && fileRec.fileHandle) {
      const handle = fileRec.fileHandle;
      if (handle.queryPermission) {
        let perm = await handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted' && handle.requestPermission) perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') throw new Error('PERMISSION_REQUIRED');
      }
      return await handle.getFile();
    }
    return null;
  },
  async deleteAudioCopy(fileRec) {
    if (fileRec.storageKind === 'opfs' && navigator.storage?.getDirectory) {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle('cadence_audio');
        await dir.removeEntry(fileRec.id);
      } catch { /* noop */ }
    }
  }
};

/* --------------------------------------------------------------------------
   4. UPGRADED BINARY METADATA PARSER (Dynamic ID3v2, ID3v1, FLAC, MP4)
   -------------------------------------------------------------------------- */

const MetadataParser = {
  async computeFingerprint(file) {
    const chunkHead = await file.slice(0, Math.min(65536, file.size)).arrayBuffer();
    const chunkTail = file.size > 65536
      ? await file.slice(Math.max(0, file.size - 65536), file.size).arrayBuffer()
      : new ArrayBuffer(0);
    const combined = new Uint8Array(chunkHead.byteLength + chunkTail.byteLength + 8);
    combined.set(new Uint8Array(chunkHead), 0);
    combined.set(new Uint8Array(chunkTail), chunkHead.byteLength);
    new DataView(combined.buffer).setFloat64(chunkHead.byteLength + chunkTail.byteLength, file.size);
    if (crypto.subtle) {
      const digest = await crypto.subtle.digest('SHA-256', combined);
      return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    return `${file.size}_${file.name}`;
  },

  probeDuration(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      a.preload = 'metadata';
      const cleanup = () => { URL.revokeObjectURL(url); a.src = ''; a.removeAttribute('src'); };
      const timer = setTimeout(() => { cleanup(); resolve(0); }, 8000);
      a.onloadedmetadata = () => { clearTimeout(timer); const dur = Number.isFinite(a.duration) ? a.duration : 0; cleanup(); resolve(dur); };
      a.onerror = () => { clearTimeout(timer); cleanup(); resolve(0); };
      a.src = url;
    });
  },

  async resizeArtworkBlob(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const maxDim = 512;
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      bmp.close();
      return canvas.toDataURL('image/jpeg', 0.84);
    } catch { return null; }
  },

  async parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const meta = {
      title: '', author: '', narrator: '', album: '', genre: '', year: '',
      trackNumber: null, discNumber: null, artworkDataUrl: null, chapters: []
    };

    try {
      const peek = new Uint8Array(await file.slice(0, Math.min(file.size, 64)).arrayBuffer());
      if (peek[0] === 0x49 && peek[1] === 0x44 && peek[2] === 0x33) {
        // Dynamic ID3v2 size slice (#25)
        const tagSize = ((peek[6] & 0x7f) << 21) | ((peek[7] & 0x7f) << 14) | ((peek[8] & 0x7f) << 7) | (peek[9] & 0x7f);
        const sliceLen = Math.min(file.size, 10 + tagSize, 16 * 1024 * 1024);
        const bytes = new Uint8Array(await file.slice(0, sliceLen).arrayBuffer());
        await this._parseID3v2(bytes, meta);
      } else if (peek[0] === 0x66 && peek[1] === 0x4C && peek[2] === 0x61 && peek[3] === 0x43) {
        // FLAC metadata blocks (#24)
        await this._parseFLAC(file, meta);
      } else if (ext === 'm4b' || ext === 'm4a' || ext === 'mp4' || this._hasFtyp(peek)) {
        await this._parseMP4(file, meta);
      }

      // ID3v1 footer fallback (#25)
      if (!meta.title && file.size >= 128) {
        const tail = new Uint8Array(await file.slice(file.size - 128, file.size).arrayBuffer());
        if (tail[0] === 0x54 && tail[1] === 0x41 && tail[2] === 0x47) {
          const dec = (s, e) => new TextDecoder('iso-8859-1').decode(tail.subarray(s, e)).replace(/\0/g, '').trim();
          meta.title = dec(3, 33);
          meta.author = meta.author || dec(33, 63);
          meta.album = meta.album || dec(63, 93);
          meta.year = meta.year || dec(93, 97);
        }
      }
    } catch { /* non-fatal */ }

    const duration = await this.probeDuration(file);
    const cleaned = this._cleanFileName(file.name);
    return {
      ...meta,
      duration,
      title: meta.album || meta.title || cleaned.title,
      trackTitle: meta.title || cleaned.title,
      trackNumber: meta.trackNumber ?? cleaned.trackNumber
    };
  },

  _cleanFileName(filename) {
    const base = filename.replace(/\.[^/.]+$/, '').replace(/[_]+/g, ' ').trim();
    const match = base.match(/^(\d{1,3})\s*[-._)]\s*(.+)$/);
    return match ? { trackNumber: parseInt(match[1], 10), title: match[2].trim() } : { trackNumber: null, title: base };
  },

  _hasFtyp(bytes) {
    return bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  },

  _decodeText(bytes, encodingByte) {
    if (!bytes.length) return '';
    try {
      if (encodingByte === 1 || encodingByte === 2) return new TextDecoder(encodingByte === 1 ? 'utf-16' : 'utf-16be').decode(bytes).replace(/\0/g, '').trim();
      if (encodingByte === 3) return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
      return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g, '').trim();
    } catch { return ''; }
  },

  async _parseFLAC(file, meta) {
    const buf = await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer();
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    let pos = 4;
    while (pos + 4 <= bytes.length) {
      const hdr = bytes[pos];
      const isLast = (hdr & 0x80) !== 0;
      const type = hdr & 0x7f;
      const len = (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
      pos += 4;
      if (pos + len > bytes.length) break;
      if (type === 4) {
        // Vorbis comments
        let vp = pos;
        const vendorLen = view.getUint32(vp, true); vp += 4 + vendorLen;
        if (vp + 4 <= pos + len) {
          const count = view.getUint32(vp, true); vp += 4;
          for (let i = 0; i < count && vp + 4 <= pos + len; i++) {
            const cLen = view.getUint32(vp, true); vp += 4;
            if (vp + cLen > pos + len) break;
            const str = new TextDecoder('utf-8').decode(bytes.subarray(vp, vp + cLen));
            vp += cLen;
            const eq = str.indexOf('=');
            if (eq > 0) {
              const k = str.slice(0, eq).toUpperCase(), v = str.slice(eq + 1).trim();
              if (k === 'TITLE') meta.title = v;
              else if (k === 'ALBUM') meta.album = v;
              else if (k === 'ARTIST' || k === 'ALBUMARTIST') meta.author = meta.author || v;
              else if (k === 'NARRATOR' || k === 'COMPOSER') meta.narrator = meta.narrator || v;
              else if (k === 'GENRE') meta.genre = v;
              else if (k === 'DATE' || k === 'YEAR') meta.year = v.slice(0, 4);
              else if (k === 'TRACKNUMBER') meta.trackNumber = parseInt(v, 10) || null;
            }
          }
        }
      } else if (type === 6 && !meta.artworkDataUrl) {
        // METADATA_BLOCK_PICTURE
        let pp = pos + 4;
        const mimeLen = view.getUint32(pp); pp += 4;
        const mime = new TextDecoder('ascii').decode(bytes.subarray(pp, pp + mimeLen)) || 'image/jpeg';
        pp += mimeLen;
        const descLen = view.getUint32(pp); pp += 4 + descLen + 16;
        if (pp + 4 <= pos + len) {
          const picLen = view.getUint32(pp); pp += 4;
          if (pp + picLen <= pos + len) {
            meta.artworkDataUrl = await this.resizeArtworkBlob(new Blob([bytes.subarray(pp, pp + picLen)], { type: mime }));
          }
        }
      }
      pos += len;
      if (isLast) break;
    }
  },

  async _parseID3v2(bytes, meta) {
    if (bytes.length < 10) return;
    const ver = bytes[3];
    const tagSize = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    const limit = Math.min(bytes.length, 10 + tagSize);
    let pos = 10;
    const view = new DataView(bytes.buffer);
    if ((bytes[5] & 0x40) && pos + 4 <= limit) pos += view.getUint32(pos);

    while (pos + 10 <= limit) {
      const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = ver === 4
        ? ((bytes[pos + 4] & 0x7f) << 21) | ((bytes[pos + 5] & 0x7f) << 14) | ((bytes[pos + 6] & 0x7f) << 7) | (bytes[pos + 7] & 0x7f)
        : view.getUint32(pos + 4);
      pos += 10;
      if (size <= 0 || pos + size > limit) break;
      const frame = bytes.subarray(pos, pos + size);

      if (id.startsWith('T') && id !== 'TXXX') {
        const val = this._decodeText(frame.subarray(1), frame[0]);
        if (id === 'TIT2') meta.title = val;
        else if (id === 'TPE1' || id === 'TPE2') meta.author = meta.author || val;
        else if (id === 'TPE3' || id === 'TCOM') meta.narrator = meta.narrator || val;
        else if (id === 'TALB') meta.album = val;
        else if (id === 'TCON') meta.genre = val.replace(/^\(\d+\)/, '').trim();
        else if (id === 'TYER' || id === 'TDRC') meta.year = val.slice(0, 4);
        else if (id === 'TRCK') meta.trackNumber = parseInt(val.split('/')[0], 10) || null;
        else if (id === 'TPOS') meta.discNumber = parseInt(val.split('/')[0], 10) || null;
      } else if (id === 'APIC' && !meta.artworkDataUrl) {
        let idx = 1;
        while (idx < frame.length && frame[idx] !== 0) idx++;
        const mime = new TextDecoder('ascii').decode(frame.subarray(1, idx)) || 'image/jpeg';
        idx += 2;
        if (frame[0] === 1 || frame[0] === 2) {
          while (idx + 1 < frame.length && !(frame[idx] === 0 && frame[idx + 1] === 0)) idx += 2;
          idx += 2;
        } else {
          while (idx < frame.length && frame[idx] !== 0) idx++;
          idx += 1;
        }
        if (idx < frame.length) {
          meta.artworkDataUrl = await this.resizeArtworkBlob(new Blob([frame.subarray(idx)], { type: mime }));
        }
      } else if (id === 'CHAP') {
        let z = 0;
        while (z < frame.length && frame[z] !== 0) z++;
        if (z + 17 <= frame.length) {
          const fv = new DataView(frame.buffer, frame.byteOffset);
          const startMs = fv.getUint32(z + 1);
          const endMs = fv.getUint32(z + 5);
          let chapTitle = `Chapter ${meta.chapters.length + 1}`;
          const subPos = z + 17;
          if (subPos + 10 < frame.length) {
            const subId = String.fromCharCode(frame[subPos], frame[subPos + 1], frame[subPos + 2], frame[subPos + 3]);
            const subSize = ver === 4
              ? ((frame[subPos + 4] & 0x7f) << 21) | ((frame[subPos + 5] & 0x7f) << 14) | ((frame[subPos + 6] & 0x7f) << 7) | (frame[subPos + 7] & 0x7f)
              : fv.getUint32(subPos + 4);
            if (subId === 'TIT2' && subPos + 10 + subSize <= frame.length) {
              const t = this._decodeText(frame.subarray(subPos + 11, subPos + 10 + subSize), frame[subPos + 10]);
              if (t) chapTitle = t;
            }
          }
          meta.chapters.push({ title: chapTitle, start: startMs / 1000, end: endMs / 1000 });
        }
      }
      pos += size;
    }
  },

  async _parseMP4(file, meta) {
    let offset = 0, moovBuffer = null;
    while (offset + 8 <= file.size) {
      const hdr = new DataView(await file.slice(offset, offset + 16).arrayBuffer());
      let size = hdr.getUint32(0);
      const type = String.fromCharCode(hdr.getUint8(4), hdr.getUint8(5), hdr.getUint8(6), hdr.getUint8(7));
      let hdrLen = 8;
      if (size === 1) { size = Number(hdr.getBigUint64(8)); hdrLen = 16; }
      else if (size === 0) { size = file.size - offset; }
      if (size < 8) break;
      if (type === 'moov' && size < 24 * 1024 * 1024) {
        moovBuffer = await file.slice(offset + hdrLen, offset + size).arrayBuffer();
        break;
      }
      offset += size;
    }
    if (!moovBuffer) return;

    const bytes = new Uint8Array(moovBuffer);
    const view = new DataView(moovBuffer);
    const decUtf8 = (s, e) => new TextDecoder('utf-8').decode(bytes.subarray(s, e)).trim();
    const walkAtoms = async (start, end, cb) => {
      let p = start;
      while (p + 8 <= end) {
        const s = view.getUint32(p);
        const t = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
        if (s < 8 || p + s > end) break;
        await cb(t, p + 8, p + s);
        p += s;
      }
    };

    await walkAtoms(0, bytes.length, async (type, s, e) => {
      if (type === 'udta') {
        await walkAtoms(s, e, async (ut, us, ue) => {
          if (ut === 'chpl') {
            const countPos = us + 8;
            if (countPos < ue) {
              const count = bytes[countPos];
              let cp = countPos + 1;
              for (let i = 0; i < count && cp + 9 <= ue; i++) {
                const start100ns = Number(view.getBigUint64(cp));
                const len = bytes[cp + 8]; cp += 9;
                const title = cp + len <= ue ? decUtf8(cp, cp + len) : `Chapter ${i + 1}`;
                cp += len;
                meta.chapters.push({ title: title || `Chapter ${i + 1}`, start: start100ns / 1e7, end: null });
              }
            }
          } else if (ut === 'meta') {
            await walkAtoms(us + 4, ue, async (mt, ms, me) => {
              if (mt === 'ilst') {
                await walkAtoms(ms, me, async (itemType, is, ie) => {
                  await walkAtoms(is, ie, async (dt, ds, de) => {
                    if (dt === 'data' && ds + 8 <= de) {
                      const dataType = view.getUint32(ds);
                      const pStart = ds + 8;
                      if (itemType === '©nam') meta.title = decUtf8(pStart, de);
                      else if (itemType === '©alb') meta.album = decUtf8(pStart, de);
                      else if (itemType === '©ART' || itemType === 'aART') meta.author = meta.author || decUtf8(pStart, de);
                      else if (itemType === '©wrt') meta.narrator = meta.narrator || decUtf8(pStart, de);
                      else if (itemType === '©gen') meta.genre = decUtf8(pStart, de);
                      else if (itemType === '©day') meta.year = decUtf8(pStart, de).slice(0, 4);
                      else if (itemType === 'trkn' && pStart + 4 <= de) meta.trackNumber = view.getUint16(pStart + 2);
                      else if (itemType === 'covr' && !meta.artworkDataUrl) {
                        const mime = dataType === 14 ? 'image/png' : 'image/jpeg';
                        meta.artworkDataUrl = await this.resizeArtworkBlob(new Blob([bytes.subarray(pStart, de)], { type: mime }));
                      }
                    }
                  });
                });
              }
            });
          }
        });
      }
    });
  }
};

/* --------------------------------------------------------------------------
   5. BACKGROUND-SAFE COVERAGE ENGINE (WALL VS CONTENT TIME)
   -------------------------------------------------------------------------- */

const CoverageStates = {
  IDLE: 'IDLE', PREPARING: 'PREPARING', PLAYING: 'PLAYING', PAUSED: 'PAUSED',
  SEEKING: 'SEEKING', BUFFERING: 'BUFFERING', SWITCHING_FILE: 'SWITCHING_FILE',
  ENDED: 'ENDED', INTERRUPTED: 'INTERRUPTED'
};

class CoverageEngine {
  constructor(db) {
    this.db = db;
    this.state = CoverageStates.IDLE;
    this.bookId = null;
    this.bookDuration = 0;
    this.intervals = [];
    this.totalListeningSeconds = 0;
    this.confirmedBookPos = null;
    this.activeSegStart = null;
    this.activeSegEnd = null;
    this.sessionStartWall = null;
    this.sessionAccumWallSeconds = 0;
    this.sessionAccumContentSeconds = 0;
    this.sessionStartCovered = 0;
    this.lastPersistAt = 0;
    this.lastTickWallMs = null;
    this.playbackRate = 1;
    this._activeSessionId = null;
  }

  async loadBook(bookId, bookDuration) {
    await this.flush(true);
    this.bookId = bookId;
    this.bookDuration = Math.max(0, bookDuration || 0);
    const rec = await this.db.get('coverage', bookId);
    this.intervals = rec?.intervals ? this.mergeIntervals(rec.intervals) : [];
    this.totalListeningSeconds = rec?.totalListeningSeconds || 0;
    this.confirmedBookPos = null;
    this.activeSegStart = null;
    this.activeSegEnd = null;
    this.sessionStartWall = null;
    this.sessionAccumWallSeconds = 0;
    this.sessionAccumContentSeconds = 0;
    this.sessionStartCovered = this.getUniqueCoveredSeconds();
    this.lastTickWallMs = null;
    this._activeSessionId = null;
    this.state = CoverageStates.PREPARING;
  }

  setState(newState, bookPos = null) {
    if (!this.bookId) return;
    if ([CoverageStates.SEEKING, CoverageStates.PAUSED, CoverageStates.SWITCHING_FILE, CoverageStates.ENDED, CoverageStates.INTERRUPTED].includes(newState)) {
      this._commitActiveSegment();
      this.confirmedBookPos = null;
      this.lastTickWallMs = null;
    }
    this.state = newState;
    if (newState === CoverageStates.PLAYING && bookPos !== null) {
      this.confirmedBookPos = bookPos;
      this.activeSegStart = bookPos;
      this.activeSegEnd = bookPos;
      this.lastTickWallMs = Date.now();
      if (!this.sessionStartWall) this.sessionStartWall = Date.now();
    }
  }

  recordTick(currentBookPos) {
    if (!this.bookId || this.state !== CoverageStates.PLAYING || !Number.isFinite(currentBookPos)) return;
    const nowMs = Date.now();

    if (this.confirmedBookPos === null) {
      this.confirmedBookPos = currentBookPos;
      this.activeSegStart = currentBookPos;
      this.activeSegEnd = currentBookPos;
      this.lastTickWallMs = nowMs;
      return;
    }

    const delta = currentBookPos - this.confirmedBookPos;
    const wallElapsedSec = this.lastTickWallMs ? Math.max(0.1, (nowMs - this.lastTickWallMs) / 1000) : 1;
    // Upgrade #22: Scale allowed step by actual wall-clock elapsed time (fixes background tab throttling)
    const maxExpectedStep = Math.max(4.0, (wallElapsedSec * this.playbackRate) + 3.0);

    if (delta < -0.5 || delta > maxExpectedStep) {
      this._commitActiveSegment();
      this.confirmedBookPos = currentBookPos;
      this.activeSegStart = currentBookPos;
      this.activeSegEnd = currentBookPos;
      this.lastTickWallMs = nowMs;
      return;
    }

    if (delta > 0) {
      this.activeSegEnd = currentBookPos;
      this.totalListeningSeconds += delta;
      this.sessionAccumContentSeconds += delta;
      // Upgrade #23: Track real wall-clock listening time separately from speed-scaled audio delta
      this.sessionAccumWallSeconds += Math.min(wallElapsedSec, delta / Math.max(0.5, this.playbackRate) + 0.5);
      this.confirmedBookPos = currentBookPos;
    }
    this.lastTickWallMs = nowMs;

    if (nowMs - this.lastPersistAt > 5000) this.flush(false);
  }

  _commitActiveSegment() {
    if (this.activeSegStart !== null && this.activeSegEnd !== null && this.activeSegEnd - this.activeSegStart >= 0.4) {
      const clampedStart = Utils.clamp(this.activeSegStart, 0, this.bookDuration || this.activeSegEnd);
      const clampedEnd = Utils.clamp(this.activeSegEnd, 0, this.bookDuration || this.activeSegEnd);
      if (clampedEnd > clampedStart) this.intervals = this.mergeIntervals([...this.intervals, [clampedStart, clampedEnd]]);
    }
    this.activeSegStart = null;
    this.activeSegEnd = null;
  }

  mergeIntervals(raw) {
    if (!raw || !raw.length) return [];
    const sorted = raw
      .filter(iv => Array.isArray(iv) && iv.length === 2 && iv[1] > iv[0])
      .map(([a, b]) => [Math.round(a * 10) / 10, Math.round(b * 10) / 10])
      .sort((a, b) => a[0] - b[0]);
    if (!sorted.length) return [];
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const prev = merged[merged.length - 1], curr = sorted[i];
      if (curr[0] <= prev[1] + 1.5) prev[1] = Math.max(prev[1], curr[1]);
      else merged.push(curr);
    }
    return merged;
  }

  getLiveIntervals() {
    if (this.activeSegStart !== null && this.activeSegEnd !== null && this.activeSegEnd > this.activeSegStart) {
      return this.mergeIntervals([...this.intervals, [this.activeSegStart, this.activeSegEnd]]);
    }
    return this.intervals;
  }

  getUniqueCoveredSeconds() { return this.getLiveIntervals().reduce((acc, [a, b]) => acc + (b - a), 0); }

  getUnplayedGaps(duration = this.bookDuration, intervals = this.getLiveIntervals()) {
    if (!duration || duration <= 0) return [];
    const gaps = [];
    let cursor = 0;
    for (const [start, end] of intervals) {
      if (start - cursor >= 2) gaps.push([cursor, start]);
      cursor = Math.max(cursor, end);
    }
    if (duration - cursor >= 2) gaps.push([cursor, duration]);
    return gaps;
  }

  async markRangePlayed(start, end) {
    if (!this.bookId || end <= start) return;
    this.intervals = this.mergeIntervals([...this.intervals, [start, end]]);
    await this.flush(false);
  }

  async resetCoverage() {
    if (!this.bookId) return;
    this.intervals = [];
    this.activeSegStart = null; this.activeSegEnd = null;
    this.totalListeningSeconds = 0;
    this._activeSessionId = null;
    await this.db.put('coverage', { bookId: this.bookId, intervals: [], totalListeningSeconds: 0, updatedAt: Date.now() });
  }

  async _persistSession(endSession = false) {
    if (this.sessionAccumWallSeconds < 3 && this.sessionAccumContentSeconds < 3) return;
    const nowCovered = this.getUniqueCoveredSeconds();
    const deltaUnique = Math.max(0, nowCovered - this.sessionStartCovered);
    const now = Date.now(), dateKey = Utils.localDateKey();
    const wallAdd = Math.round(this.sessionAccumWallSeconds || this.sessionAccumContentSeconds);
    const contentAdd = Math.round(this.sessionAccumContentSeconds);

    let rec = null;
    if (this._activeSessionId) {
      rec = await this.db.get('sessions', this._activeSessionId);
      if (rec && (now - (rec.endedAt || 0)) > 10 * 60 * 1000) rec = null;
    }
    if (!rec) {
      rec = (await this.db.getByIndex('sessions', 'bookId', this.bookId))
        .filter(s => s.dateKey === dateKey && now - (s.endedAt || 0) <= 10 * 60 * 1000)
        .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0] || null;
    }

    if (rec) {
      rec.listenedSeconds = Math.round((rec.listenedSeconds || 0) + wallAdd);
      rec.contentSeconds = Math.round((rec.contentSeconds || 0) + contentAdd);
      rec.uniqueCoveredSeconds = Math.round((rec.uniqueCoveredSeconds || 0) + deltaUnique);
      rec.endedAt = now;
      this._activeSessionId = rec.id;
      await this.db.put('sessions', rec);
    } else {
      const id = Utils.uid('sess');
      this._activeSessionId = id;
      await this.db.put('sessions', {
        id, bookId: this.bookId, dateKey,
        startedAt: this.sessionStartWall || now, endedAt: now,
        listenedSeconds: wallAdd, contentSeconds: contentAdd, uniqueCoveredSeconds: Math.round(deltaUnique)
      });
    }
    this.sessionAccumWallSeconds = 0;
    this.sessionAccumContentSeconds = 0;
    this.sessionStartCovered = nowCovered;
    this.sessionStartWall = endSession ? null : now;
  }

  async flush(endSession = false) {
    if (!this.bookId) return;
    const wasPlaying = this.state === CoverageStates.PLAYING;
    const resumePos = this.confirmedBookPos;
    this._commitActiveSegment();
    if (wasPlaying && resumePos !== null && !endSession) {
      this.activeSegStart = resumePos;
      this.activeSegEnd = resumePos;
    }
    this.lastPersistAt = Date.now();
    await this.db.put('coverage', {
      bookId: this.bookId, intervals: this.intervals,
      totalListeningSeconds: this.totalListeningSeconds, updatedAt: Date.now()
    });
    await this._persistSession(endSession);
    if (endSession) this._activeSessionId = null;
  }
}

/* --------------------------------------------------------------------------
   6. AUDIO ENGINE (SMART REWIND, SLEEP FADE, GAP RECOVERY, ANALYSER, PREBUFFER)
   -------------------------------------------------------------------------- */

const EQ_PRESETS = {
  off: { label: 'Off (Native)', bass: 0, mid: 0, voice: 0, treble: 0, enabled: false },
  balanced: { label: 'Balanced', bass: 0, mid: 0, voice: 1.5, treble: 1, enabled: true },
  speech: { label: 'Speech Clarity', bass: -3, mid: 1.5, voice: 4.5, treble: 2, enabled: true },
  warm: { label: 'Warm Narrator', bass: 2.5, mid: 1, voice: 2, treble: -1.5, enabled: true },
  night: { label: 'Night Listening', bass: -2, mid: 0.5, voice: 3, treble: -2.5, enabled: true },
  custom: { label: 'Custom', bass: 0, mid: 0, voice: 0, treble: 0, enabled: true }
};

class AudioEngine {
  constructor(app) {
    this.app = app;
    this.audio = document.getElementById('audio-element');
    this.book = null;
    this.files = [];
    this.chapters = [];
    this.currentFileIndex = 0;
    this.currentObjectUrl = null;
    this._prebufferedUrl = null;
    this._prebufferedIdx = -1;
    this.lastPausedAt = null;
    this.eqState = { preset: 'balanced', bass: 0, mid: 0, voice: 1.5, treble: 1, enabled: true };
    this.ctx = null;
    this.sourceNode = null;
    this.nodes = null;
    this.analyser = null;
    this._eqRaf = null;
    this.sleepTimer = { mode: 'off', endsAt: null, chapterIndex: null, warningShown: false, preFadeVol: null };
    this.gapQueue = [];
    this._bindAudioEvents();
  }

  _bindAudioEvents() {
    const a = this.audio;
    a.preservesPitch = true;

    a.addEventListener('playing', () => {
      this.app.coverage.setState(CoverageStates.PLAYING, this.getBookPosition());
      this.app.renderPlaybackUI();
      this._updateMediaSessionState('playing');
      this._startSpectrumLoop();
    });

    a.addEventListener('pause', () => {
      this.lastPausedAt = Date.now();
      if (this.app.coverage.state !== CoverageStates.SWITCHING_FILE) {
        this.app.coverage.setState(CoverageStates.PAUSED);
        this.saveProgress();
        this.app.coverage.flush(true);
      }
      this.app.renderPlaybackUI();
      this._updateMediaSessionState('paused');
      this._stopSpectrumLoop();
    });

    a.addEventListener('waiting', () => { if (!a.paused) this.app.coverage.setState(CoverageStates.BUFFERING); });
    a.addEventListener('seeking', () => this.app.coverage.setState(CoverageStates.SEEKING));
    a.addEventListener('seeked', () => {
      const pos = this.getBookPosition();
      if (!a.paused) this.app.coverage.setState(CoverageStates.PLAYING, pos);
      else this.app.coverage.setState(CoverageStates.PAUSED);
      this.saveProgress();
      this.app.renderPlaybackUI();
    });
    a.addEventListener('ratechange', () => { this.app.coverage.playbackRate = a.playbackRate || 1; });
    a.addEventListener('volumechange', () => this.app._syncVolumeUI());

    a.addEventListener('timeupdate', () => {
      if (!this.book) return;
      const pos = this.getBookPosition();
      if (!a.paused) {
        this.app.coverage.recordTick(pos);
        this._checkSleepChapterEnd();
        this._checkGapQueueProgress(pos);
        this._maybePrebufferNext();
      }
      this.app.renderPlaybackTick();
    });

    a.addEventListener('ended', async () => {
      if (!this.book) return;
      this.app.coverage.setState(CoverageStates.SWITCHING_FILE);
      if (this.currentFileIndex + 1 < this.files.length) {
        await this.loadFileIndex(this.currentFileIndex + 1, 0, true);
      } else {
        this.app.coverage.setState(CoverageStates.ENDED);
        this.book.completed = true;
        await this.app.db.put('books', this.book);
        await this.saveProgress();
        await this.app.coverage.flush(true);
        if (this.sleepTimer.mode === 'end-book') this.clearSleepTimer();
        this.app.renderPlaybackUI();
        UI.toast(`Finished "${this.book.title}"`, 'success');
        this.app.advanceUpNextQueue();
      }
    });

    a.addEventListener('error', () => {
      this.app.coverage.setState(CoverageStates.INTERRUPTED);
      UI.toast('Audio playback could not decode this file format in your browser.', 'error', 5000);
    });

    setInterval(() => {
      if (this.book && !this.audio.paused && !this.audio.seeking) {
        this.app.coverage.recordTick(this.getBookPosition());
        this._checkSleepCountdown();
      }
    }, 1000);
  }

  initWebAudioIfNeeded() {
    if (!this.eqState.enabled || !this.app.settings.webAudioEnabled) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx) {
      try {
        this.ctx = new AudioCtx();
        this.sourceNode = this.ctx.createMediaElementSource(this.audio);
        const bass = this.ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 120;
        const mid = this.ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 950; mid.Q.value = 0.9;
        const voice = this.ctx.createBiquadFilter(); voice.type = 'peaking'; voice.frequency.value = 3100; voice.Q.value = 1.1;
        const treble = this.ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 8000;
        const limiter = this.ctx.createDynamicsCompressor(); limiter.threshold.value = -3; limiter.ratio.value = 8;
        this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 64;

        this.sourceNode.connect(bass);
        bass.connect(mid); mid.connect(voice); voice.connect(treble);
        treble.connect(limiter); limiter.connect(this.analyser); this.analyser.connect(this.ctx.destination);
        this.nodes = { bass, mid, voice, treble, limiter };
      } catch { this.nodes = null; }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    this.applyEQ();
  }

  _startSpectrumLoop() {
    if (!this.analyser || this._eqRaf) return;
    document.body.classList.add('has-live-eq');
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const step = () => {
      if (this.audio.paused || !this.analyser) { this._stopSpectrumLoop(); return; }
      this.analyser.getByteFrequencyData(data);
      const bars = document.querySelectorAll('.eq-bars i');
      bars.forEach((bar, i) => {
        const val = data[(i * 3) % data.length] || 0;
        bar.style.setProperty('--eq-h', `${Math.max(22, Math.round((val / 255) * 100))}%`);
      });
      this._eqRaf = requestAnimationFrame(step);
    };
    this._eqRaf = requestAnimationFrame(step);
  }

  _stopSpectrumLoop() {
    if (this._eqRaf) { cancelAnimationFrame(this._eqRaf); this._eqRaf = null; }
    document.body.classList.remove('has-live-eq');
  }

  applyEQ() {
    if (!this.nodes) return;
    const active = this.eqState.enabled && this.app.settings.webAudioEnabled;
    this.nodes.bass.gain.value = active ? Utils.clamp(this.eqState.bass, -8, 8) : 0;
    this.nodes.mid.gain.value = active ? Utils.clamp(this.eqState.mid, -8, 8) : 0;
    this.nodes.voice.gain.value = active ? Utils.clamp(this.eqState.voice, -8, 8) : 0;
    this.nodes.treble.gain.value = active ? Utils.clamp(this.eqState.treble, -8, 8) : 0;
  }

  async _maybePrebufferNext() {
    const nextIdx = this.currentFileIndex + 1;
    if (nextIdx >= this.files.length || this._prebufferedIdx === nextIdx) return;
    const remInFile = (this.audio.duration || 0) - (this.audio.currentTime || 0);
    if (remInFile > 0 && remInFile < 15) {
      this._prebufferedIdx = nextIdx;
      try {
        const f = await MediaStorage.readAudioFile(this.files[nextIdx]);
        if (f) this._prebufferedUrl = URL.createObjectURL(f);
      } catch { /* noop */ }
    }
  }

  async loadBook(bookId, autoplay = false, jumpToBookPos = null) {
    const book = await this.app.db.get('books', bookId);
    if (!book) return;
    const files = (await this.app.db.getByIndex('files', 'bookId', bookId)).sort((a, b) => a.orderIndex - b.orderIndex);
    const chapters = (await this.app.db.getByIndex('chapters', 'bookId', bookId)).sort((a, b) => a.orderIndex - b.orderIndex);
    const progress = await this.app.db.get('progress', bookId);

    this.book = book;
    this.files = files;
    this.chapters = chapters;
    this.gapQueue = [];
    this.lastPausedAt = null;
    if (this._prebufferedUrl) { URL.revokeObjectURL(this._prebufferedUrl); this._prebufferedUrl = null; this._prebufferedIdx = -1; }

    await this.app.coverage.loadBook(bookId, book.duration);

    if (!files.length) {
      UI.toast('This book has no playable audio files. Use "Re-link Audio" in Book Details.', 'error', 5000);
      return;
    }

    let targetFileIdx = progress?.currentFileIndex || 0;
    let targetTime = progress?.currentTime || 0;
    if (jumpToBookPos !== null) {
      const mapped = this.mapBookPosToFile(jumpToBookPos);
      targetFileIdx = mapped.fileIndex;
      targetTime = mapped.fileTime;
    }

    // Upgrade #42: Per-Book & Per-Narrator audio profile
    const narratorProf = book.narrator ? this.app.settings.narratorProfiles?.[book.narrator] : null;
    const rate = book.preferredSpeed || narratorProf?.speed || this.app.settings.defaultSpeed || 1;
    if (narratorProf?.eq && !book.preferredEq) {
      this.eqState = { ...this.eqState, ...narratorProf.eq };
    }
    this.audio.playbackRate = rate;
    this.app.coverage.playbackRate = rate;

    await this.loadFileIndex(targetFileIdx, targetTime, autoplay);
    book.lastPlayedAt = Date.now();
    await this.app.db.put('books', book);
    this._setupMediaSession();
    await this.app.refreshData();
    this.app.renderPlaybackUI();
    this.app.renderMiniPlayerVisibility();
  }

  async loadFileIndex(idx, fileTime = 0, autoplay = false) {
    const fileRec = this.files[idx];
    if (!fileRec) return;
    this.currentFileIndex = idx;
    this.app.coverage.setState(CoverageStates.SWITCHING_FILE);

    let nextUrl = null;
    if (this._prebufferedIdx === idx && this._prebufferedUrl) {
      nextUrl = this._prebufferedUrl;
      this._prebufferedUrl = null;
      this._prebufferedIdx = -1;
    } else {
      let blobOrFile = null;
      try { blobOrFile = await MediaStorage.readAudioFile(fileRec); }
      catch (err) {
        if (err.message === 'PERMISSION_REQUIRED') {
          UI.toast('Permission required to read your referenced audio file. Click Play again.', 'error', 5000);
          return;
        }
      }
      if (!blobOrFile) {
        UI.toast(`Audio unavailable for "${fileRec.name}". Use Re-link Audio in Book Details.`, 'error', 5000);
        return;
      }
      nextUrl = URL.createObjectURL(blobOrFile);
    }

    if (this.currentObjectUrl) URL.revokeObjectURL(this.currentObjectUrl);
    this.currentObjectUrl = nextUrl;
    this.audio.src = nextUrl;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return; settled = true; clearTimeout(timer);
        this.audio.removeEventListener('loadedmetadata', finish);
        this.audio.removeEventListener('error', finish);
        if (fileTime > 0 && Number.isFinite(this.audio.duration)) {
          try { this.audio.currentTime = Utils.clamp(fileTime, 0, Math.max(0, this.audio.duration - 0.5)); } catch { /* noop */ }
        }
        resolve();
      };
      const timer = setTimeout(finish, 8000);
      if (this.audio.readyState >= 1) finish();
      else { this.audio.addEventListener('loadedmetadata', finish); this.audio.addEventListener('error', finish); }
    });

    if (autoplay) await this.play();
    else this.app.coverage.setState(CoverageStates.PAUSED);
    this.saveProgress();
  }

  unloadBook() {
    this.pause();
    this.book = null; this.files = []; this.chapters = []; this.currentFileIndex = 0; this.gapQueue = [];
    this.sleepTimer = { mode: 'off', endsAt: null, chapterIndex: null, warningShown: false, preFadeVol: null };
    if (this.currentObjectUrl) { URL.revokeObjectURL(this.currentObjectUrl); this.currentObjectUrl = null; }
    if (this._prebufferedUrl) { URL.revokeObjectURL(this._prebufferedUrl); this._prebufferedUrl = null; }
    this.audio.removeAttribute('src');
    try { this.audio.load(); } catch { /* noop */ }
    document.body.classList.remove('is-audio-playing', 'has-active-book');
    document.title = `${APP_CONFIG.appName} — Audiobook Command Centre`;
  }

  async play() {
    if (!this.book) return;
    this.initWebAudioIfNeeded();
    // Upgrade #28: Smart Rewind on Resume after > 2 min pause
    const rewindSec = this.app.settings.smartRewind || 0;
    if (rewindSec > 0 && this.lastPausedAt && (Date.now() - this.lastPausedAt) > 120000) {
      const pos = this.getBookPosition();
      if (pos > rewindSec) await this.seekToBookPosition(pos - rewindSec);
      this.lastPausedAt = null;
    }
    try { await this.audio.play(); }
    catch { UI.toast('Tap Play again to start audio playback.', 'info'); }
  }

  pause() { this.audio.pause(); }
  togglePlay() { if (this.book) { if (this.audio.paused) this.play(); else this.pause(); } }

  setVolume(v) {
    this.audio.volume = Utils.clamp(v, 0, 1);
    if (this.audio.volume > 0 && this.audio.muted) this.audio.muted = false;
    this.app.settings.volume = this.audio.volume;
    this.app.saveSettings();
    this.app._syncVolumeUI();
  }

  toggleMute() {
    this.audio.muted = !this.audio.muted;
    this.app.settings.muted = this.audio.muted;
    this.app.saveSettings();
    this.app._syncVolumeUI();
  }

  mapBookPosToFile(bookPos) {
    const clamped = Utils.clamp(bookPos, 0, this.book?.duration || bookPos);
    for (let i = 0; i < this.files.length; i++) {
      const f = this.files[i], start = f.startOffset || 0, end = start + (f.duration || 0);
      if (clamped <= end || i === this.files.length - 1) return { fileIndex: i, fileTime: Math.max(0, clamped - start) };
    }
    return { fileIndex: 0, fileTime: 0 };
  }

  getBookPosition() {
    const f = this.files[this.currentFileIndex];
    return f ? (f.startOffset || 0) + (this.audio.currentTime || 0) : 0;
  }

  getCurrentChapter() {
    const pos = this.getBookPosition();
    for (let i = this.chapters.length - 1; i >= 0; i--) {
      if (pos >= this.chapters[i].bookStart - 0.25) return { chapter: this.chapters[i], index: i };
    }
    return { chapter: this.chapters[0] || null, index: 0 };
  }

  async seekToBookPosition(bookPos) {
    if (!this.book) return;
    const wasPlaying = !this.audio.paused;
    this.app.coverage.setState(CoverageStates.SEEKING);
    const { fileIndex, fileTime } = this.mapBookPosToFile(bookPos);
    if (fileIndex !== this.currentFileIndex) await this.loadFileIndex(fileIndex, fileTime, wasPlaying);
    else {
      try { this.audio.currentTime = fileTime; } catch { /* noop */ }
      if (!wasPlaying) this.app.coverage.setState(CoverageStates.PAUSED);
    }
    // Upgrade #30: Sync sleepTimer chapterIndex on intentional manual seek
    if (this.sleepTimer.mode === 'end-chapter') {
      this.sleepTimer.chapterIndex = this.getCurrentChapter().index;
    }
    this.saveProgress();
    this.app.renderPlaybackUI();
  }

  skip(deltaSeconds) { if (this.book) this.seekToBookPosition(this.getBookPosition() + deltaSeconds); }

  jumpChapter(dir) {
    if (!this.chapters.length) return;
    const { index } = this.getCurrentChapter();
    const target = Utils.clamp(index + dir, 0, this.chapters.length - 1);
    this.seekToBookPosition(this.chapters[target].bookStart);
  }

  // Upgrade #43: Batch Gap-Recovery Playback Queue
  async startGapRecoveryQueue(gaps) {
    if (!gaps.length) return;
    this.gapQueue = gaps.map(([s, e]) => [Math.max(0, s - 2), e]);
    const [firstStart] = this.gapQueue[0];
    await this.seekToBookPosition(firstStart);
    if (this.audio.paused) await this.play();
    UI.toast(`Playing ${gaps.length} unplayed gap(s) in sequence.`, 'info');
  }

  async _checkGapQueueProgress(pos) {
    if (!this.gapQueue.length) return;
    const [, end] = this.gapQueue[0];
    if (pos >= end) {
      this.gapQueue.shift();
      if (this.gapQueue.length > 0) {
        await this.seekToBookPosition(this.gapQueue[0][0]);
      } else {
        this.pause();
        UI.toast('All queued unplayed gaps completed!', 'success');
      }
    }
  }

  async setSpeed(rate) {
    rate = Utils.clamp(Math.round(rate * 20) / 20, 0.5, 3.0);
    this.audio.playbackRate = rate;
    this.app.coverage.playbackRate = rate;
    if (this.book) {
      this.book.preferredSpeed = rate;
      await this.app.db.put('books', this.book);
      if (this.book.narrator) {
        this.app.settings.narratorProfiles = this.app.settings.narratorProfiles || {};
        this.app.settings.narratorProfiles[this.book.narrator] = {
          ...(this.app.settings.narratorProfiles[this.book.narrator] || {}), speed: rate
        };
        await this.app.saveSettings();
      }
    }
    Utils.haptic(6);
    this.app.renderPlaybackUI();
  }

  setSleepTimer(mode, minutes = 0) {
    this.clearSleepTimer(false);
    if (mode === 'off') { this.app.renderPlaybackUI(); return; }
    const { index } = this.getCurrentChapter();
    this.sleepTimer = {
      mode, endsAt: mode === 'minutes' ? Date.now() + minutes * 60000 : null,
      chapterIndex: index, warningShown: false, preFadeVol: this.audio.volume
    };
    this.app.renderPlaybackUI();
  }

  clearSleepTimer(rerender = true) {
    if (this.sleepTimer.preFadeVol !== null) this.audio.volume = this.sleepTimer.preFadeVol;
    this.sleepTimer = { mode: 'off', endsAt: null, chapterIndex: null, warningShown: false, preFadeVol: null };
    const warn = document.getElementById('fp-sleep-warning');
    if (warn) warn.hidden = true;
    if (rerender) this.app.renderPlaybackUI();
  }

  _checkSleepCountdown() {
    if (this.sleepTimer.mode !== 'minutes' || !this.sleepTimer.endsAt) return;
    const rem = this.sleepTimer.endsAt - Date.now();
    const warn = document.getElementById('fp-sleep-warning');
    if (rem <= 15000 && rem > 0) {
      if (warn) { warn.hidden = false; warn.textContent = `Sleep timer fading out in ${Math.ceil(rem / 1000)}s`; }
      if (!this.sleepTimer.warningShown) { this.sleepTimer.warningShown = true; UI.toast('Sleep timer fading out soon.', 'info', 4000); }
      // Upgrade #29: Smooth 8-second volume fade-out
      if (rem <= 8000 && this.sleepTimer.preFadeVol !== null) {
        this.audio.volume = Utils.clamp(this.sleepTimer.preFadeVol * (rem / 8000), 0.02, 1);
      }
    } else if (rem <= 0) {
      this.pause();
      this.clearSleepTimer();
      UI.toast('Sleep timer paused playback.');
    }
  }

  _checkSleepChapterEnd() {
    if (this.sleepTimer.mode !== 'end-chapter') return;
    const { index } = this.getCurrentChapter();
    if (index > this.sleepTimer.chapterIndex) {
      this.pause();
      this.clearSleepTimer();
      UI.toast('Sleep timer paused at chapter boundary.');
    }
  }

  async saveProgress() {
    if (!this.book) return;
    const bookPos = this.getBookPosition();
    const prev = await this.app.db.get('progress', this.book.id);
    const rec = {
      bookId: this.book.id, currentFileIndex: this.currentFileIndex, currentTime: this.audio.currentTime || 0,
      bookPosition: bookPos, furthestPosition: Math.max(prev?.furthestPosition || 0, bookPos), updatedAt: Date.now()
    };
    await this.app.db.put('progress', rec);
    this.app.progressMap.set(this.book.id, rec);
  }

  _setupMediaSession() {
    if (!('mediaSession' in navigator) || !this.book) return;
    const artwork = this.book.artworkDataUrl ? [{ src: this.book.artworkDataUrl, sizes: '512x512', type: 'image/jpeg' }] : [];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.book.title, artist: this.book.author || 'Unknown Author',
        album: this.book.series || 'Audiobook', artwork
      });
    } catch { /* noop */ }
    const safe = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* noop */ } };
    safe('play', () => this.play());
    safe('pause', () => this.pause());
    safe('seekbackward', () => this.skip(-this.app.settings.skipBack));
    safe('seekforward', () => this.skip(this.app.settings.skipFwd));
    safe('previoustrack', () => this.jumpChapter(-1));
    safe('nexttrack', () => this.jumpChapter(1));
    safe('seekto', (details) => {
      if (Number.isFinite(details?.seekTime)) this.seekToBookPosition(Utils.clamp(details.seekTime, 0, this.book.duration || details.seekTime));
    });
  }

  _updateMediaSessionState(state) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
    const bookDur = this.book?.duration;
    if (navigator.mediaSession.setPositionState && Number.isFinite(bookDur) && bookDur > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: bookDur, playbackRate: this.audio.playbackRate || 1,
          position: Utils.clamp(this.getBookPosition() || 0, 0, bookDur)
        });
      } catch { /* noop */ }
    }
  }
}

/* --------------------------------------------------------------------------
   7. TRANSCRIPT PARSER & COVERAGE TIMELINE VIEW (WITH CHAPTER TOOLTIPS & PINS)
   -------------------------------------------------------------------------- */

const TranscriptParser = {
  parse(text, fileName = '') {
    const ext = fileName.toLowerCase().endsWith('.srt') ? 'srt' : 'vtt';
    const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n{2,}/);
    const cues = [];
    const timeRe = /(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}:)?(\d{2}):(\d{2})[.,](\d{3})/;
    const toSec = (h, m, s, ms) => (parseInt(h || '0', 10) * 3600) + (parseInt(m, 10) * 60) + parseInt(s, 10) + (parseInt(ms, 10) / 1000);
    for (const block of blocks) {
      const lines = block.split('\n');
      const timeIdx = lines.findIndex(l => timeRe.test(l));
      if (timeIdx === -1) continue;
      const m = lines[timeIdx].match(timeRe);
      if (!m) continue;
      const start = toSec(m[1]?.replace(':', ''), m[2], m[3], m[4]);
      const end = toSec(m[5]?.replace(':', ''), m[6], m[7], m[8]);
      const cueText = lines.slice(timeIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
      if (cueText) cues.push({ start, end, text: cueText });
    }
    return { format: ext, cues };
  }
};

class CoverageTimelineView {
  constructor(app, { onSeek } = {}) {
    this.app = app;
    this.onSeek = onSeek;
    this._signature = '';
    this._scrubRatio = null;
    this._chapters = [];

    this.el = document.createElement('div');
    this.el.className = 'coverage-timeline';
    this.el.setAttribute('role', 'slider');
    this.el.setAttribute('tabindex', '0');
    this.el.setAttribute('aria-valuemin', '0');
    this.el.setAttribute('aria-valuemax', '100');
    this.el.setAttribute('aria-valuenow', '0');

    this._segsLayer = document.createElement('div');
    this._segsLayer.style.cssText = 'position:absolute;inset:0;';
    this.el.appendChild(this._segsLayer);

    this._playhead = document.createElement('div');
    this._playhead.className = 'cov-playhead';
    this._playhead.style.left = '0%';
    this.el.appendChild(this._playhead);

    this._tip = document.createElement('div');
    this._tip.className = 'timeline-tooltip';
    this._tip.hidden = true;
    this.el.appendChild(this._tip);

    this._bindEvents();
  }

  _bindEvents() {
    const el = this.el;
    const ratioFromEvent = (clientX) => {
      const rect = el.getBoundingClientRect();
      return Utils.clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    };
    const secFromRatio = (ratio) => {
      const { min, max } = this._currentScope || { min: 0, max: 0 };
      return min + ratio * Math.max(0, max - min);
    };
    const showTip = (ratio) => {
      const sec = secFromRatio(ratio);
      const ch = [...this._chapters].reverse().find(c => sec >= c.bookStart - 0.25);
      this._tip.hidden = false;
      this._tip.style.left = `${Utils.clamp(ratio * 100, 8, 92)}%`;
      this._tip.textContent = ch ? `${Utils.formatTime(sec)} · ${ch.title}` : Utils.formatTime(sec);
      if (this._scrubRatio !== null) this._playhead.style.left = `${ratio * 100}%`;
    };

    el.addEventListener('pointermove', (e) => { if (!this._scrubbing) showTip(ratioFromEvent(e.clientX)); });
    el.addEventListener('pointerleave', () => { if (!this._scrubbing) this._tip.hidden = true; });
    el.addEventListener('pointerdown', (e) => {
      if (!this.onSeek) return;
      e.preventDefault();
      try { el.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
      this._scrubbing = true; el.classList.add('is-scrubbing');
      this._scrubRatio = ratioFromEvent(e.clientX);
      showTip(this._scrubRatio);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this._scrubbing) return;
      this._scrubRatio = ratioFromEvent(e.clientX);
      showTip(this._scrubRatio);
    });
    const endScrub = (e) => {
      if (!this._scrubbing) return;
      this._scrubbing = false; el.classList.remove('is-scrubbing');
      this._tip.hidden = true; this._scrubRatio = null;
      if (e.type !== 'pointercancel' && this.onSeek) {
        Utils.haptic(6);
        this.onSeek(secFromRatio(ratioFromEvent(e.clientX)));
      }
    };
    el.addEventListener('pointerup', endScrub);
    el.addEventListener('pointercancel', endScrub);

    el.addEventListener('keydown', (e) => {
      if (!this.onSeek) return;
      const { min, max } = this._currentScope || { min: 0, max: 0 };
      const span = Math.max(0, max - min);
      const cur = min + (this._lastRatio ?? 0) * span;
      const step = span > 3600 ? 60 : span > 600 ? 30 : 10;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); this.onSeek(Utils.clamp(cur - step, min, max)); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); this.onSeek(Utils.clamp(cur + step, min, max)); }
      else if (e.key === 'Home') { e.preventDefault(); this.onSeek(min); }
      else if (e.key === 'End') { e.preventDefault(); this.onSeek(max); }
    });
  }

  update(book, chapters, st, isChapterScoped, pins = []) {
    this._chapters = chapters || [];
    const curCh = this.app.player.book?.id === book.id ? this.app.player.getCurrentChapter().chapter : null;
    const minT = isChapterScoped && curCh ? curCh.bookStart : 0;
    const maxT = isChapterScoped && curCh ? curCh.bookEnd : (book.duration || 1);
    this._currentScope = { min: minT, max: maxT };
    const span = Math.max(1, maxT - minT);

    const ratio = Utils.clamp(((st.pos - minT) / span) * 100, 0, 100);
    this._lastRatio = ratio / 100;
    this._playhead.style.left = `${ratio}%`;
    this.el.setAttribute('aria-valuenow', String(Math.round(ratio)));

    const signature = JSON.stringify([st.intervals.length, st.intervals[st.intervals.length - 1] || null, st.gaps.length, minT.toFixed(1), maxT.toFixed(1), chapters.length, pins.length]);
    if (signature === this._signature) return;
    this._signature = signature;

    const layer = this._segsLayer;
    layer.innerHTML = '';

    st.intervals.forEach(([a, b]) => {
      const sa = Utils.clamp(a, minT, maxT), sb = Utils.clamp(b, minT, maxT);
      if (sb <= sa) return;
      const seg = document.createElement('div');
      seg.className = 'cov-seg-played';
      seg.style.left = `${((sa - minT) / span) * 100}%`;
      seg.style.width = `${((sb - sa) / span) * 100}%`;
      layer.appendChild(seg);
    });

    const furthest = Math.max(st.pos, this.app.progressMap.get(book.id)?.furthestPosition || 0);
    st.gaps.forEach(([a, b]) => {
      const sa = Utils.clamp(a, minT, maxT), sb = Utils.clamp(b, minT, maxT);
      if (sb <= sa || sa >= furthest) return;
      const seg = document.createElement('div');
      seg.className = 'cov-seg-gap';
      seg.style.left = `${((sa - minT) / span) * 100}%`;
      seg.style.width = `${((sb - sa) / span) * 100}%`;
      layer.appendChild(seg);
    });

    if (!isChapterScoped) {
      chapters.slice(1).forEach(c => {
        const tick = document.createElement('div');
        tick.className = 'cov-chap-tick';
        tick.style.left = `${((c.bookStart - minT) / span) * 100}%`;
        layer.appendChild(tick);
      });
    }

    // Upgrade #09: Annotation pins on timeline
    pins.forEach(t => {
      if (t < minT || t > maxT) return;
      const pin = document.createElement('div');
      pin.className = 'cov-pin';
      pin.style.left = `${((t - minT) / span) * 100}%`;
      layer.appendChild(pin);
    });
  }
}

/* --------------------------------------------------------------------------
   8. IMPORTER SERVICE & STORAGE QUOTA CHECK (#40)
   -------------------------------------------------------------------------- */

class ImporterService {
  constructor(app) { this.app = app; }
  isAudioFile(name) { return /\.(mp3|m4a|m4b|aac|flac|wav|ogg|opus)$/i.test(name); }

  async processFileEntries(entries) {
    const audioEntries = entries.filter(e => this.isAudioFile(e.file.name));
    if (!audioEntries.length) {
      UI.toast('No supported audio files (.mp3, .m4b, .m4a, .flac, .wav, .ogg, .opus) found.', 'error');
      return;
    }

    UI.openModal({
      title: 'Scanning Audiobooks…',
      bodyHtml: `<p id="import-scan-status">Scanning ${audioEntries.length} file(s) and reading embedded metadata…</p>
                 <div class="progress-bar is-animated"><div id="import-scan-bar" class="progress-fill" style="width:5%"></div></div>`
    });

    const parsed = [];
    const existingFiles = await this.app.db.getAll('files');
    const existingBooks = await this.app.db.getAll('books');

    for (let i = 0; i < audioEntries.length; i++) {
      const { file, path, handle } = audioEntries[i];
      const statusEl = document.getElementById('import-scan-status');
      const barEl = document.getElementById('import-scan-bar');
      if (statusEl) statusEl.textContent = `Reading ${i + 1} of ${audioEntries.length}: ${file.name}`;
      if (barEl) barEl.style.width = `${Math.round(((i + 1) / audioEntries.length) * 100)}%`;
      await Utils.nextFrame();

      const [meta, hash] = await Promise.all([MetadataParser.parseFile(file), MetadataParser.computeFingerprint(file)]);
      const exactDup = existingFiles.find(ef => ef.hash === hash);
      parsed.push({
        file, handle: handle || null, folderPath: path || '', meta, hash,
        exactDuplicateOf: exactDup ? existingBooks.find(b => b.id === exactDup.bookId)?.title || 'Existing Book' : null
      });
    }
    this._showReviewModal(this._groupIntoBooks(parsed, existingBooks));
  }

  _groupIntoBooks(items, existingBooks) {
    const map = new Map();
    for (const item of items) {
      const folderParts = item.folderPath.split('/').filter(Boolean);
      const parentFolder = folderParts.length > 1 ? folderParts[folderParts.length - 2] : '';
      const groupKey = parentFolder ? `dir:${parentFolder}` : `album:${(item.meta.album || item.meta.title).toLowerCase()}`;
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          id: Utils.uid('prop'),
          title: item.meta.album || parentFolder || item.meta.title || 'Untitled Audiobook',
          author: item.meta.author || '', narrator: item.meta.narrator || '',
          genre: item.meta.genre || '', year: item.meta.year || '',
          series: '', seriesIndex: '', artworkDataUrl: item.meta.artworkDataUrl || null, items: []
        });
      }
      const grp = map.get(groupKey);
      if (!grp.artworkDataUrl && item.meta.artworkDataUrl) grp.artworkDataUrl = item.meta.artworkDataUrl;
      if (!grp.author && item.meta.author) grp.author = item.meta.author;
      if (!grp.narrator && item.meta.narrator) grp.narrator = item.meta.narrator;
      grp.items.push(item);
    }

    const groups = Array.from(map.values());
    groups.forEach(g => {
      g.items.sort((a, b) => {
        const da = a.meta.discNumber ?? 0, db = b.meta.discNumber ?? 0;
        if (da !== db) return da - db;
        const ta = a.meta.trackNumber ?? 9999, tb = b.meta.trackNumber ?? 9999;
        if (ta !== tb) return ta - tb;
        return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
      });
      const totalDur = g.items.reduce((s, it) => s + (it.meta.duration || 0), 0);
      const exactDup = g.items.find(it => it.exactDuplicateOf)?.exactDuplicateOf || null;
      const likelyDup = !exactDup
        ? existingBooks.find(b => b.title.toLowerCase() === g.title.toLowerCase() && Math.abs((b.duration || 0) - totalDur) < 15)?.title || null
        : null;
      g.duplicateNote = exactDup ? `Exact file match with "${exactDup}"` : likelyDup ? `Likely duplicate of "${likelyDup}"` : null;
    });
    return groups;
  }

  _showReviewModal(groups) {
    const canRef = groups.every(g => g.items.every(i => !!i.handle));
    const anyDup = groups.some(g => g.items.some(i => i.exactDuplicateOf));
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <div class="glass-secondary" style="padding:12px;border-radius:12px;display:flex;flex-direction:column;gap:8px;">
        <strong>Storage Mode</strong>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:0.85rem;cursor:pointer;">
          <input type="radio" name="import-storage-mode" value="local-copy" checked>
          <span><strong>Store Local Copy</strong> — Saves audio in browser storage (OPFS/IndexedDB) for offline playback.</span>
        </label>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:0.85rem;opacity:${canRef ? 1 : 0.5};">
          <input type="radio" name="import-storage-mode" value="reference" ${canRef ? '' : 'disabled'}>
          <span><strong>Reference Existing Files</strong> — ${canRef ? 'Uses minimal storage via File System Access handle.' : 'Available via Chromium File System Access picker.'}</span>
        </label>
        ${anyDup ? `<label style="display:flex;gap:8px;align-items:center;font-size:0.85rem;cursor:pointer;"><input type="checkbox" id="import-skip-dupes" checked> <span>Skip exact duplicate files during import</span></label>` : ''}
      </div>
      <div id="import-groups-list" class="form-grid"></div>
    `;

    const list = wrap.querySelector('#import-groups-list');
    const renderGroups = () => {
      list.innerHTML = '';
      groups.forEach((g, idx) => {
        const dur = g.items.reduce((s, it) => s + (it.meta.duration || 0), 0);
        const card = document.createElement('div');
        card.className = 'glass-secondary';
        card.style.cssText = 'padding:12px;border-radius:12px;display:flex;flex-direction:column;gap:8px;';
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <strong>Book ${idx + 1} (${g.items.length} file${g.items.length > 1 ? 's' : ''} · ${Utils.formatDurationHuman(dur)})</strong>
            <div>
              ${groups.length > 1 && idx > 0 ? `<button type="button" class="btn btn-ghost btn-xs" data-merge="${idx}">Merge with Previous</button>` : ''}
              ${g.items.length > 1 ? `<button type="button" class="btn btn-ghost btn-xs" data-split="${idx}">Split Each File</button>` : ''}
            </div>
          </div>
          ${g.duplicateNote ? `<p style="color:var(--danger);font-size:0.8rem;">Warning: ${Utils.escapeHtml(g.duplicateNote)}</p>` : ''}
          <div class="form-grid form-grid-2">
            <label class="field-label">Title <input type="text" data-field="title" value="${Utils.escapeHtml(g.title)}"></label>
            <label class="field-label">Author <input type="text" data-field="author" value="${Utils.escapeHtml(g.author)}"></label>
            <label class="field-label">Narrator <input type="text" data-field="narrator" value="${Utils.escapeHtml(g.narrator)}"></label>
            <label class="field-label">Series <input type="text" data-field="series" value="${Utils.escapeHtml(g.series)}"></label>
          </div>
        `;
        card.querySelectorAll('input[data-field]').forEach(inp => {
          inp.addEventListener('input', () => { groups[idx][inp.dataset.field] = inp.value; });
        });
        card.querySelector('[data-merge]')?.addEventListener('click', () => {
          groups[idx - 1].items.push(...groups[idx].items); groups.splice(idx, 1); renderGroups();
        });
        card.querySelector('[data-split]')?.addEventListener('click', () => {
          const splitOut = g.items.map(it => ({
            id: Utils.uid('prop'), title: it.meta.trackTitle || it.file.name, author: g.author, narrator: g.narrator,
            genre: g.genre, year: g.year, series: g.series, seriesIndex: '',
            artworkDataUrl: it.meta.artworkDataUrl || g.artworkDataUrl, items: [it]
          }));
          groups.splice(idx, 1, ...splitOut); renderGroups();
        });
        list.appendChild(card);
      });
    };
    renderGroups();

    UI.openModal({
      title: `Review Proposed Import (${groups.length} Audiobook${groups.length > 1 ? 's' : ''})`,
      bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Confirm Import', className: 'btn-primary',
          onClick: async () => {
            const mode = wrap.querySelector('input[name="import-storage-mode"]:checked')?.value || 'local-copy';
            const skipDupes = wrap.querySelector('#import-skip-dupes')?.checked ?? true;
            await this._commitGroups(groups, mode, skipDupes);
            UI.closeModal();
          }
        }
      ]
    });
  }

  async _commitGroups(groups, storageMode, skipDupes = true) {
    let importedCount = 0, skippedFiles = 0;
    for (const grp of groups) {
      const items = grp.items.filter(it => { if (skipDupes && it.exactDuplicateOf) { skippedFiles++; return false; } return true; });
      if (!items.length) continue;

      const bookId = Utils.uid('book');
      let bookOffset = 0;
      const fileRecs = [], chapRecs = [];

      for (let fi = 0; fi < items.length; fi++) {
        const it = items[fi], fileId = Utils.uid('file'), dur = it.meta.duration || 0;
        let storageMeta = { storageKind: 'reference', blob: null };
        if (storageMode === 'local-copy') storageMeta = await MediaStorage.saveAudioCopy(fileId, it.file);

        fileRecs.push({
          id: fileId, bookId, name: it.file.name, size: it.file.size, type: it.file.type || 'audio/mpeg',
          duration: dur, orderIndex: fi, startOffset: bookOffset, storageMode,
          storageKind: storageMeta.storageKind, blob: storageMeta.blob,
          fileHandle: storageMode === 'reference' ? it.handle : null, hash: it.hash
        });

        if (it.meta.chapters.length > 0 && items.length === 1) {
          it.meta.chapters.forEach((c, ci) => {
            const nextStart = it.meta.chapters[ci + 1]?.start ?? dur;
            const cEnd = c.end && c.end > c.start ? c.end : nextStart;
            chapRecs.push({
              id: Utils.uid('chap'), bookId, fileId, title: c.title || `Chapter ${ci + 1}`,
              orderIndex: chapRecs.length, fileStart: c.start, fileEnd: cEnd,
              bookStart: bookOffset + c.start, bookEnd: bookOffset + cEnd, duration: Math.max(0, cEnd - c.start)
            });
          });
        } else {
          chapRecs.push({
            id: Utils.uid('chap'), bookId, fileId, title: it.meta.trackTitle || `Part ${fi + 1}`,
            orderIndex: chapRecs.length, fileStart: 0, fileEnd: dur,
            bookStart: bookOffset, bookEnd: bookOffset + dur, duration: dur
          });
        }
        bookOffset += dur;
      }

      await this.app.db.put('books', {
        id: bookId, title: grp.title.trim() || 'Untitled Audiobook', author: grp.author.trim(), narrator: grp.narrator.trim(),
        series: grp.series.trim(), seriesIndex: grp.seriesIndex ? Number(grp.seriesIndex) : null,
        genre: grp.genre.trim(), year: grp.year.trim(), language: '', duration: bookOffset, chapterCount: chapRecs.length,
        storageMode, artworkDataUrl: grp.artworkDataUrl || null, addedAt: Date.now(), lastPlayedAt: null,
        completed: false, preferredSpeed: null, transcriptId: null, collectionIds: []
      });
      await this.app.db.putMany('files', fileRecs);
      await this.app.db.putMany('chapters', chapRecs);
      await this.app.db.put('coverage', { bookId, intervals: [], totalListeningSeconds: 0, updatedAt: Date.now() });
      importedCount++;
    }

    await this.app.refreshData();
    let msg = `Imported ${importedCount} audiobook${importedCount === 1 ? '' : 's'}.`;
    if (skippedFiles > 0) msg += ` Skipped ${skippedFiles} duplicate file${skippedFiles > 1 ? 's' : ''}.`;
    UI.toast(msg, 'success');

    // Auto-request persistent storage on local-copy import
    if (storageMode === 'local-copy' && navigator.storage?.persist) {
      try {
        if (!(await navigator.storage.persisted())) await navigator.storage.persist();
      } catch { /* noop */ }
    }

    // Upgrade #40: Storage quota guard
    if (storageMode === 'local-copy' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      if (est.quota && (est.usage / est.quota) > 0.8) {
        UI.toast('Browser storage is over 80% full. Consider enabling Persistent Storage in Settings.', 'error', 5500);
      }
    }
  }
}

/* --------------------------------------------------------------------------
   9. MAIN APPLICATION CONTROLLER
   -------------------------------------------------------------------------- */

class CadenceApp {
  constructor() {
    this.db = new DatabaseManager();
    this.coverage = new CoverageEngine(this.db);
    this.player = new AudioEngine(this);
    this.importer = new ImporterService(this);

    this.route = 'dashboard';
    this.selectedBookId = null;
    this.libraryView = 'grid';
    this.fullPlayerTab = 'chapters';
    this.timelineScope = 'book';
    this.selectedCalendarDate = Utils.localDateKey();
    this.calendarYear = new Date().getFullYear();
    this.calendarMonth = new Date().getMonth();
    this.batchMode = false;
    this.selectedBatchIds = new Set();
    this.transcriptQuery = '';
    this._fpTimelineView = null;
    this._lastSegmentSyncAt = 0;
    this._deferredInstallPrompt = null;
    this._swReg = null;
    this._pendingUpdateReload = false;

    this.books = [];
    this.chaptersMap = new Map();
    this.progressMap = new Map();
    this.coverageMap = new Map();
    this.missingAudioSet = new Set();
    this.collections = [];
    this.bookmarks = [];
    this.notes = [];
    this.sessions = [];
    this.transcriptsMap = new Map();

    this.settings = {
      themeMode: APP_CONFIG.defaultThemeMode,
      palette: APP_CONFIG.defaultPalette,
      defaultSpeed: 1.0,
      smartRewind: 3,
      skipBack: 15,
      skipFwd: 30,
      webAudioEnabled: true,
      hapticsEnabled: true,
      dailyGoalMin: 30,
      weeklyGoalMin: 210,
      monthlyGoalMin: 900,
      volume: 1,
      muted: false,
      librarySort: 'recent-played',
      libraryView: 'grid',
      libraryDensity: 'comfortable',
      upNextQueue: [],
      narratorProfiles: {}
    };
  }

  async start() {
    this._applyBannerConfig();
    await this.db.init();
    await this._loadSettings();
    window.__cadenceHaptics = !!this.settings.hapticsEnabled;
    this.applyTheme();
    this._applyLibraryPrefs();
    this.player.audio.volume = Utils.clamp(this.settings.volume ?? 1, 0, 1);
    this.player.audio.muted = !!this.settings.muted;
    await this.refreshData();
    this._bindGlobalEvents();
    this.navigate('dashboard');
    this._syncVolumeUI();
    this._registerServiceWorker();
    this._initFileLaunchQueue();
  }

  _registerServiceWorker() {
    if (!('serviceWorker' in navigator) || (location.protocol !== 'https:' && location.hostname !== 'localhost')) return;

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      if (this.player?.audio && !this.player.audio.paused) {
        this._pendingUpdateReload = true;
        UI.toast('App update ready — pause playback or reload to apply.', 'info', 8000);
        return;
      }
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      this._swReg = reg;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  }

  _initFileLaunchQueue() {
    if (!('launchQueue' in window)) return;
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams?.files?.length) return;
      const entries = [];
      for (const handle of launchParams.files) {
        try {
          const file = await handle.getFile();
          entries.push({ file, path: file.name, handle });
        } catch { /* noop */ }
      }
      if (entries.length) await this.importer.processFileEntries(entries);
    });
  }

  _syncInstallUI() {
    const btn = document.getElementById('btn-install-pwa');
    if (btn) btn.hidden = !this._deferredInstallPrompt;
  }

  _applyBannerConfig() {
    const el = document.getElementById('dev-banner');
    if (!BANNER_CONFIG.enabled || !BANNER_CONFIG.message) { el.hidden = true; return; }
    document.getElementById('dev-banner-message').textContent = BANNER_CONFIG.message;
    const btn = document.getElementById('dev-banner-btn');
    if (BANNER_CONFIG.showButton && BANNER_CONFIG.buttonText && Utils.isSafeUrl(BANNER_CONFIG.buttonUrl)) {
      btn.hidden = false; btn.textContent = BANNER_CONFIG.buttonText; btn.href = BANNER_CONFIG.buttonUrl;
      if (BANNER_CONFIG.openInNewTab) { btn.target = '_blank'; btn.rel = 'noopener noreferrer'; }
    } else btn.hidden = true;
    el.hidden = false;
  }

  async _loadSettings() {
    const saved = await this.db.get('settings', 'app_settings');
    if (saved?.value) this.settings = { ...this.settings, ...saved.value };
    const eqSaved = await this.db.get('settings', 'eq_state');
    if (eqSaved?.value) this.player.eqState = { ...this.player.eqState, ...eqSaved.value };
  }

  async saveSettings() {
    window.__cadenceHaptics = !!this.settings.hapticsEnabled;
    await this.db.put('settings', { key: 'app_settings', value: this.settings });
  }

  _applyLibraryPrefs() {
    this.libraryView = this.settings.libraryView === 'list' ? 'list' : 'grid';
    document.querySelectorAll('[data-lib-view]').forEach(b => b.classList.toggle('is-active', b.dataset.libView === this.libraryView));
    const sortSel = document.getElementById('lib-sort');
    if (sortSel && Array.from(sortSel.options).some(o => o.value === this.settings.librarySort)) sortSel.value = this.settings.librarySort;
    const density = this.settings.libraryDensity === 'compact' ? 'compact' : 'comfortable';
    document.getElementById('lib-items').dataset.density = density;
    document.getElementById('lib-density-btn').textContent = density === 'compact' ? 'Comfortable' : 'Compact';
  }

  applyTheme() {
    const root = document.documentElement;
    const resolved = this.settings.themeMode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : this.settings.themeMode;
    root.dataset.theme = resolved;
    root.dataset.palette = this.settings.palette;
    root.style.colorScheme = resolved;
    const bgHex = getComputedStyle(root).getPropertyValue('--bg-base').trim() || '#0b0d12';
    const accHex = getComputedStyle(root).getPropertyValue('--accent').trim() || '#d6b785';
    document.getElementById('theme-color-meta')?.setAttribute('content', bgHex);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${encodeURIComponent(bgHex)}"/><circle cx="32" cy="32" r="18" fill="none" stroke="${encodeURIComponent(accHex)}" stroke-width="4"/><polygon points="28,23 44,32 28,41" fill="${encodeURIComponent(accHex)}"/></svg>`;
    document.getElementById('app-favicon')?.setAttribute('href', `data:image/svg+xml,${svg}`);
  }

  async refreshData() {
    const [books, files, chapters, progresses, coverages, collections, bookmarks, notes, sessions, transcripts] = await Promise.all([
      this.db.getAll('books'), this.db.getAll('files'), this.db.getAll('chapters'),
      this.db.getAll('progress'), this.db.getAll('coverage'), this.db.getAll('collections'),
      this.db.getAll('bookmarks'), this.db.getAll('notes'), this.db.getAll('sessions'), this.db.getAll('transcripts')
    ]);

    this.books = books;
    this.collections = collections.sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    this.bookmarks = bookmarks.sort((a, b) => b.createdAt - a.createdAt);
    this.notes = notes.sort((a, b) => b.createdAt - a.createdAt);
    this.sessions = sessions;

    this.chaptersMap.clear();
    chapters.forEach(c => {
      if (!this.chaptersMap.has(c.bookId)) this.chaptersMap.set(c.bookId, []);
      this.chaptersMap.get(c.bookId).push(c);
    });
    this.chaptersMap.forEach(arr => arr.sort((a, b) => a.orderIndex - b.orderIndex));

    const filesByBook = new Map();
    files.forEach(f => {
      if (!filesByBook.has(f.bookId)) filesByBook.set(f.bookId, []);
      filesByBook.get(f.bookId).push(f);
    });
    this.missingAudioSet.clear();
    for (const b of books) {
      const bf = filesByBook.get(b.id) || [];
      if (!bf.length || !(await MediaStorage.hasAudioAvailable(bf[0]))) this.missingAudioSet.add(b.id);
    }

    this.progressMap = new Map(progresses.map(p => [p.bookId, p]));
    this.coverageMap = new Map(coverages.map(c => [c.bookId, c]));
    this.transcriptsMap = new Map(transcripts.map(t => [t.bookId, t]));
    this.renderCurrentRoute();
  }

  getBookStats(book) {
    const prog = this.progressMap.get(book.id);
    const covRec = this.coverageMap.get(book.id);
    const liveIntervals = this.player.book?.id === book.id ? this.coverage.getLiveIntervals() : (covRec?.intervals || []);
    const coveredSec = liveIntervals.reduce((s, [a, b]) => s + (b - a), 0);
    const dur = book.duration || 0;
    const covPct = dur > 0 ? Utils.clamp((coveredSec / dur) * 100, 0, 100) : 0;
    const pos = this.player.book?.id === book.id ? this.player.getBookPosition() : (prog?.bookPosition || 0);
    const gaps = this.coverage.getUnplayedGaps(dur, liveIntervals);
    return { pos, coveredSec, covPct, intervals: liveIntervals, gaps, listenedSec: covRec?.totalListeningSeconds || 0 };
  }

  navigate(route, bookId = null) {
    const swap = () => {
      this.route = route;
      if (bookId) this.selectedBookId = bookId;
      document.querySelectorAll('.view').forEach(v => { v.hidden = true; v.classList.remove('is-active'); });
      const target = document.getElementById(`view-${route}`);
      if (target) { target.hidden = false; target.classList.add('is-active'); }
      const navRoute = route === 'book-detail' ? 'library' : route;
      document.querySelectorAll('[data-route]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.route === navRoute));
      const titles = { dashboard: 'Command Centre', library: 'Audiobook Library', 'book-detail': 'Audiobook Details', vault: 'Knowledge Vault', stats: 'Statistics & History', settings: 'Settings' };
      document.getElementById('mobile-page-title').textContent = titles[route] || 'Cadence';
      window.scrollTo({ top: 0 });
      this.renderCurrentRoute();
    };
    if (document.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.startViewTransition(swap);
    } else {
      swap();
    }
  }

  renderCurrentRoute() {
    if (this.route === 'dashboard') this.renderDashboard();
    else if (this.route === 'library') this.renderLibrary();
    else if (this.route === 'book-detail') this.renderBookDetail();
    else if (this.route === 'vault') this.renderVault();
    else if (this.route === 'stats') this.renderStats();
    else if (this.route === 'settings') this.renderSettings();
  }

  _coverHtml(book, cls = '') {
    return book.artworkDataUrl
      ? `<img class="${cls}" src="${book.artworkDataUrl}" alt="${Utils.escapeHtml(book.title)}" loading="lazy">`
      : `<div class="${cls} cover-placeholder">${Utils.generativeCoverSvg(book.title, book.author)}</div>`;
  }

  /* ------------------------------------------------------------------------
     RENDER: COMMAND CENTRE (WITH "PREVIOUSLY ON..." RECAP #46)
     ------------------------------------------------------------------------ */
  renderDashboard() {
    const emptyEl = document.getElementById('dashboard-empty');
    const gridEl = document.getElementById('dashboard-content');
    if (!this.books.length) { emptyEl.hidden = false; gridEl.hidden = true; return; }
    emptyEl.hidden = true; gridEl.hidden = false;

    const activeBook = this.player.book
      || [...this.books].sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)).find(b => b.lastPlayedAt)
      || this.books[0];

    const hero = document.getElementById('dash-continue-card');
    if (activeBook) {
      hero.hidden = false;
      const st = this.getBookStats(activeBook);
      const rem = Math.max(0, (activeBook.duration || 0) - st.pos);
      const isCurrent = this.player.book?.id === activeBook.id;
      hero.innerHTML = `
        <div class="panel-head">
          <span class="eyebrow">Continue Listening</span>
          <span class="tabular" style="font-size:0.78rem;color:var(--text-secondary);">${st.covPct.toFixed(0)}% unique coverage</span>
        </div>
        <div class="hero-inner">
          ${this._coverHtml(activeBook, 'hero-cover glow-backlight')}
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;">
            <div>
              <h2 style="font-size:var(--text-lg);">${Utils.escapeHtml(activeBook.title)}</h2>
              <p style="font-size:var(--text-sm);color:var(--text-secondary);">${Utils.escapeHtml(activeBook.author || 'Unknown Author')}</p>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${st.covPct.toFixed(1)}%"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--text-secondary);" class="tabular">
              <span>Pos ${Utils.formatTime(st.pos)}</span>
              <span>${Utils.formatDurationHuman(rem)} left</span>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              <button type="button" class="btn btn-primary btn-sm" id="dash-resume-btn">${isCurrent ? 'Pause / Play' : 'Resume Playback'}</button>
              <button type="button" class="btn btn-secondary btn-sm" id="dash-open-detail-btn">Book Details</button>
            </div>
          </div>
        </div>
      `;
      hero.querySelector('#dash-resume-btn').addEventListener('click', () => {
        if (this.player.book?.id === activeBook.id) this.player.togglePlay();
        else this.player.loadBook(activeBook.id, true);
      });
      hero.querySelector('#dash-open-detail-btn').addEventListener('click', () => this.navigate('book-detail', activeBook.id));
    } else hero.hidden = true;

    // Upgrade #46: "Previously On..." Recap when away > 24h
    const recapPanel = document.getElementById('dash-recap-panel');
    if (activeBook && activeBook.lastPlayedAt && (Date.now() - activeBook.lastPlayedAt) > 24 * 3600 * 1000 && this.player.book?.id !== activeBook.id) {
      const st = this.getBookStats(activeBook);
      const recentNotes = this.notes.filter(n => n.bookId === activeBook.id).slice(0, 2);
      const recentBms = this.bookmarks.filter(b => b.bookId === activeBook.id).slice(0, 2);
      recapPanel.hidden = false;
      recapPanel.innerHTML = `
        <div class="panel-head">
          <div><span class="eyebrow">Previously On…</span><h2>Welcome Back to ${Utils.escapeHtml(activeBook.title)}</h2></div>
          <button type="button" class="btn btn-primary btn-sm" id="recap-replay-btn">Replay Last 20s</button>
        </div>
        <p class="setting-desc">You paused at ${Utils.formatTime(st.pos)} over 24 hours ago. ${recentNotes.length || recentBms.length ? 'Here are your most recent captures:' : 'Jump back 20 seconds to catch the thread.'}</p>
        ${recentNotes.map(n => `<div class="list-item-row"><span><strong>${Utils.escapeHtml(n.type)}</strong>: ${Utils.escapeHtml(n.text.slice(0, 90))}</span><span class="setting-desc tabular">${Utils.formatTime(n.bookTime)}</span></div>`).join('')}
        ${recentBms.map(b => `<div class="list-item-row"><span><strong>Bookmark</strong>: ${Utils.escapeHtml(b.title)}</span><span class="setting-desc tabular">${Utils.formatTime(b.bookTime)}</span></div>`).join('')}
      `;
      recapPanel.querySelector('#recap-replay-btn').addEventListener('click', () => this.player.loadBook(activeBook.id, true, Math.max(0, st.pos - 20)));
    } else recapPanel.hidden = true;

    const todayKey = Utils.localDateKey();
    const todaySec = this.sessions.filter(s => s.dateKey === todayKey).reduce((a, b) => a + b.listenedSeconds, 0);
    const totalUnique = this.books.reduce((s, b) => s + this.getBookStats(b).coveredSec, 0);
    const goalPct = Utils.clamp(((todaySec / 60) / (this.settings.dailyGoalMin || 30)) * 100, 0, 100);

    document.getElementById('dash-metrics-panel').innerHTML = `
      <div class="panel-head"><h2>Daily Goal &amp; Library</h2><button type="button" class="btn btn-ghost btn-xs" id="dash-goto-stats">Full Stats</button></div>
      <div class="goal-wrap">
        <div class="goal-ring" style="--pct:${goalPct.toFixed(1)}" role="img" aria-label="Daily goal ${goalPct.toFixed(0)} percent">
          <span class="goal-ring-inner"><span class="goal-ring-val tabular">${goalPct.toFixed(0)}%</span><span class="goal-ring-lbl">of goal</span></span>
        </div>
        <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;">
            <span>Today: <strong class="tabular">${Math.round(todaySec / 60)}m</strong> / ${this.settings.dailyGoalMin}m</span>
            <span class="tabular" style="color:var(--text-secondary);">${goalPct >= 100 ? 'Goal reached' : `${Math.max(1, Math.round(this.settings.dailyGoalMin - todaySec / 60))}m to go`}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${goalPct}%"></div></div>
        </div>
      </div>
      <div class="metric-pair-grid">
        <div class="metric-tile"><span class="metric-val">${this.books.length}</span><span class="metric-lbl">Audiobooks</span></div>
        <div class="metric-tile"><span class="metric-val">${Utils.formatDurationHuman(totalUnique)}</span><span class="metric-lbl">Unique Covered</span></div>
      </div>
    `;
    document.getElementById('dash-goto-stats').addEventListener('click', () => this.navigate('stats'));

    const unfinished = this.books.filter(b => !b.completed && this.getBookStats(b).pos > 5).slice(0, 4);
    const unfinPanel = document.getElementById('dash-unfinished-panel');
    unfinPanel.hidden = unfinished.length === 0;
    if (unfinished.length) {
      unfinPanel.innerHTML = `<div class="panel-head"><h2>In Progress</h2></div>` +
        unfinished.map(b => {
          const st = this.getBookStats(b), isCurrent = this.player.book?.id === b.id;
          return `<div class="list-item-row${isCurrent ? ' is-active' : ''}">
            <div style="min-width:0;"><strong>${Utils.escapeHtml(b.title)}</strong><div class="setting-desc">${st.covPct.toFixed(0)}% covered · ${st.gaps.filter(([a]) => a < st.pos).length} gap(s)</div></div>
            <button type="button" class="btn btn-secondary btn-xs" data-play-book="${b.id}">${isCurrent ? 'Open' : 'Play'}</button>
          </div>`;
        }).join('');
      unfinPanel.querySelectorAll('[data-play-book]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (this.player.book?.id === btn.dataset.playBook) { document.getElementById('full-player').hidden = false; this.renderPlaybackUI(); }
          else this.player.loadBook(btn.dataset.playBook, true);
        });
      });
    }

    const recentAdded = [...this.books].sort((a, b) => b.addedAt - a.addedAt).slice(0, 4);
    const recPanel = document.getElementById('dash-recent-added-panel');
    recPanel.hidden = !recentAdded.length;
    recPanel.innerHTML = `<div class="panel-head"><h2>Recently Added</h2><button type="button" class="btn btn-ghost btn-xs" id="dash-goto-lib">View All</button></div>` +
      recentAdded.map(b => `<div class="list-item-row">
        <div style="min-width:0;"><strong>${Utils.escapeHtml(b.title)}</strong><div class="setting-desc">${Utils.escapeHtml(b.author || 'Unknown Author')} · ${Utils.formatDurationHuman(b.duration)}</div></div>
        <button type="button" class="btn btn-ghost btn-xs" data-detail-book="${b.id}">Open</button>
      </div>`).join('');
    recPanel.querySelector('#dash-goto-lib')?.addEventListener('click', () => this.navigate('library'));
    recPanel.querySelectorAll('[data-detail-book]').forEach(btn => btn.addEventListener('click', () => this.navigate('book-detail', btn.dataset.detailBook)));

    const colPanel = document.getElementById('dash-collections-panel');
    colPanel.innerHTML = `<div class="panel-head"><h2>Collections</h2><button type="button" class="btn btn-ghost btn-xs" id="dash-new-col">+ Create</button></div>` +
      (this.collections.length
        ? this.collections.slice(0, 4).map(c => `<div class="list-item-row"><span>${Utils.escapeHtml(c.name)}</span><span class="setting-desc">${this.books.filter(b => b.collectionIds?.includes(c.id)).length} book(s)</span></div>`).join('')
        : `<p class="setting-desc">Organise books into personal shelves like Philosophy, History, or Currently Studying.</p>`);
    colPanel.querySelector('#dash-new-col').addEventListener('click', () => this.openCreateCollectionModal());

    const vaultPanel = document.getElementById('dash-vault-panel');
    const recentVault = [...this.notes.slice(0, 2), ...this.bookmarks.slice(0, 2)].slice(0, 3);
    vaultPanel.innerHTML = `<div class="panel-head"><h2>Knowledge Vault</h2><button type="button" class="btn btn-ghost btn-xs" id="dash-goto-vault">Open Vault</button></div>` +
      (recentVault.length
        ? recentVault.map(entry => {
            const bk = this.books.find(b => b.id === entry.bookId);
            return `<div class="list-item-row"><div style="min-width:0;"><strong>${Utils.escapeHtml(entry.title || entry.text?.slice(0, 48) || 'Note')}</strong><div class="setting-desc">${Utils.escapeHtml(bk?.title || '')} · ${Utils.formatTime(entry.bookTime)}</div></div></div>`;
          }).join('')
        : `<p class="setting-desc">Capture timestamped bookmarks, quotes, and connected ideas while listening.</p>`);
    vaultPanel.querySelector('#dash-goto-vault').addEventListener('click', () => this.navigate('vault'));
  }

  /* ------------------------------------------------------------------------
     RENDER: LIBRARY (WITH BATCH SELECT & COMPACT DENSITY)
     ------------------------------------------------------------------------ */
  renderLibrary() {
    const colSel = document.getElementById('lib-filter-collection');
    const curCol = colSel.value;
    colSel.innerHTML = `<option value="all">All Collections</option>` + this.collections.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('');
    if (Array.from(colSel.options).some(o => o.value === curCol)) colSel.value = curCol;

    const seriesSet = [...new Set(this.books.map(b => b.series).filter(Boolean))].sort();
    const serSel = document.getElementById('lib-filter-series');
    const curSer = serSel.value;
    serSel.innerHTML = `<option value="all">All Series</option>` + seriesSet.map(s => `<option value="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</option>`).join('');
    if (Array.from(serSel.options).some(o => o.value === curSer)) serSel.value = curSer;

    const strip = document.getElementById('lib-collections-strip');
    strip.hidden = !this.collections.length;
    strip.innerHTML = this.collections.map(c => `<button type="button" class="pill-chip ${colSel.value === c.id ? 'is-active' : ''}" data-col-chip="${c.id}">${Utils.escapeHtml(c.name)}</button>`).join('');
    strip.querySelectorAll('[data-col-chip]').forEach(ch => ch.addEventListener('click', () => {
      colSel.value = colSel.value === ch.dataset.colChip ? 'all' : ch.dataset.colChip; this.renderLibrary();
    }));

    const seriesPanel = document.getElementById('lib-series-panel');
    if (serSel.value !== 'all') {
      const serBooks = this.books.filter(b => b.series === serSel.value).sort((a, b) => (a.seriesIndex ?? 999) - (b.seriesIndex ?? 999));
      const completedInSeries = serBooks.filter(b => b.completed).length;
      const nextBook = serBooks.find(b => !b.completed);
      seriesPanel.hidden = false;
      seriesPanel.innerHTML = `<div class="panel-head"><strong>Series: ${Utils.escapeHtml(serSel.value)} (${completedInSeries}/${serBooks.length} completed)</strong>${nextBook ? `<button type="button" class="btn btn-primary btn-xs" id="series-play-next">Play Next: ${Utils.escapeHtml(nextBook.title)}</button>` : ''}</div>`;
      seriesPanel.querySelector('#series-play-next')?.addEventListener('click', () => this.player.loadBook(nextBook.id, true));
    } else seriesPanel.hidden = true;

    const q = document.getElementById('lib-search').value.trim().toLowerCase();
    const statusFilter = document.getElementById('lib-filter-status').value;
    const sortBy = document.getElementById('lib-sort').value;

    const filtered = this.books.filter(b => {
      if (q && !`${b.title} ${b.author} ${b.narrator} ${b.series} ${b.genre}`.toLowerCase().includes(q)) return false;
      if (colSel.value !== 'all' && !b.collectionIds?.includes(colSel.value)) return false;
      if (serSel.value !== 'all' && b.series !== serSel.value) return false;
      const st = this.getBookStats(b);
      if (statusFilter === 'completed' && !b.completed) return false;
      if (statusFilter === 'in-progress' && (b.completed || st.pos <= 0)) return false;
      if (statusFilter === 'unstarted' && (b.completed || st.pos > 0)) return false;
      if (statusFilter === 'has-gaps' && st.gaps.filter(([a, c]) => a < st.pos && c - a > 10).length === 0) return false;
      if (statusFilter === 'missing-audio' && !this.missingAudioSet.has(b.id)) return false;
      return true;
    });

    filtered.sort((a, b) => {
      if (sortBy === 'recent-played') return (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0);
      if (sortBy === 'recent-added') return (b.addedAt || 0) - (a.addedAt || 0);
      if (sortBy === 'title') return a.title.localeCompare(b.title);
      if (sortBy === 'author') return (a.author || '').localeCompare(b.author || '');
      if (sortBy === 'duration-desc') return (b.duration || 0) - (a.duration || 0);
      if (sortBy === 'coverage-desc') return this.getBookStats(b).covPct - this.getBookStats(a).covPct;
      return 0;
    });

    document.getElementById('lib-batch-bar').hidden = !this.batchMode;
    document.getElementById('lib-batch-count').textContent = `${this.selectedBatchIds.size} selected`;

    const emptyEl = document.getElementById('lib-empty');
    const listEl = document.getElementById('lib-items');
    listEl.className = this.libraryView === 'grid' ? 'library-grid' : 'library-list';
    if (!filtered.length) {
      emptyEl.hidden = false;
      document.getElementById('lib-empty-msg').textContent = this.books.length ? 'No audiobooks match the current search and filters.' : 'Import local audio files or folders to populate your library.';
      listEl.innerHTML = ''; return;
    }
    emptyEl.hidden = true;

    listEl.innerHTML = filtered.map(b => {
      const st = this.getBookStats(b), isCurrent = this.player.book?.id === b.id, isMissing = this.missingAudioSet.has(b.id);
      const isSel = this.selectedBatchIds.has(b.id);
      const covImg = this._coverHtml(b);
      if (this.libraryView === 'list') {
        return `<article class="book-list-row glass-secondary${isCurrent ? ' is-active' : ''}${isSel ? ' is-selected' : ''}">
          ${this.batchMode ? `<input type="checkbox" class="batch-check" data-batch-id="${b.id}" ${isSel ? 'checked' : ''} aria-label="Select ${Utils.escapeHtml(b.title)}">` : ''}
          <div class="book-list-thumb" style="overflow:hidden;cursor:pointer;" data-open-detail="${b.id}">${covImg}</div>
          <div class="book-list-main">
            <strong>${Utils.escapeHtml(b.title)}</strong> ${isMissing ? `<span class="vault-badge" style="background:var(--danger-soft);color:var(--danger);">Needs Audio</span>` : ''}
            <div class="setting-desc">${Utils.escapeHtml(b.author || 'Unknown Author')}${b.narrator ? ` · ${Utils.escapeHtml(b.narrator)}` : ''}</div>
            <div style="display:flex;gap:12px;align-items:center;margin-top:6px;">
              <div class="progress-bar" style="flex:1;max-width:220px;"><div class="progress-fill" style="width:${st.covPct.toFixed(1)}%"></div></div>
              <span class="setting-desc tabular">${st.covPct.toFixed(0)}% · ${Utils.formatDurationHuman(b.duration)}</span>
            </div>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-primary btn-sm" data-play="${b.id}">${isCurrent && !this.player.audio.paused ? 'Pause' : 'Play'}</button>
            <button type="button" class="btn btn-secondary btn-sm" data-open-detail="${b.id}">Details</button>
          </div>
        </article>`;
      }
      return `<article class="book-card glass-secondary${isCurrent ? ' is-active' : ''}${isSel ? ' is-selected' : ''}">
        <div class="book-card-cover-wrap" data-open-detail="${b.id}">
          ${covImg}
          ${this.batchMode ? `<input type="checkbox" class="book-card-check" data-batch-id="${b.id}" ${isSel ? 'checked' : ''} aria-label="Select ${Utils.escapeHtml(b.title)}">` : ''}
          ${isMissing ? `<span class="book-card-missing">Relink</span>` : ''}
          <span class="book-card-badge">${st.covPct.toFixed(0)}%</span>
          ${isCurrent ? `<span class="book-card-playing"><span class="eq-bars" style="height:11px;" aria-hidden="true"><i></i><i></i><i></i><i></i></span></span>` : ''}
        </div>
        <div>
          <h3 class="book-card-title" data-open-detail="${b.id}">${Utils.escapeHtml(b.title)}</h3>
          <p class="book-card-author">${Utils.escapeHtml(b.author || 'Unknown Author')}</p>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${st.covPct.toFixed(1)}%"></div></div>
        <div class="book-card-actions">
          <button type="button" class="btn btn-primary btn-sm" style="flex:1;" data-play="${b.id}">${isCurrent && !this.player.audio.paused ? 'Pause' : 'Play'}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-open-detail="${b.id}">Info</button>
        </div>
      </article>`;
    }).join('');

    listEl.querySelectorAll('[data-batch-id]').forEach(cb => {
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cb.checked) this.selectedBatchIds.add(cb.dataset.batchId);
        else this.selectedBatchIds.delete(cb.dataset.batchId);
        document.getElementById('lib-batch-count').textContent = `${this.selectedBatchIds.size} selected`;
        cb.closest('article')?.classList.toggle('is-selected', cb.checked);
      });
    });
    listEl.querySelectorAll('[data-play]').forEach(btn => btn.addEventListener('click', () => {
      if (this.player.book?.id === btn.dataset.play) this.player.togglePlay();
      else this.player.loadBook(btn.dataset.play, true);
    }));
    listEl.querySelectorAll('[data-open-detail]').forEach(el => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-batch-id]')) return;
      this.navigate('book-detail', el.dataset.openDetail);
    }));
  }

  /* ------------------------------------------------------------------------
     RENDER: BOOK DETAIL (RELINK AUDIO, CHAPTER EDITOR, GAP RECOVERY QUEUE)
     ------------------------------------------------------------------------ */
  renderBookDetail() {
    const book = this.books.find(b => b.id === this.selectedBookId);
    const container = document.getElementById('book-detail-container');
    if (!book) { container.innerHTML = `<p>Book not found.</p>`; return; }

    const chapters = this.chaptersMap.get(book.id) || [];
    const st = this.getBookStats(book);
    const furthest = Math.max(st.pos, this.progressMap.get(book.id)?.furthestPosition || 0);
    const skippedGaps = st.gaps.filter(([a]) => a < furthest);
    const bookBookmarks = this.bookmarks.filter(bm => bm.bookId === book.id);
    const bookNotes = this.notes.filter(n => n.bookId === book.id);
    const transcript = this.transcriptsMap.get(book.id);
    const firstGap = skippedGaps[0] || null;
    const isCurrent = this.player.book?.id === book.id;
    const isMissing = this.missingAudioSet.has(book.id);

    container.innerHTML = `
      <div class="detail-hero glass-elevated prism-edge">
        ${this._coverHtml(book, 'detail-cover glow-backlight')}
        <div class="detail-meta">
          <h1 id="detail-book-title">${Utils.escapeHtml(book.title)}</h1>
          <p class="setting-desc">${Utils.escapeHtml(book.author || 'Unknown Author')}${book.narrator ? ` · Narrated by ${Utils.escapeHtml(book.narrator)}` : ''}</p>
          ${book.series ? `<p class="eyebrow">${Utils.escapeHtml(book.series)}${book.seriesIndex ? ` #${book.seriesIndex}` : ''}</p>` : ''}
          <div class="detail-tags">
            <span class="pill-chip">${Utils.formatDurationHuman(book.duration)}</span>
            <span class="pill-chip">${chapters.length} Chapters</span>
            <span class="pill-chip">${st.covPct.toFixed(1)}% Played Coverage</span>
            <span class="pill-chip">${Utils.formatDurationHuman(st.listenedSec)} Listened</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
            ${isMissing
              ? `<button type="button" class="btn btn-primary btn-sm" id="detail-relink-btn">Re-link Missing Audio Files</button>`
              : `<button type="button" class="btn btn-primary btn-sm" id="detail-play-btn">${isCurrent ? 'Open Player' : `Resume (${Utils.formatTime(st.pos)})`}</button>`}
            ${firstGap ? `<button type="button" class="btn btn-secondary btn-sm" id="detail-play-all-gaps-btn">Play All ${skippedGaps.length} Skipped Gap(s)</button>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" id="detail-upload-art-btn">Replace Cover</button>
            <button type="button" class="btn btn-secondary btn-sm" id="detail-upload-tr-btn">${transcript ? 'Replace Transcript' : 'Attach Transcript (.vtt/.srt)'}</button>
          </div>
        </div>
      </div>

      <section class="glass-secondary dash-panel">
        <div class="panel-head">
          <h2>Playback Coverage &amp; Skipped Gaps (${skippedGaps.length})</h2>
          <button type="button" class="btn btn-danger btn-xs" id="detail-reset-cov-btn">Reset Coverage</button>
        </div>
        <div id="detail-timeline-mount"></div>
        <p class="setting-desc">Solid bars show recorded playback. Hatched sections behind your furthest playhead (${Utils.formatTime(furthest)}) are skipped gaps.</p>
        <div class="form-grid">
          ${skippedGaps.slice(0, 12).map(([gs, ge]) => `
            <div class="list-item-row">
              <div><strong class="tabular">${Utils.formatTime(gs)} – ${Utils.formatTime(ge)}</strong><div class="setting-desc">${Utils.formatDurationHuman(ge - gs)} skipped</div></div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-primary btn-xs" data-jump-pos="${gs}">Play Gap</button>
                <button type="button" class="btn btn-ghost btn-xs" data-mark-played="${gs},${ge}">Mark Played</button>
              </div>
            </div>
          `).join('') || `<p class="setting-desc">No skipped gaps behind your current playhead.</p>`}
        </div>
      </section>

      <section class="glass-secondary dash-panel">
        <div class="panel-head">
          <h2>Chapters (${chapters.length})</h2>
          <button type="button" class="btn btn-secondary btn-xs" id="detail-edit-chapters-btn">Edit Chapters</button>
        </div>
        <div class="form-grid">
          ${chapters.map((c, idx) => `
            <div class="list-item-row${isCurrent && this.player.getCurrentChapter().index === idx ? ' is-active' : ''}">
              <div style="min-width:0;"><strong>${idx + 1}. ${Utils.escapeHtml(c.title)}</strong><div class="setting-desc tabular">${Utils.formatTime(c.bookStart)} · ${Utils.formatDurationHuman(c.duration)}</div></div>
              <button type="button" class="btn btn-secondary btn-xs" data-jump-pos="${c.bookStart}">Play</button>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="glass-secondary dash-panel">
        <div class="panel-head"><h2>Collections</h2></div>
        <div class="collections-strip" style="margin:0;">
          ${this.collections.length
            ? this.collections.map(c => `<button type="button" class="pill-chip ${book.collectionIds?.includes(c.id) ? 'is-active' : ''}" data-toggle-col="${c.id}">${Utils.escapeHtml(c.name)}</button>`).join('')
            : `<p class="setting-desc">No collections created yet.</p>`}
        </div>
      </section>

      <section class="glass-secondary dash-panel">
        <div class="panel-head"><h2>Bookmarks, Notes &amp; Glossary (${bookBookmarks.length + bookNotes.length})</h2></div>
        ${bookBookmarks.map(bm => `<div class="list-item-row"><div style="min-width:0;"><span class="vault-badge">Bookmark</span> <strong>${Utils.escapeHtml(bm.title)}</strong> <span class="setting-desc tabular">${Utils.formatTime(bm.bookTime)}</span></div><button type="button" class="btn btn-secondary btn-xs" data-jump-pos="${bm.bookTime}">Jump</button></div>`).join('')}
        ${bookNotes.map(n => `<div class="list-item-row"><div style="min-width:0;"><span class="vault-badge">${Utils.escapeHtml(n.type)}</span> <span>${Utils.escapeHtml(n.text)}</span> <span class="setting-desc tabular">${Utils.formatTime(n.bookTime)}</span></div><button type="button" class="btn btn-secondary btn-xs" data-jump-pos="${n.bookTime}">Jump</button></div>`).join('')}
      </section>
    `;

    const tlMount = document.getElementById('detail-timeline-mount');
    const detailView = new CoverageTimelineView(this, {
      onSeek: (sec) => {
        if (this.player.book?.id === book.id) this.player.seekToBookPosition(sec);
        else this.player.loadBook(book.id, true, sec);
      }
    });
    const pins = [...bookBookmarks.map(b => b.bookTime), ...bookNotes.map(n => n.bookTime)];
    detailView.update(book, chapters, st, false, pins);
    tlMount.appendChild(detailView.el);

    document.getElementById('detail-play-btn')?.addEventListener('click', () => {
      if (this.player.book?.id === book.id) { document.getElementById('full-player').hidden = false; this.renderPlaybackUI(); }
      else this.player.loadBook(book.id, true);
    });
    document.getElementById('detail-relink-btn')?.addEventListener('click', () => this.relinkBookAudio(book));
    document.getElementById('detail-play-all-gaps-btn')?.addEventListener('click', async () => {
      if (this.player.book?.id !== book.id) await this.player.loadBook(book.id, false);
      await this.player.startGapRecoveryQueue(skippedGaps);
    });
    document.getElementById('detail-edit-chapters-btn')?.addEventListener('click', () => this.openChapterEditorModal(book, chapters));

    document.getElementById('detail-upload-art-btn').addEventListener('click', () => {
      const inp = document.getElementById('file-input-cover');
      inp.onchange = async () => {
        const f = inp.files?.[0]; if (!f) return;
        const dataUrl = await MetadataParser.resizeArtworkBlob(f);
        if (dataUrl) { book.artworkDataUrl = dataUrl; await this.db.put('books', book); await this.refreshData(); UI.toast('Cover artwork updated.', 'success'); }
        inp.value = '';
      };
      inp.click();
    });

    document.getElementById('detail-upload-tr-btn').addEventListener('click', () => {
      const inp = document.getElementById('file-input-transcript');
      inp.onchange = async () => {
        const f = inp.files?.[0]; if (!f) return;
        const parsed = TranscriptParser.parse(await f.text(), f.name);
        if (!parsed.cues.length) UI.toast('No valid WebVTT or SRT timed cues found.', 'error');
        else {
          await this.db.put('transcripts', { id: book.id, bookId: book.id, format: parsed.format, fileName: f.name, cues: parsed.cues, createdAt: Date.now() });
          await this.refreshData();
          UI.toast(`Attached ${parsed.cues.length} transcript cues.`, 'success');
        }
        inp.value = '';
      };
      inp.click();
    });

    document.getElementById('detail-reset-cov-btn').addEventListener('click', async () => {
      const ok = await UI.confirm({ title: 'Reset Playback Coverage', message: `Clear all coverage history for "${book.title}"?`, confirmLabel: 'Reset Coverage', danger: true });
      if (!ok) return;
      if (this.player.book?.id === book.id) await this.coverage.resetCoverage();
      else await this.db.put('coverage', { bookId: book.id, intervals: [], totalListeningSeconds: 0, updatedAt: Date.now() });
      await this.refreshData();
      UI.toast('Coverage reset.');
    });

    container.querySelectorAll('[data-jump-pos]').forEach(btn => btn.addEventListener('click', () => this.player.loadBook(book.id, true, Number(btn.dataset.jumpPos))));
    container.querySelectorAll('[data-mark-played]').forEach(btn => btn.addEventListener('click', async () => {
      const [a, b] = btn.dataset.markPlayed.split(',').map(Number);
      if (this.player.book?.id === book.id) await this.coverage.markRangePlayed(a, b);
      else {
        const rec = (await this.db.get('coverage', book.id)) || { bookId: book.id, intervals: [], totalListeningSeconds: 0 };
        rec.intervals = this.coverage.mergeIntervals([...rec.intervals, [a, b]]);
        rec.updatedAt = Date.now();
        await this.db.put('coverage', rec);
      }
      await this.refreshData();
    }));
    container.querySelectorAll('[data-toggle-col]').forEach(btn => btn.addEventListener('click', async () => {
      const cid = btn.dataset.toggleCol, set = new Set(book.collectionIds || []);
      if (set.has(cid)) set.delete(cid); else set.add(cid);
      book.collectionIds = Array.from(set);
      await this.db.put('books', book);
      await this.refreshData();
    }));
  }

  // Upgrade #27: Guided Re-link Missing Audio
  relinkBookAudio(book) {
    const inp = document.getElementById('file-input-relink');
    inp.onchange = async () => {
      const picked = Array.from(inp.files || []);
      inp.value = '';
      if (!picked.length) return;
      const existingFiles = (await this.db.getByIndex('files', 'bookId', book.id)).sort((a, b) => a.orderIndex - b.orderIndex);
      let linked = 0;
      if (existingFiles.length) {
        for (const f of picked) {
          const hash = await MetadataParser.computeFingerprint(f);
          const match = existingFiles.find(ef => ef.hash === hash || ef.name === f.name || ef.size === f.size);
          if (match) {
            const meta = await MediaStorage.saveAudioCopy(match.id, f);
            match.storageMode = 'local-copy'; match.storageKind = meta.storageKind; match.blob = meta.blob;
            await this.db.put('files', match);
            linked++;
          }
        }
      } else {
        picked.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        let offset = 0;
        const newFiles = [];
        for (let i = 0; i < picked.length; i++) {
          const f = picked[i], fileId = Utils.uid('file'), dur = await MetadataParser.probeDuration(f);
          const meta = await MediaStorage.saveAudioCopy(fileId, f);
          newFiles.push({
            id: fileId, bookId: book.id, name: f.name, size: f.size, type: f.type || 'audio/mpeg',
            duration: dur, orderIndex: i, startOffset: offset, storageMode: 'local-copy',
            storageKind: meta.storageKind, blob: meta.blob, hash: await MetadataParser.computeFingerprint(f)
          });
          offset += dur; linked++;
        }
        await this.db.putMany('files', newFiles);
      }
      await this.refreshData();
      UI.toast(`Re-linked ${linked} audio file(s) to "${book.title}".`, linked ? 'success' : 'error');
    };
    inp.click();
  }

  // Upgrade #37: Chapter Editor
  openChapterEditorModal(book, chapters) {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <p class="setting-desc">Rename chapters below or add a new chapter split at your current playhead.</p>
      <div id="chap-edit-list" class="form-grid" style="max-height:320px;overflow-y:auto;">
        ${chapters.map((c, i) => `
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="tabular setting-desc" style="min-width:56px;">${Utils.formatTime(c.bookStart)}</span>
            <input type="text" data-chap-idx="${i}" value="${Utils.escapeHtml(c.title)}" style="flex:1;">
          </div>
        `).join('')}
      </div>
    `;
    UI.openModal({
      title: 'Edit Chapters',
      bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Save Chapters', className: 'btn-primary',
          onClick: async () => {
            wrap.querySelectorAll('[data-chap-idx]').forEach(inp => {
              const ch = chapters[Number(inp.dataset.chapIdx)];
              if (ch && inp.value.trim()) ch.title = inp.value.trim();
            });
            await this.db.putMany('chapters', chapters);
            await this.refreshData();
            UI.closeModal();
            UI.toast('Chapters updated.', 'success');
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------------------
     RENDER: KNOWLEDGE VAULT (BIDIRECTIONAL BACKLINKS + MARKDOWN/CSV EXPORT)
     ------------------------------------------------------------------------ */
  renderVault() {
    const bookSel = document.getElementById('vault-filter-book');
    const curBook = bookSel.value;
    bookSel.innerHTML = `<option value="all">All Audiobooks</option>` + this.books.map(b => `<option value="${b.id}">${Utils.escapeHtml(b.title)}</option>`).join('');
    if (Array.from(bookSel.options).some(o => o.value === curBook)) bookSel.value = curBook;

    const allTags = [...new Set(this.notes.flatMap(n => n.tags || []))].sort();
    const tagSel = document.getElementById('vault-filter-tag');
    const curTag = tagSel.value;
    tagSel.innerHTML = `<option value="all">All Tags</option>` + allTags.map(t => `<option value="${Utils.escapeHtml(t)}">${Utils.escapeHtml(t)}</option>`).join('');
    if (Array.from(tagSel.options).some(o => o.value === curTag)) tagSel.value = curTag;

    const q = document.getElementById('vault-search').value.trim().toLowerCase();
    const typeF = document.getElementById('vault-filter-type').value;

    const combined = [
      ...this.bookmarks.map(b => ({ kind: 'bookmark', ...b })),
      ...this.notes.map(n => ({ kind: n.type || 'note', ...n }))
    ].sort((a, b) => b.createdAt - a.createdAt);

    const filtered = combined.filter(item => {
      if (typeF !== 'all' && item.kind !== typeF) return false;
      if (bookSel.value !== 'all' && item.bookId !== bookSel.value) return false;
      if (tagSel.value !== 'all' && !(item.tags || []).includes(tagSel.value)) return false;
      if (q) {
        const hay = `${item.title || ''} ${item.description || ''} ${item.text || ''} ${item.highlightText || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const listEl = document.getElementById('vault-list');
    if (!filtered.length) {
      listEl.innerHTML = `<div class="empty-state glass-secondary" style="grid-column:1/-1;"><h2>Knowledge Vault Empty</h2><p>Save timestamped bookmarks, notes, quotes, glossary terms, and transcript highlights while listening.</p></div>`;
      return;
    }

    listEl.innerHTML = filtered.map(item => {
      const bk = this.books.find(b => b.id === item.bookId);
      const outgoing = (item.linkedNoteIds || []).map(id => this.notes.find(n => n.id === id)).filter(Boolean);
      // Upgrade #41: Bidirectional backlinks
      const incoming = item.kind !== 'bookmark' ? this.notes.filter(n => (n.linkedNoteIds || []).includes(item.id)) : [];
      return `
        <article class="vault-card glass-secondary">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span class="vault-badge">${Utils.escapeHtml(item.kind)}</span>
            <span class="setting-desc tabular">${Utils.formatTime(item.bookTime)}</span>
          </div>
          <div><strong>${Utils.escapeHtml(bk?.title || 'Unknown Book')}</strong>${item.chapterTitle ? `<div class="setting-desc">${Utils.escapeHtml(item.chapterTitle)}</div>` : ''}</div>
          ${item.highlightText ? `<blockquote>${Utils.escapeHtml(item.highlightText)}</blockquote>` : ''}
          <p style="font-size:0.92rem;">${Utils.escapeHtml(item.text || item.title || item.description || '')}</p>
          ${(item.tags || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${item.tags.map(t => `<span class="pill-chip" style="min-height:26px;">#${Utils.escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${outgoing.length ? `<div class="setting-desc">Links to: ${outgoing.map(ln => `"${Utils.escapeHtml(ln.text.slice(0, 32))}…"`).join(', ')}</div>` : ''}
          ${incoming.length ? `<div class="setting-desc">Referenced by: ${incoming.map(ln => `"${Utils.escapeHtml(ln.text.slice(0, 32))}…"`).join(', ')}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;">
            ${bk ? `<button type="button" class="btn btn-primary btn-xs" data-vault-jump="${item.bookId},${item.bookTime}">Listen</button>` : ''}
            ${item.kind !== 'bookmark' ? `<button type="button" class="btn btn-secondary btn-xs" data-vault-link="${item.id}">Connect Idea</button>` : ''}
            <button type="button" class="btn btn-ghost btn-xs" data-vault-del="${item.kind === 'bookmark' ? 'bm' : 'nt'}:${item.id}">Delete</button>
          </div>
        </article>
      `;
    }).join('');

    listEl.querySelectorAll('[data-vault-jump]').forEach(btn => btn.addEventListener('click', () => {
      const [bid, pos] = btn.dataset.vaultJump.split(',');
      this.player.loadBook(bid, true, Number(pos));
    }));
    listEl.querySelectorAll('[data-vault-link]').forEach(btn => btn.addEventListener('click', () => this.openConnectIdeaModal(btn.dataset.vaultLink)));
    // Upgrade #35: Undoable deletion
    listEl.querySelectorAll('[data-vault-del]').forEach(btn => btn.addEventListener('click', async () => {
      const [kind, id] = btn.dataset.vaultDel.split(':');
      const store = kind === 'bm' ? 'bookmarks' : 'notes';
      const backup = await this.db.get(store, id);
      if (!backup) return;
      await this.db.delete(store, id);
      await this.refreshData();
      UI.toast('Entry deleted.', 'info', 5000, async () => {
        await this.db.put(store, backup);
        await this.refreshData();
      });
    }));
  }

  exportVault(format = 'md') {
    const combined = [
      ...this.bookmarks.map(b => ({ kind: 'bookmark', ...b })),
      ...this.notes.map(n => ({ kind: n.type || 'note', ...n }))
    ].sort((a, b) => b.createdAt - a.createdAt);
    if (!combined.length) return UI.toast('Knowledge Vault is empty.', 'error');

    let content = '', mime = 'text/markdown', ext = 'md';
    if (format === 'csv') {
      mime = 'text/csv'; ext = 'csv';
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      content = ['Type,Book,Chapter,Timestamp,Text,Highlight,Tags'].concat(
        combined.map(it => {
          const bk = this.books.find(b => b.id === it.bookId)?.title || '';
          return [it.kind, bk, it.chapterTitle || '', Utils.formatTime(it.bookTime), it.text || it.title || '', it.highlightText || '', (it.tags || []).join(';')].map(esc).join(',');
        })
      ).join('\n');
    } else {
      content = `# Cadence Knowledge Vault\nExported ${new Date().toLocaleDateString()}\n\n` + combined.map(it => {
        const bk = this.books.find(b => b.id === it.bookId)?.title || 'Unknown Book';
        const tags = (it.tags || []).map(t => `#${t}`).join(' ');
        return `### [${it.kind.toUpperCase()}] ${bk} (${Utils.formatTime(it.bookTime)})\n` +
          (it.chapterTitle ? `*Chapter: ${it.chapterTitle}*\n\n` : '\n') +
          (it.highlightText ? `> ${it.highlightText}\n\n` : '') +
          `${it.text || it.title || ''}\n` + (tags ? `\nTags: ${tags}\n` : '');
      }).join('\n---\n\n');
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `cadence-vault-${Utils.localDateKey()}.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.toast(`Exported Knowledge Vault (.${ext}).`, 'success');
  }

  /* ------------------------------------------------------------------------
     RENDER: STATISTICS & WEEKDAY-ALIGNED CALENDAR (#31)
     ------------------------------------------------------------------------ */
  renderStats() {
    const container = document.getElementById('stats-container');
    const totalListened = this.sessions.reduce((s, x) => s + x.listenedSeconds, 0);
    const totalUnique = this.books.reduce((s, b) => s + this.getBookStats(b).coveredSec, 0);
    const completedCount = this.books.filter(b => b.completed).length;
    const activeDays = new Set(this.sessions.map(s => s.dateKey));
    const avgDaily = activeDays.size ? totalListened / activeDays.size : 0;

    let streak = 0;
    for (let off = 0; off <= 400; off++) {
      const key = Utils.dateKeyOffset(-off);
      if (activeDays.has(key)) streak++;
      else if (off === 0) continue;
      else break;
    }

    const year = this.calendarYear, month = this.calendarMonth;
    const monthLabel = new Date(year, month, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Mon=0 .. Sun=6
    const dayTotals = new Map();
    this.sessions.forEach(s => dayTotals.set(s.dateKey, (dayTotals.get(s.dateKey) || 0) + s.listenedSeconds));
    const goalMin = this.settings.dailyGoalMin || 30;

    let calHtml = Array.from({ length: firstWeekday }, () => `<div class="cal-day-empty"></div>`).join('');
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const min = Math.round((dayTotals.get(key) || 0) / 60);
      let heat = 0;
      if (min > 0) { const ratio = min / goalMin; heat = ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1; }
      calHtml += `<button type="button" class="cal-day ${heat ? `heat-${heat}` : ''} ${this.selectedCalendarDate === key ? 'is-selected' : ''}" data-cal-day="${key}">
        <span>${d}</span>${min > 0 ? `<span class="cal-min">${min}m</span>` : ''}
      </button>`;
    }

    const selSessions = this.sessions.filter(s => s.dateKey === this.selectedCalendarDate);
    const selMin = Math.round(selSessions.reduce((a, b) => a + b.listenedSeconds, 0) / 60);
    const weekKeys = new Set(Array.from({ length: 7 }, (_, i) => Utils.dateKeyOffset(-6 + i)));
    const weekSec = this.sessions.filter(s => weekKeys.has(s.dateKey)).reduce((a, b) => a + b.listenedSeconds, 0);
    const weekPct = Utils.clamp(((weekSec / 60) / (this.settings.weeklyGoalMin || 210)) * 100, 0, 100);

    const targetBook = this.player.book || this.books.find(b => !b.completed);
    let estimatorHtml = `<p class="setting-desc">Import an audiobook to calculate completion estimates.</p>`;
    if (targetBook) {
      const st = this.getBookStats(targetBook), remAudioSec = Math.max(0, (targetBook.duration || 0) - st.pos);
      const speed = targetBook.preferredSpeed || this.settings.defaultSpeed || 1;
      const realSecondsNeeded = remAudioSec / speed;
      const dailySecBudget = activeDays.size >= 2 ? avgDaily : (this.settings.dailyGoalMin * 60);
      const estDays = dailySecBudget > 0 ? Math.ceil(realSecondsNeeded / dailySecBudget) : 0;
      estimatorHtml = `<strong>${Utils.escapeHtml(targetBook.title)}</strong>
        <p class="setting-desc">Remaining at ${speed.toFixed(2)}x: ${Utils.formatDurationHuman(realSecondsNeeded)} (~${estDays} day(s))</p>`;
    }

    container.innerHTML = `
      <section class="stats-card glass-secondary">
        <h2>Real-Time Listening vs. Unique Coverage</h2>
        <div class="metric-pair-grid">
          <div class="metric-tile"><span class="metric-val">${Utils.formatDurationHuman(totalListened)}</span><span class="metric-lbl">Wall Listening Time</span></div>
          <div class="metric-tile"><span class="metric-val">${Utils.formatDurationHuman(totalUnique)}</span><span class="metric-lbl">Unique Book Coverage</span></div>
          <div class="metric-tile"><span class="metric-val">${completedCount}</span><span class="metric-lbl">Completed Books</span></div>
          <div class="metric-tile"><span class="metric-val">${streak} day${streak === 1 ? '' : 's'}</span><span class="metric-lbl">Current Streak</span></div>
        </div>
        <div><h3>Finish-Time Calculator</h3>${estimatorHtml}</div>
      </section>

      <section class="stats-card glass-secondary">
        <div class="panel-head">
          <div style="display:flex;align-items:center;gap:8px;">
            <button type="button" class="btn btn-ghost btn-xs" id="cal-prev-month" aria-label="Previous month">‹</button>
            <h2>${monthLabel}</h2>
            <button type="button" class="btn btn-ghost btn-xs" id="cal-next-month" aria-label="Next month">›</button>
          </div>
          <span class="setting-desc">${selMin}m on ${this.selectedCalendarDate}</span>
        </div>
        <div class="cal-weekdays"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>
        <div class="calendar-grid">${calHtml}</div>
        <div class="goal-wrap" style="margin-top:4px;">
          <div class="goal-ring" style="--pct:${weekPct.toFixed(1)}"><span class="goal-ring-inner"><span class="goal-ring-val tabular">${weekPct.toFixed(0)}%</span><span class="goal-ring-lbl">of week</span></span></div>
          <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:10px;">
            <div style="font-size:0.82rem;">This week: <strong class="tabular">${Math.round(weekSec / 60)}m</strong> / ${this.settings.weeklyGoalMin}m</div>
            <div class="progress-bar"><div class="progress-fill" style="width:${weekPct}%"></div></div>
          </div>
        </div>
      </section>
    `;

    container.querySelector('#cal-prev-month').addEventListener('click', () => {
      if (this.calendarMonth === 0) { this.calendarMonth = 11; this.calendarYear--; } else this.calendarMonth--;
      this.renderStats();
    });
    container.querySelector('#cal-next-month').addEventListener('click', () => {
      if (this.calendarMonth === 11) { this.calendarMonth = 0; this.calendarYear++; } else this.calendarMonth++;
      this.renderStats();
    });
    container.querySelectorAll('[data-cal-day]').forEach(btn => btn.addEventListener('click', () => {
      this.selectedCalendarDate = btn.dataset.calDay; this.renderStats();
    }));
  }

  /* ------------------------------------------------------------------------
     RENDER: SETTINGS
     ------------------------------------------------------------------------ */
  async renderSettings() {
    document.querySelectorAll('[data-theme-mode]').forEach(b => b.classList.toggle('is-active', b.dataset.themeMode === this.settings.themeMode));
    document.querySelectorAll('[data-palette-choice]').forEach(b => b.classList.toggle('is-active', b.dataset.paletteChoice === this.settings.palette));
    document.getElementById('setting-default-speed').value = String(this.settings.defaultSpeed);
    document.getElementById('setting-smart-rewind').value = String(this.settings.smartRewind || 0);
    document.getElementById('setting-skip-back').value = String(this.settings.skipBack);
    document.getElementById('setting-skip-fwd').value = String(this.settings.skipFwd);
    document.getElementById('setting-webaudio-enabled').checked = !!this.settings.webAudioEnabled;
    document.getElementById('setting-haptics-enabled').checked = !!this.settings.hapticsEnabled;

    const files = await this.db.getAll('files');
    const localCopyBytes = files.filter(f => f.storageMode === 'local-copy').reduce((s, f) => s + (f.size || 0), 0);
    let estHtml = `<div class="cap-item"><span>Local Audio Copies</span><strong>${Utils.formatBytes(localCopyBytes)}</strong></div>`;
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      estHtml += `<div class="cap-item"><span>Browser Used</span><strong>${Utils.formatBytes(est.usage || 0)}</strong></div>`;
      estHtml += `<div class="cap-item"><span>Browser Quota</span><strong>${Utils.formatBytes(est.quota || 0)}</strong></div>`;
    }
    if (navigator.storage?.persisted) {
      estHtml += `<div class="cap-item"><span>Persistent Storage</span><strong>${(await navigator.storage.persisted()) ? 'Granted' : 'Best Effort'}</strong></div>`;
    }
    document.getElementById('storage-overview').innerHTML = estHtml;

    const caps = Utils.detectCapabilities();
    document.getElementById('capabilities-list').innerHTML = `
      <div class="cap-item"><span>IndexedDB</span><strong>${caps.indexedDB ? 'Supported' : 'Unavailable'}</strong></div>
      <div class="cap-item"><span>OPFS Storage</span><strong>${caps.opfs ? 'Supported' : 'IDB Fallback'}</strong></div>
      <div class="cap-item"><span>Service Worker</span><strong>${caps.serviceWorker ? 'Supported' : 'Unavailable'}</strong></div>
      <div class="cap-item"><span>Web Audio EQ</span><strong>${caps.webAudio ? 'Supported' : 'Native Only'}</strong></div>
      <div class="cap-item"><span>MP3 / M4B</span><strong>${caps.codecs.mp3} / ${caps.codecs.m4b}</strong></div>
      <div class="cap-item"><span>App Version</span><strong>v${APP_CONFIG.version}</strong></div>
    `;
    this._syncInstallUI();
  }

  /* ------------------------------------------------------------------------
     RENDER: PLAYBACK UI, VIRTUALIZED TRANSCRIPT + SEARCH, GLOSSARY
     ------------------------------------------------------------------------ */
  renderMiniPlayerVisibility() {
    const active = !!this.player.book;
    document.getElementById('mini-player').hidden = !active;
    document.body.classList.toggle('has-active-book', active);
  }

  async renderPlaybackUI() {
    const book = this.player.book;
    if (!book) return;
    const isPlaying = !this.player.audio.paused;
    const { chapter, index } = this.player.getCurrentChapter();
    const st = this.getBookStats(book);

    document.body.classList.toggle('is-audio-playing', isPlaying);
    document.title = `${isPlaying ? '▶ ' : ''}${book.title} — ${APP_CONFIG.appName}`;

    // Dynamic ambient lighting extracted from active cover art
    const fpEl = document.getElementById('full-player');
    const mpEl = document.getElementById('mini-player');
    if (book.artworkDataUrl) {
      const rgb = await Utils.extractAccentRgb(book.artworkDataUrl);
      if (rgb) {
        fpEl.style.setProperty('--accent-rgb', rgb);
        mpEl?.style.setProperty('--accent-rgb', rgb);
      } else {
        fpEl.style.removeProperty('--accent-rgb');
        mpEl?.style.removeProperty('--accent-rgb');
      }
    } else {
      fpEl.style.removeProperty('--accent-rgb');
      mpEl?.style.removeProperty('--accent-rgb');
    }

    const playSvg = `<polygon points="7,5 20,12 7,19" fill="currentColor"/>`;
    const pauseSvg = `<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>`;
    document.getElementById('mini-play-icon').innerHTML = isPlaying ? pauseSvg : playSvg;
    document.getElementById('fp-play-icon').innerHTML = isPlaying ? pauseSvg : playSvg;
    document.getElementById('fp-play-btn').classList.toggle('is-playing', isPlaying);

    document.getElementById('mini-title').textContent = book.title;
    document.getElementById('mini-subtitle').textContent = chapter ? chapter.title : (book.author || 'Playing');
    const miniCov = document.getElementById('mini-cover'), miniFb = document.getElementById('mini-cover-fallback');
    if (book.artworkDataUrl) { miniCov.src = book.artworkDataUrl; miniCov.hidden = false; miniFb.hidden = true; }
    else { miniCov.removeAttribute('src'); miniCov.hidden = true; miniFb.hidden = false; miniFb.textContent = Utils.initials(book.title); }

    document.getElementById('fp-book-title').textContent = book.title;
    document.getElementById('fp-book-author').textContent = [book.author, book.narrator ? `Narrated by ${book.narrator}` : ''].filter(Boolean).join(' · ');
    document.getElementById('fp-current-chapter').textContent = chapter ? chapter.title : '';
    document.getElementById('fp-chapter-indicator').textContent = `Chapter ${index + 1} of ${Math.max(1, this.player.chapters.length)}`;
    document.getElementById('fp-coverage-badge').textContent = `${st.covPct.toFixed(1)}% Covered`;
    document.getElementById('fp-speed-readout').textContent = `${(this.player.audio.playbackRate || 1).toFixed(2)}x`;
    document.getElementById('fp-skip-back-label').textContent = `-${this.settings.skipBack}s`;
    document.getElementById('fp-skip-fwd-label').textContent = `+${this.settings.skipFwd}s`;

    const fpCov = document.getElementById('fp-cover'), fpFb = document.getElementById('fp-cover-fallback');
    if (book.artworkDataUrl) { fpCov.src = book.artworkDataUrl; fpCov.hidden = false; fpFb.hidden = true; }
    else { fpCov.removeAttribute('src'); fpCov.hidden = true; fpFb.hidden = false; fpFb.innerHTML = Utils.generativeCoverSvg(book.title, book.author); }

    const sl = this.player.sleepTimer;
    document.getElementById('fp-sleep-btn').textContent = sl.mode === 'off' ? 'Sleep: Off'
      : sl.mode === 'end-chapter' ? 'Sleep: End Ch.'
      : sl.mode === 'end-book' ? 'Sleep: End Book'
      : `Sleep: ${Math.max(1, Math.ceil((sl.endsAt - Date.now()) / 60000))}m`;

    const rate = Math.round((this.player.audio.playbackRate || 1) * 100) / 100;
    document.querySelectorAll('#fp-speed-presets .sp-btn').forEach(btn => btn.classList.toggle('is-active', Number(btn.dataset.speed) === rate));
    this._syncVolumeUI();
    this.renderPlaybackTick(true);
    this._renderFullPlayerToolPanel();
  }

  renderPlaybackTick(force = false) {
    const book = this.player.book;
    if (!book) return;
    const st = this.getBookStats(book);
    const { chapter } = this.player.getCurrentChapter();
    const isChap = this.timelineScope === 'chapter' && chapter;
    const minT = isChap ? chapter.bookStart : 0;
    const maxT = isChap ? chapter.bookEnd : (book.duration || 1);
    const cur = Utils.clamp(st.pos - minT, 0, Math.max(0, maxT - minT));
    const tot = Math.max(1, maxT - minT);

    document.getElementById('mini-progress-fill').style.width = `${Utils.clamp((st.pos / Math.max(1, book.duration)) * 100, 0, 100)}%`;
    document.getElementById('fp-time-current').textContent = Utils.formatTime(cur);
    document.getElementById('fp-time-total').textContent = Utils.formatTime(tot);
    document.getElementById('fp-time-remaining').textContent = `-${Utils.formatTime(Math.max(0, tot - cur))} left`;

    const tlContainer = document.getElementById('fp-coverage-timeline');
    if (tlContainer) {
      if (!this._fpTimelineView || this._fpTimelineView.el.parentNode !== tlContainer) {
        tlContainer.innerHTML = '';
        this._fpTimelineView = new CoverageTimelineView(this, { onSeek: (sec) => this.player.seekToBookPosition(sec) });
        tlContainer.appendChild(this._fpTimelineView.el);
      }
      if (force || (performance.now() - this._lastSegmentSyncAt) > 500) {
        this._lastSegmentSyncAt = performance.now();
        document.getElementById('fp-coverage-badge').textContent = `${st.covPct.toFixed(1)}% Covered`;
        const pins = [
          ...this.bookmarks.filter(b => b.bookId === book.id).map(b => b.bookTime),
          ...this.notes.filter(n => n.bookId === book.id).map(n => n.bookTime)
        ];
        this._fpTimelineView.update(book, this.player.chapters, st, isChap, pins);
      } else {
        const ratio = Utils.clamp(((st.pos - minT) / Math.max(1, maxT - minT)) * 100, 0, 100);
        this._fpTimelineView._lastRatio = ratio / 100;
        this._fpTimelineView._playhead.style.left = `${ratio}%`;
      }
    }

    if (this.fullPlayerTab === 'transcript') this._highlightTranscriptCue(st.pos);
    if (this.fullPlayerTab === 'chapters') {
      const { index } = this.player.getCurrentChapter();
      document.querySelectorAll('#fp-panel-chapters .fp-chap-row').forEach(row => row.classList.toggle('is-current', Number(row.dataset.chapIndex) === index));
    }
  }

  _syncVolumeUI() {
    const a = this.player.audio, slider = document.getElementById('fp-volume'), icon = document.getElementById('fp-vol-icon');
    if (slider) { slider.value = String(a.muted ? 0 : a.volume); Utils.setRangeFill(slider); }
    if (icon) {
      const level = a.muted ? 0 : a.volume;
      icon.innerHTML = level === 0
        ? `<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`
        : `<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
    }
  }

  _renderFullPlayerToolPanel() {
    const book = this.player.book;
    if (!book) return;
    const st = this.getBookStats(book);
    const { index: curChapIdx } = this.player.getCurrentChapter();

    const chapPanel = document.getElementById('fp-panel-chapters');
    const chapKey = `chap:${book.id}:${this.player.chapters.length}`;
    if (chapPanel.dataset.key !== chapKey) {
      chapPanel.dataset.key = chapKey;
      chapPanel.innerHTML = this.player.chapters.map((c, idx) => `
        <div class="fp-chap-row ${idx === curChapIdx ? 'is-current' : ''}" data-fp-chap="${c.bookStart}" data-chap-index="${idx}" role="button" tabindex="0">
          <span class="fp-chap-num">${idx + 1}</span>
          <span class="fp-chap-main">
            <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${Utils.escapeHtml(c.title)}</strong>
            <span class="setting-desc tabular">${Utils.formatTime(c.bookStart)} · ${Utils.formatDurationHuman(c.duration)}</span>
          </span>
          <span class="eq-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        </div>
      `).join('');
      chapPanel.querySelectorAll('[data-fp-chap]').forEach(el => el.addEventListener('click', () => this.player.seekToBookPosition(Number(el.dataset.fpChap))));
    }

    const covPanel = document.getElementById('fp-panel-coverage');
    const furthest = Math.max(st.pos, this.progressMap.get(book.id)?.furthestPosition || 0);
    const skippedGaps = st.gaps.filter(([a]) => a < furthest);
    const firstGap = skippedGaps[0] || null;
    covPanel.innerHTML = `
      <div class="metric-pair-grid">
        <div class="metric-tile"><span class="metric-val">${st.covPct.toFixed(1)}%</span><span class="metric-lbl">Unique Covered</span></div>
        <div class="metric-tile"><span class="metric-val">${Utils.formatDurationHuman(st.listenedSec)}</span><span class="metric-lbl">Total Listened</span></div>
      </div>
      ${firstGap ? `<button type="button" class="btn btn-primary btn-sm" id="fp-jump-first-gap">Play All ${skippedGaps.length} Skipped Gap(s)</button>` : '<p class="setting-desc">No skipped gaps behind your playhead.</p>'}
      ${skippedGaps.slice(0, 8).map(([a, b]) => `<div class="list-item-row"><span class="tabular">${Utils.formatTime(a)} – ${Utils.formatTime(b)}</span><button type="button" class="btn btn-secondary btn-xs" data-fp-gap="${a}">Play Gap</button></div>`).join('')}
    `;
    covPanel.querySelector('#fp-jump-first-gap')?.addEventListener('click', () => this.player.startGapRecoveryQueue(skippedGaps));
    covPanel.querySelectorAll('[data-fp-gap]').forEach(btn => btn.addEventListener('click', () => this.player.seekToBookPosition(Number(btn.dataset.fpGap))));

    const eq = this.player.eqState, eqPanel = document.getElementById('fp-panel-eq');
    const eqKey = `eq:${eq.preset}:${eq.bass}:${eq.mid}:${eq.voice}:${eq.treble}:${this.settings.webAudioEnabled ? 1 : 0}`;
    if (eqPanel.dataset.key !== eqKey) {
      eqPanel.dataset.key = eqKey;
      eqPanel.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${Object.entries(EQ_PRESETS).filter(([k]) => k !== 'custom').map(([k, p]) => `<button type="button" class="pill-chip ${eq.preset === k ? 'is-active' : ''}" data-eq-preset="${k}">${p.label}</button>`).join('')}
        </div>
        <div class="eq-slider-row"><span>Bass (120Hz)</span><input type="range" min="-8" max="8" step="0.5" value="${eq.bass}" data-eq-band="bass"><span class="tabular">${eq.bass} dB</span></div>
        <div class="eq-slider-row"><span>Mid (950Hz)</span><input type="range" min="-8" max="8" step="0.5" value="${eq.mid}" data-eq-band="mid"><span class="tabular">${eq.mid} dB</span></div>
        <div class="eq-slider-row"><span>Clarity (3.1k)</span><input type="range" min="-8" max="8" step="0.5" value="${eq.voice}" data-eq-band="voice"><span class="tabular">${eq.voice} dB</span></div>
        <div class="eq-slider-row"><span>Treble (8kHz)</span><input type="range" min="-8" max="8" step="0.5" value="${eq.treble}" data-eq-band="treble"><span class="tabular">${eq.treble} dB</span></div>
      `;
      eqPanel.querySelectorAll('input[data-eq-band]').forEach(inp => {
        Utils.setRangeFill(inp);
        inp.addEventListener('input', async () => {
          this.player.eqState.preset = 'custom'; this.player.eqState.enabled = true;
          this.player.eqState[inp.dataset.eqBand] = Number(inp.value);
          this.player.initWebAudioIfNeeded(); this.player.applyEQ();
          Utils.setRangeFill(inp); inp.nextElementSibling.textContent = `${inp.value} dB`;
          await this.db.put('settings', { key: 'eq_state', value: this.player.eqState });
          eqPanel.dataset.key = '';
        });
      });
      eqPanel.querySelectorAll('[data-eq-preset]').forEach(btn => btn.addEventListener('click', async () => {
        const p = EQ_PRESETS[btn.dataset.eqPreset];
        this.player.eqState = { preset: btn.dataset.eqPreset, bass: p.bass, mid: p.mid, voice: p.voice, treble: p.treble, enabled: p.enabled };
        this.player.initWebAudioIfNeeded(); this.player.applyEQ();
        await this.db.put('settings', { key: 'eq_state', value: this.player.eqState });
        if (book.narrator) {
          this.settings.narratorProfiles = this.settings.narratorProfiles || {};
          this.settings.narratorProfiles[book.narrator] = { ...(this.settings.narratorProfiles[book.narrator] || {}), eq: this.player.eqState };
          await this.saveSettings();
        }
        this._renderFullPlayerToolPanel();
      }));
    }

    // Upgrade #21 & #38: Virtualized windowed transcript + live search
    this._renderTranscriptPanel(book);
    // Upgrade #49: Per-Book Glossary tab
    this._renderGlossaryPanel(book);
  }

  _renderTranscriptPanel(book) {
    const trPanel = document.getElementById('fp-panel-transcript');
    const tr = this.transcriptsMap.get(book.id);
    if (!tr) {
      trPanel.innerHTML = `<p class="setting-desc">No transcript attached. Attach a .vtt or .srt file from Book Details.</p>`;
      return;
    }
    if (!trPanel.querySelector('#tr-search-inp')) {
      trPanel.innerHTML = `
        <div class="search-field" style="min-height:38px;margin-bottom:8px;">
          <input type="search" id="tr-search-inp" placeholder="Search ${tr.cues.length} transcript cues…" value="${Utils.escapeHtml(this.transcriptQuery)}">
        </div>
        <div id="tr-cues-window" style="display:flex;flex-direction:column;gap:6px;"></div>
      `;
      trPanel.querySelector('#tr-search-inp').addEventListener('input', (e) => {
        this.transcriptQuery = e.target.value.trim().toLowerCase();
        this._paintTranscriptWindow(book, tr);
      });
    }
    this._paintTranscriptWindow(book, tr);
  }

  _paintTranscriptWindow(book, tr) {
    const winEl = document.getElementById('tr-cues-window');
    if (!winEl) return;
    const pos = this.player.getBookPosition();
    let list;
    if (this.transcriptQuery) {
      list = tr.cues.map((c, idx) => ({ c, idx })).filter(({ c }) => c.text.toLowerCase().includes(this.transcriptQuery)).slice(0, 120);
    } else {
      let activeIdx = tr.cues.findIndex(c => pos >= c.start && pos <= c.end);
      if (activeIdx === -1) activeIdx = Math.max(0, tr.cues.findIndex(c => c.start >= pos));
      const start = Math.max(0, activeIdx - 35), end = Math.min(tr.cues.length, activeIdx + 65);
      list = tr.cues.slice(start, end).map((c, off) => ({ c, idx: start + off }));
    }
    winEl.innerHTML = list.map(({ c, idx }) => `
      <div class="transcript-cue ${pos >= c.start && pos <= c.end ? 'is-current' : ''}" data-cue-idx="${idx}" data-cue-start="${c.start}">
        <span class="setting-desc tabular">${Utils.formatTime(c.start)}</span>
        <span>${Utils.escapeHtml(c.text)}</span>
        <button type="button" class="btn btn-ghost btn-xs" style="align-self:flex-start;" data-cue-hl="${idx}">Save Highlight</button>
      </div>
    `).join('') || `<p class="setting-desc">No matching cues found.</p>`;

    winEl.querySelectorAll('[data-cue-start]').forEach(el => el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-cue-hl]')) this.player.seekToBookPosition(Number(el.dataset.cueStart));
    }));
    winEl.querySelectorAll('[data-cue-hl]').forEach(btn => btn.addEventListener('click', async () => {
      const cue = tr.cues[Number(btn.dataset.cueHl)];
      const { chapter, index } = this.player.getCurrentChapter();
      await this.db.put('notes', {
        id: Utils.uid('note'), bookId: book.id, chapterIndex: index, chapterTitle: chapter?.title || '',
        bookTime: cue.start, type: 'highlight', tags: ['transcript'], text: 'Saved transcript highlight',
        highlightText: cue.text, linkedNoteIds: [], createdAt: Date.now(), updatedAt: Date.now()
      });
      await this.refreshData();
      UI.toast('Transcript highlight saved.', 'success');
    }));
  }

  _highlightTranscriptCue(pos) {
    const tr = this.transcriptsMap.get(this.player.book?.id);
    if (!tr || this.transcriptQuery) return;
    const winEl = document.getElementById('tr-cues-window');
    if (!winEl) return;
    const idx = tr.cues.findIndex(c => pos >= c.start && pos <= c.end);
    const hasRow = winEl.querySelector(`[data-cue-idx="${idx}"]`);
    if (idx !== -1 && !hasRow) this._paintTranscriptWindow(this.player.book, tr);
    winEl.querySelectorAll('.transcript-cue').forEach(el => {
      const isCur = Number(el.dataset.cueIdx) === idx;
      if (el.classList.contains('is-current') !== isCur) {
        el.classList.toggle('is-current', isCur);
        if (isCur) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }

  _renderGlossaryPanel(book) {
    const panel = document.getElementById('fp-panel-glossary');
    const terms = this.notes.filter(n => n.bookId === book.id && n.type === 'glossary');
    panel.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <input type="text" id="gloss-term-inp" placeholder="Character or term…" style="flex:1;min-height:38px;">
        <button type="button" class="btn btn-primary btn-xs" id="gloss-add-btn">+ Pin</button>
      </div>
      ${terms.map(t => `<div class="list-item-row"><div><strong>${Utils.escapeHtml(t.text)}</strong><div class="setting-desc tabular">First pinned at ${Utils.formatTime(t.bookTime)}</div></div><button type="button" class="btn btn-secondary btn-xs" data-gloss-jump="${t.bookTime}">Jump</button></div>`).join('') || `<p class="setting-desc">Pin recurring characters, places, or terms with their timestamp.</p>`}
    `;
    panel.querySelector('#gloss-add-btn').addEventListener('click', async () => {
      const val = panel.querySelector('#gloss-term-inp').value.trim();
      if (!val) return;
      const pos = this.player.getBookPosition();
      const { chapter, index } = this.player.getCurrentChapter();
      await this.db.put('notes', {
        id: Utils.uid('note'), bookId: book.id, chapterIndex: index, chapterTitle: chapter?.title || '',
        bookTime: pos, type: 'glossary', tags: ['glossary'], text: val, highlightText: '', linkedNoteIds: [],
        createdAt: Date.now(), updatedAt: Date.now()
      });
      await this.refreshData();
      this._renderGlossaryPanel(book);
      UI.toast(`Pinned "${val}" to Glossary.`, 'success');
    });
    panel.querySelectorAll('[data-gloss-jump]').forEach(b => b.addEventListener('click', () => this.player.seekToBookPosition(Number(b.dataset.glossJump))));
  }

  /* ------------------------------------------------------------------------
     UP NEXT QUEUE (#48) & GLOBAL COMMAND PALETTE (#44)
     ------------------------------------------------------------------------ */
  async addToUpNextQueue(bookId) {
    this.settings.upNextQueue = [...new Set([...(this.settings.upNextQueue || []), bookId])];
    await this.saveSettings();
    UI.toast('Added to Up Next queue.', 'success');
  }

  async advanceUpNextQueue() {
    const q = this.settings.upNextQueue || [];
    if (!q.length) return;
    const nextId = q.shift();
    this.settings.upNextQueue = q;
    await this.saveSettings();
    if (this.books.some(b => b.id === nextId)) {
      UI.toast('Auto-advancing to next queued audiobook…', 'info');
      await this.player.loadBook(nextId, true);
    }
  }

  openQueueModal() {
    const q = (this.settings.upNextQueue || []).map(id => this.books.find(b => b.id === id)).filter(Boolean);
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = q.length
      ? q.map((b, i) => `<div class="list-item-row"><span>${i + 1}. <strong>${Utils.escapeHtml(b.title)}</strong></span><button type="button" class="btn btn-ghost btn-xs" data-rm-q="${b.id}">Remove</button></div>`).join('')
      : `<p class="setting-desc">Your Up Next queue is empty. Open any book's Details and click "+ Up Next".</p>`;
    wrap.querySelectorAll('[data-rm-q]').forEach(btn => btn.addEventListener('click', async () => {
      this.settings.upNextQueue = (this.settings.upNextQueue || []).filter(id => id !== btn.dataset.rmQ);
      await this.saveSettings();
      UI.closeModal();
      this.openQueueModal();
    }));
    UI.openModal({ title: 'Up Next Listening Queue', bodyEl: wrap });
  }

  openCommandPalette() {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <div class="search-field"><input type="search" id="cmd-pal-inp" placeholder="Jump to book, note, tag, or action (e.g. Dark Mode, Import)…"></div>
      <div id="cmd-pal-results" class="form-grid" style="max-height:360px;overflow-y:auto;"></div>
    `;
    const inp = wrap.querySelector('#cmd-pal-inp'), res = wrap.querySelector('#cmd-pal-results');
    const render = () => {
      const q = inp.value.trim().toLowerCase();
      const actions = [
        { label: 'Import Audiobooks', kind: 'Action', fn: () => { UI.closeModal(); this.openImportChooserModal(); } },
        { label: 'Toggle Light / Dark Theme', kind: 'Action', fn: async () => { this.settings.themeMode = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; this.applyTheme(); await this.saveSettings(); UI.closeModal(); } },
        { label: 'Go to Knowledge Vault', kind: 'Navigate', fn: () => { UI.closeModal(); this.navigate('vault'); } },
        { label: 'Go to Statistics', kind: 'Navigate', fn: () => { UI.closeModal(); this.navigate('stats'); } }
      ];
      const bookHits = this.books.filter(b => !q || `${b.title} ${b.author}`.toLowerCase().includes(q)).slice(0, 6)
        .map(b => ({ label: b.title, sub: b.author || 'Audiobook', kind: 'Book', fn: () => { UI.closeModal(); this.navigate('book-detail', b.id); } }));
      const noteHits = this.notes.filter(n => q && `${n.text} ${(n.tags || []).join(' ')}`.toLowerCase().includes(q)).slice(0, 5)
        .map(n => ({ label: n.text.slice(0, 64), sub: Utils.formatTime(n.bookTime), kind: n.type, fn: () => { UI.closeModal(); this.player.loadBook(n.bookId, true, n.bookTime); } }));
      const all = [...actions.filter(a => !q || a.label.toLowerCase().includes(q)), ...bookHits, ...noteHits];
      res.innerHTML = all.map((item, idx) => `<button type="button" class="list-item-row" data-cmd-idx="${idx}" style="width:100%;text-align:left;cursor:pointer;"><span><strong>${Utils.escapeHtml(item.label)}</strong>${item.sub ? ` <span class="setting-desc">· ${Utils.escapeHtml(item.sub)}</span>` : ''}</span><span class="vault-badge">${Utils.escapeHtml(item.kind)}</span></button>`).join('') || `<p class="setting-desc">No matches.</p>`;
      res.querySelectorAll('[data-cmd-idx]').forEach(b => b.addEventListener('click', () => all[Number(b.dataset.cmdIdx)].fn()));
    };
    inp.addEventListener('input', render);
    UI.openModal({ title: 'Quick Jump (Command Palette)', bodyEl: wrap });
    render();
    setTimeout(() => inp.focus(), 40);
  }

  /* ------------------------------------------------------------------------
     MODALS & GLOBAL EVENTS
     ------------------------------------------------------------------------ */
  openImportChooserModal() {
    const caps = Utils.detectCapabilities();
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <p class="setting-desc">Select audio files or an audiobook folder. Everything stays local in your browser.</p>
      <div class="form-grid form-grid-2">
        <button type="button" class="btn btn-primary" id="imp-pick-files">Select Audio Files</button>
        <button type="button" class="btn btn-secondary" id="imp-pick-folder">Select Folder</button>
        ${caps.fileSystemAccess ? `<button type="button" class="btn btn-secondary" id="imp-fsa-files">Pick Files (Reference / Copy)</button>` : ''}
        ${typeof window.showDirectoryPicker === 'function' ? `<button type="button" class="btn btn-secondary" id="imp-fsa-dir">Pick Folder (Reference / Copy)</button>` : ''}
      </div>
    `;
    wrap.querySelector('#imp-pick-files').addEventListener('click', () => { UI.closeModal(); document.getElementById('file-input-audio').click(); });
    wrap.querySelector('#imp-pick-folder').addEventListener('click', () => { UI.closeModal(); document.getElementById('file-input-folder').click(); });
    wrap.querySelector('#imp-fsa-files')?.addEventListener('click', async () => {
      try { const h = await window.showOpenFilePicker({ multiple: true }); UI.closeModal(); await this.importer.processFileEntries(await Promise.all(h.map(async x => ({ file: await x.getFile(), path: x.name, handle: x })))); } catch { /* noop */ }
    });
    wrap.querySelector('#imp-fsa-dir')?.addEventListener('click', async () => {
      try {
        const dh = await window.showDirectoryPicker(); UI.closeModal();
        const entries = [];
        const walk = async (d, p) => { for await (const e of d.values()) { const np = p ? `${p}/${e.name}` : e.name; if (e.kind === 'file') entries.push({ file: await e.getFile(), path: np, handle: e }); else if (e.kind === 'directory') await walk(e, np); } };
        await walk(dh, dh.name); await this.importer.processFileEntries(entries);
      } catch { /* noop */ }
    });
    UI.openModal({ title: 'Import Audiobooks', bodyEl: wrap });
  }

  async createQuickBookmark() {
    const book = this.player.book; if (!book) return;
    const pos = this.player.getBookPosition(), { chapter, index } = this.player.getCurrentChapter();
    await this.db.put('bookmarks', {
      id: Utils.uid('bm'), bookId: book.id, chapterIndex: index, chapterTitle: chapter?.title || '',
      chapterTime: chapter ? Math.max(0, pos - chapter.bookStart) : pos, bookTime: pos,
      title: `Bookmark at ${Utils.formatTime(pos)}`, description: '', createdAt: Date.now()
    });
    Utils.haptic(10);
    await this.refreshData();
    UI.toast(`Bookmarked at ${Utils.formatTime(pos)}`, 'success');
  }

  openNewNoteModal(prefillBook = null) {
    const book = prefillBook || this.player.book || this.books[0];
    if (!book) return UI.toast('Import an audiobook first before creating a note.', 'error');
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <label class="field-label">Audiobook <select id="note-book-sel">${this.books.map(b => `<option value="${b.id}" ${b.id === book.id ? 'selected' : ''}>${Utils.escapeHtml(b.title)}</option>`).join('')}</select></label>
      <div class="form-grid form-grid-2">
        <label class="field-label">Type <select id="note-type-sel"><option value="note">Note</option><option value="quote">Quote</option><option value="idea">Idea</option><option value="question">Question</option><option value="glossary">Glossary Term</option></select></label>
        <label class="field-label">Tags <input type="text" id="note-tags-inp" placeholder="stoicism, focus"></label>
      </div>
      <label class="field-label">Content <textarea id="note-text-inp" rows="4" placeholder="Capture your thought, quote, or reflection..."></textarea></label>
      <p class="setting-desc" id="note-position-hint"></p>
    `;
    const selBook = () => this.books.find(b => b.id === wrap.querySelector('#note-book-sel').value) || book;
    const curPos = () => { const s = selBook(); return this.player.book?.id === s.id ? this.player.getBookPosition() : (this.progressMap.get(s.id)?.bookPosition || 0); };
    const refreshHint = () => { wrap.querySelector('#note-position-hint').textContent = `Timestamp: ${Utils.formatTime(curPos())}`; };
    refreshHint();
    wrap.querySelector('#note-book-sel').addEventListener('change', refreshHint);

    UI.openModal({
      title: 'New Note', bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Save Note', className: 'btn-primary',
          onClick: async () => {
            const sel = selBook(), pos = curPos(), text = wrap.querySelector('#note-text-inp').value.trim();
            if (!text) return UI.toast('Please enter note content.', 'error');
            const tags = wrap.querySelector('#note-tags-inp').value.split(',').map(s => s.trim()).filter(Boolean);
            const chapters = this.chaptersMap.get(sel.id) || [];
            const ch = [...chapters].reverse().find(c => pos >= c.bookStart - 0.25) || chapters[0];
            await this.db.put('notes', {
              id: Utils.uid('note'), bookId: sel.id, chapterIndex: ch ? chapters.indexOf(ch) : 0, chapterTitle: ch?.title || '',
              bookTime: pos, type: wrap.querySelector('#note-type-sel').value, tags, text, highlightText: '', linkedNoteIds: [],
              createdAt: Date.now(), updatedAt: Date.now()
            });
            await this.refreshData(); UI.closeModal(); UI.toast('Note saved to Knowledge Vault.', 'success');
          }
        }
      ]
    });
  }

  openConnectIdeaModal(noteId) {
    const note = this.notes.find(n => n.id === noteId); if (!note) return;
    const others = this.notes.filter(n => n.id !== noteId);
    if (!others.length) return UI.toast('Create another note first to connect ideas.');
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = others.map(o => {
      const bk = this.books.find(b => b.id === o.bookId);
      const checked = (note.linkedNoteIds || []).includes(o.id);
      return `<label class="list-item-row" style="cursor:pointer;"><span><strong>${Utils.escapeHtml(bk?.title || '')}</strong>: ${Utils.escapeHtml(o.text.slice(0, 64))}</span><input type="checkbox" value="${o.id}" ${checked ? 'checked' : ''}></label>`;
    }).join('');
    UI.openModal({
      title: 'Connect Related Ideas', bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Save Connections', className: 'btn-primary',
          onClick: async () => {
            note.linkedNoteIds = Array.from(wrap.querySelectorAll('input:checked')).map(c => c.value);
            note.updatedAt = Date.now();
            await this.db.put('notes', note); await this.refreshData(); UI.closeModal(); UI.toast('Connections updated.', 'success');
          }
        }
      ]
    });
  }

  openCreateCollectionModal() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label class="field-label">Collection Name <input type="text" id="new-col-name" placeholder="e.g., Philosophy, Currently Studying"></label>`;
    UI.openModal({
      title: 'New Personal Collection', bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        { label: 'Create', className: 'btn-primary', onClick: async () => {
          const name = wrap.querySelector('#new-col-name').value.trim(); if (!name) return;
          await this.db.put('collections', { id: Utils.uid('col'), name, description: '', orderIndex: this.collections.length, createdAt: Date.now() });
          await this.refreshData(); UI.closeModal(); UI.toast(`Collection "${name}" created.`, 'success');
        } }
      ]
    });
  }

  openEditBookModal(book) {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid form-grid-2';
    wrap.innerHTML = `
      <label class="field-label">Title <input type="text" id="ed-title" value="${Utils.escapeHtml(book.title)}"></label>
      <label class="field-label">Author <input type="text" id="ed-author" value="${Utils.escapeHtml(book.author)}"></label>
      <label class="field-label">Narrator <input type="text" id="ed-narrator" value="${Utils.escapeHtml(book.narrator)}"></label>
      <label class="field-label">Series <input type="text" id="ed-series" value="${Utils.escapeHtml(book.series)}"></label>
      <label class="field-label">Series # <input type="number" id="ed-series-idx" value="${book.seriesIndex ?? ''}"></label>
      <label class="field-label">Genre <input type="text" id="ed-genre" value="${Utils.escapeHtml(book.genre)}"></label>
    `;
    UI.openModal({
      title: 'Edit Metadata', bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        { label: 'Save Changes', className: 'btn-primary', onClick: async () => {
          book.title = wrap.querySelector('#ed-title').value.trim() || book.title;
          book.author = wrap.querySelector('#ed-author').value.trim();
          book.narrator = wrap.querySelector('#ed-narrator').value.trim();
          book.series = wrap.querySelector('#ed-series').value.trim();
          const si = wrap.querySelector('#ed-series-idx').value; book.seriesIndex = si ? Number(si) : null;
          book.genre = wrap.querySelector('#ed-genre').value.trim();
          await this.db.put('books', book); await this.refreshData(); UI.closeModal(); UI.toast('Metadata updated.', 'success');
        } }
      ]
    });
  }

  async deleteBookById(bookId) {
    const book = this.books.find(b => b.id === bookId); if (!book) return;
    if (this.player.book?.id === book.id) {
      this.player.unloadBook(); this.renderMiniPlayerVisibility(); document.getElementById('full-player').hidden = true;
    }
    const files = await this.db.getByIndex('files', 'bookId', book.id);
    for (const f of files) { await MediaStorage.deleteAudioCopy(f); await this.db.delete('files', f.id); }
    for (const c of await this.db.getByIndex('chapters', 'bookId', book.id)) await this.db.delete('chapters', c.id);
    for (const bm of this.bookmarks.filter(x => x.bookId === book.id)) await this.db.delete('bookmarks', bm.id);
    for (const nt of this.notes.filter(x => x.bookId === book.id)) await this.db.delete('notes', nt.id);
    await this.db.delete('progress', book.id); await this.db.delete('coverage', book.id);
    await this.db.delete('transcripts', book.id); await this.db.delete('books', book.id);
  }

  async deleteBookWithConfirm(book) {
    const ok = await UI.confirm({ title: 'Remove Audiobook', message: `Remove "${book.title}" and its local browser audio copies, coverage, bookmarks, and notes?`, confirmLabel: 'Remove Book', danger: true });
    if (!ok) return;
    await this.deleteBookById(book.id);
    await this.refreshData();
    this.navigate('library');
    UI.toast('Audiobook removed.');
  }

  async exportBackup() {
    const payload = {
      app: APP_CONFIG.appName, version: APP_CONFIG.version, schemaVersion: APP_CONFIG.schemaVersion, exportedAt: new Date().toISOString(),
      data: {
        books: await this.db.getAll('books'), chapters: await this.db.getAll('chapters'),
        progress: await this.db.getAll('progress'), coverage: await this.db.getAll('coverage'),
        sessions: await this.db.getAll('sessions'), bookmarks: await this.db.getAll('bookmarks'),
        notes: await this.db.getAll('notes'), collections: await this.db.getAll('collections'),
        transcripts: await this.db.getAll('transcripts'), settings: await this.db.getAll('settings')
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `cadence-backup-${Utils.localDateKey()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.toast('Backup exported.', 'success');
  }

  async previewAndRestoreBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.data || !Array.isArray(parsed.data.books)) return UI.toast('Invalid Cadence backup file.', 'error');
      const d = parsed.data;
      const wrap = document.createElement('div');
      wrap.className = 'form-grid';
      wrap.innerHTML = `
        <p class="setting-desc">Backup v${Utils.escapeHtml(parsed.version || '?')} exported ${Utils.escapeHtml(parsed.exportedAt || '')}</p>
        <div class="metric-pair-grid">
          <div class="metric-tile"><span class="metric-val">${d.books.length}</span><span class="metric-lbl">Books</span></div>
          <div class="metric-tile"><span class="metric-val">${(d.notes || []).length + (d.bookmarks || []).length}</span><span class="metric-lbl">Notes &amp; Bookmarks</span></div>
        </div>
        <label style="display:flex;gap:8px;font-size:0.85rem;"><input type="radio" name="restore-mode" value="merge" checked> Merge with existing records</label>
        <label style="display:flex;gap:8px;font-size:0.85rem;"><input type="radio" name="restore-mode" value="replace"> Replace existing library &amp; history</label>
      `;
      UI.openModal({
        title: 'Restore Backup', bodyEl: wrap,
        footerButtons: [
          { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
          { label: 'Apply Restore', className: 'btn-primary', onClick: async () => {
            const mode = wrap.querySelector('input[name="restore-mode"]:checked')?.value || 'merge';
            const stores = ['books', 'chapters', 'progress', 'coverage', 'sessions', 'bookmarks', 'notes', 'collections', 'transcripts', 'settings'];
            if (mode === 'replace') for (const s of stores) await this.db.clearStore(s);
            for (const s of stores) if (Array.isArray(d[s]) && d[s].length) await this.db.putMany(s, d[s]);
            await this._loadSettings(); this.applyTheme(); await this.refreshData(); UI.closeModal();
            UI.toast('Backup restored. Use "Re-link Missing Audio" on restored books to attach audio files.', 'success', 5000);
          } }
        ]
      });
    } catch { UI.toast('Could not parse backup JSON.', 'error'); }
  }

  openSleepTimerModal() {
    const wrap = document.createElement('div'); wrap.className = 'form-grid form-grid-2';
    [
      { label: 'Off', mode: 'off', min: 0 }, { label: '15 Minutes', mode: 'minutes', min: 15 },
      { label: '30 Minutes', mode: 'minutes', min: 30 }, { label: '45 Minutes', mode: 'minutes', min: 45 },
      { label: '60 Minutes', mode: 'minutes', min: 60 }, { label: 'End of Chapter', mode: 'end-chapter', min: 0 },
      { label: 'End of Book', mode: 'end-book', min: 0 }
    ].forEach(opt => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn btn-secondary'; btn.textContent = opt.label;
      btn.addEventListener('click', () => { this.player.setSleepTimer(opt.mode, opt.min); UI.closeModal(); });
      wrap.appendChild(btn);
    });
    UI.openModal({ title: 'Sleep Timer', bodyEl: wrap });
  }

  openShortcutsModal() {
    UI.openModal({
      title: 'Keyboard Shortcuts',
      bodyHtml: `
        <div class="list-item-row"><span>Command Palette</span><strong>Cmd / Ctrl + K</strong></div>
        <div class="list-item-row"><span>Play / Pause</span><strong>Space</strong></div>
        <div class="list-item-row"><span>Skip Backward / Forward</span><strong>Left / Right Arrow</strong></div>
        <div class="list-item-row"><span>Previous / Next Chapter</span><strong>Shift + Left / Right</strong></div>
        <div class="list-item-row"><span>Quick Bookmark / New Note</span><strong>B / N</strong></div>
        <div class="list-item-row"><span>Toggle Full Player / Mute</span><strong>F / M</strong></div>
      `
    });
  }

  openFullResetModal() {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <p>Are you sure you want to perform a <strong>full reset</strong>?</p>
      <p class="setting-desc">This will permanently delete all audiobooks, local audio files, playback coverage, bookmarks, notes, transcripts, collections, and settings from this device.</p>
      <button type="button" class="hold-reset-btn" id="hold-reset-btn">
        <span class="hold-reset-progress" id="hold-reset-progress"></span>
        <span class="hold-reset-label" id="hold-reset-label">Hold for 5s to Reset Everything</span>
      </button>
    `;

    const btn = wrap.querySelector('#hold-reset-btn');
    const bar = wrap.querySelector('#hold-reset-progress');
    const lbl = wrap.querySelector('#hold-reset-label');
    const HOLD_MS = 5000;
    let rafId = null;
    let startAt = 0;
    let completed = false;

    const resetHold = () => {
      if (completed) return;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      btn.classList.remove('is-holding');
      bar.style.width = '0%';
      lbl.textContent = 'Hold for 5s to Reset Everything';
    };

    const tick = () => {
      const elapsed = performance.now() - startAt;
      const pct = Utils.clamp((elapsed / HOLD_MS) * 100, 0, 100);
      bar.style.width = `${pct.toFixed(1)}%`;
      const remSec = Math.max(1, Math.ceil((HOLD_MS - elapsed) / 1000));
      if (elapsed >= HOLD_MS) {
        completed = true;
        rafId = null;
        bar.style.width = '100%';
        lbl.textContent = 'Resetting…';
        btn.disabled = true;
        Utils.haptic(25);
        this.performFullReset();
        return;
      }
      lbl.textContent = `Keep holding… ${remSec}s`;
      rafId = requestAnimationFrame(tick);
    };

    const startHold = (e) => {
      if (completed || rafId) return;
      if (e.type === 'pointerdown' && e.button !== 0) return;
      e.preventDefault();
      try { btn.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
      btn.classList.add('is-holding');
      startAt = performance.now();
      Utils.haptic(8);
      rafId = requestAnimationFrame(tick);
    };

    btn.addEventListener('pointerdown', startHold);
    btn.addEventListener('pointerup', resetHold);
    btn.addEventListener('pointercancel', resetHold);
    btn.addEventListener('pointerleave', resetHold);
    btn.addEventListener('keydown', (e) => {
      if ((e.code === 'Space' || e.code === 'Enter') && !e.repeat) startHold(e);
    });
    btn.addEventListener('keyup', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') resetHold();
    });
    btn.addEventListener('blur', resetHold);

    UI.openModal({
      title: 'Confirm Full Reset',
      bodyEl: wrap,
      footerButtons: [{ label: 'Cancel', className: 'btn-secondary', onClick: () => { resetHold(); UI.closeModal(); } }],
      onClose: resetHold
    });
  }

  async performFullReset() {
    try {
      this.player.unloadBook();
      if (this.db.db) {
        this.db.db.close();
        this.db.db = null;
      }
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(APP_CONFIG.dbName);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      });
      if (navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          await root.removeEntry('cadence_audio', { recursive: true });
        } catch { /* noop */ }
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      try { localStorage.clear(); sessionStorage.clear(); } catch { /* noop */ }
      UI.closeModal();
      UI.toast('All local data cleared. Reloading…', 'info', 2500);
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      console.error(err);
      UI.toast('Could not complete full reset. Please clear site data in browser settings.', 'error', 5000);
    }
  }

  openGoalsModal() {
    const wrap = document.createElement('div'); wrap.className = 'form-grid';
    wrap.innerHTML = `
      <label class="field-label">Daily Goal (minutes) <input type="number" id="g-daily" value="${this.settings.dailyGoalMin}"></label>
      <label class="field-label">Weekly Goal (minutes) <input type="number" id="g-weekly" value="${this.settings.weeklyGoalMin}"></label>
      <label class="field-label">Monthly Goal (minutes) <input type="number" id="g-monthly" value="${this.settings.monthlyGoalMin}"></label>
    `;
    UI.openModal({
      title: 'Listening Goals', bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        { label: 'Save Goals', className: 'btn-primary', onClick: async () => {
          this.settings.dailyGoalMin = Math.max(5, Number(wrap.querySelector('#g-daily').value) || 30);
          this.settings.weeklyGoalMin = Math.max(15, Number(wrap.querySelector('#g-weekly').value) || 210);
          this.settings.monthlyGoalMin = Math.max(60, Number(wrap.querySelector('#g-monthly').value) || 900);
          await this.saveSettings(); this.renderCurrentRoute(); UI.closeModal();
        } }
      ]
    });
  }

  _bindGlobalEvents() {
    document.querySelectorAll('[data-route]').forEach(btn => btn.addEventListener('click', () => this.navigate(btn.dataset.route)));
    ['sidebar-cmd-btn', 'mobile-cmd-btn'].forEach(id => document.getElementById(id)?.addEventListener('click', () => this.openCommandPalette()));
    document.getElementById('dash-queue-btn')?.addEventListener('click', () => this.openQueueModal());
    document.getElementById('detail-queue-btn')?.addEventListener('click', () => { if (this.selectedBookId) this.addToUpNextQueue(this.selectedBookId); });

    ['sidebar-import-btn', 'mobile-import-btn', 'dash-import-action', 'lib-import-btn', 'lib-empty-import-btn'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => this.openImportChooserModal());
    });
    document.getElementById('empty-import-files-btn').addEventListener('click', () => document.getElementById('file-input-audio').click());
    document.getElementById('empty-import-folder-btn').addEventListener('click', () => document.getElementById('file-input-folder').click());
    document.getElementById('file-input-audio').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      if (files.length) await this.importer.processFileEntries(files.map(f => ({ file: f, path: f.name })));
    });
    document.getElementById('file-input-folder').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []); e.target.value = '';
      if (files.length) await this.importer.processFileEntries(files.map(f => ({ file: f, path: f.webkitRelativePath || f.name })));
    });
    document.body.addEventListener('dragover', (e) => e.preventDefault());
    document.body.addEventListener('drop', async (e) => {
      e.preventDefault(); const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) await this.importer.processFileEntries(files.map(f => ({ file: f, path: f.name })));
    });

    const toggleLightDark = async () => {
      this.settings.themeMode = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      this.applyTheme(); await this.saveSettings();
      if (this.route === 'settings') this.renderSettings();
    };
    document.getElementById('sidebar-theme-toggle').addEventListener('click', toggleLightDark);
    document.getElementById('mobile-theme-btn').addEventListener('click', toggleLightDark);

    // Upgrade #36: Consolidated debounced Library filters
    let libTimer = null;
    document.getElementById('lib-search').addEventListener('input', () => {
      clearTimeout(libTimer); libTimer = setTimeout(() => this.renderLibrary(), 120);
    });
    ['lib-filter-status', 'lib-filter-collection', 'lib-filter-series'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => this.renderLibrary());
    });
    document.getElementById('lib-sort').addEventListener('change', async (e) => {
      this.settings.librarySort = e.target.value; await this.saveSettings(); this.renderLibrary();
    });
    document.querySelectorAll('[data-lib-view]').forEach(btn => btn.addEventListener('click', async () => {
      this.libraryView = btn.dataset.libView; this.settings.libraryView = this.libraryView; await this.saveSettings();
      document.querySelectorAll('[data-lib-view]').forEach(b => b.classList.toggle('is-active', b === btn));
      this.renderLibrary();
    }));
    document.getElementById('lib-density-btn').addEventListener('click', async () => {
      this.settings.libraryDensity = this.settings.libraryDensity === 'compact' ? 'comfortable' : 'compact';
      await this.saveSettings(); this._applyLibraryPrefs();
    });
    document.getElementById('lib-new-collection-btn').addEventListener('click', () => this.openCreateCollectionModal());

    // Batch Select Mode (#33)
    document.getElementById('lib-select-mode-btn').addEventListener('click', () => {
      this.batchMode = !this.batchMode; if (!this.batchMode) this.selectedBatchIds.clear(); this.renderLibrary();
    });
    document.getElementById('batch-cancel-btn').addEventListener('click', () => { this.batchMode = false; this.selectedBatchIds.clear(); this.renderLibrary(); });
    document.getElementById('batch-select-all').addEventListener('click', () => {
      this.books.forEach(b => this.selectedBatchIds.add(b.id)); this.renderLibrary();
    });
    document.getElementById('batch-mark-complete').addEventListener('click', async () => {
      for (const id of this.selectedBatchIds) {
        const b = this.books.find(x => x.id === id);
        if (b) { b.completed = true; await this.db.put('books', b); }
      }
      this.batchMode = false; this.selectedBatchIds.clear(); await this.refreshData(); UI.toast('Marked selected books completed.', 'success');
    });
    document.getElementById('batch-assign-col').addEventListener('click', () => {
      if (!this.collections.length) return UI.toast('Create a collection first.', 'error');
      const wrap = document.createElement('div');
      wrap.innerHTML = `<select id="batch-col-sel" style="width:100%;">${this.collections.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('')}</select>`;
      UI.openModal({
        title: 'Assign Selected to Collection', bodyEl: wrap,
        footerButtons: [{ label: 'Assign', className: 'btn-primary', onClick: async () => {
          const cid = wrap.querySelector('#batch-col-sel').value;
          for (const id of this.selectedBatchIds) {
            const b = this.books.find(x => x.id === id);
            if (b) { b.collectionIds = [...new Set([...(b.collectionIds || []), cid])]; await this.db.put('books', b); }
          }
          this.batchMode = false; this.selectedBatchIds.clear(); await this.refreshData(); UI.closeModal(); UI.toast('Updated collections.', 'success');
        } }]
      });
    });
    document.getElementById('batch-delete-btn').addEventListener('click', async () => {
      if (!this.selectedBatchIds.size) return;
      const ok = await UI.confirm({ title: 'Remove Selected Books', message: `Remove ${this.selectedBatchIds.size} selected book(s)?`, confirmLabel: 'Remove', danger: true });
      if (!ok) return;
      for (const id of this.selectedBatchIds) await this.deleteBookById(id);
      this.batchMode = false; this.selectedBatchIds.clear(); await this.refreshData(); UI.toast('Removed selected books.');
    });

    document.getElementById('detail-back-btn').addEventListener('click', () => this.navigate('library'));
    document.getElementById('detail-edit-btn').addEventListener('click', () => { const b = this.books.find(x => x.id === this.selectedBookId); if (b) this.openEditBookModal(b); });
    document.getElementById('detail-delete-btn').addEventListener('click', () => { const b = this.books.find(x => x.id === this.selectedBookId); if (b) this.deleteBookWithConfirm(b); });

    document.getElementById('vault-new-note-btn').addEventListener('click', () => this.openNewNoteModal());
    document.getElementById('vault-export-md-btn').addEventListener('click', () => this.exportVault('md'));
    document.getElementById('vault-export-csv-btn').addEventListener('click', () => this.exportVault('csv'));
    ['vault-search', 'vault-filter-type', 'vault-filter-book', 'vault-filter-tag'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => this.renderVault());
      document.getElementById(id).addEventListener('change', () => this.renderVault());
    });

    document.getElementById('stats-edit-goals-btn').addEventListener('click', () => this.openGoalsModal());

    document.querySelectorAll('[data-theme-mode]').forEach(btn => btn.addEventListener('click', async () => {
      this.settings.themeMode = btn.dataset.themeMode; this.applyTheme(); await this.saveSettings(); this.renderSettings();
    }));
    document.querySelectorAll('[data-palette-choice]').forEach(btn => btn.addEventListener('click', async () => {
      this.settings.palette = btn.dataset.paletteChoice; this.applyTheme(); await this.saveSettings(); this.renderSettings();
    }));
    document.getElementById('setting-default-speed').addEventListener('change', async (e) => { this.settings.defaultSpeed = Number(e.target.value); await this.saveSettings(); });
    document.getElementById('setting-smart-rewind').addEventListener('change', async (e) => { this.settings.smartRewind = Number(e.target.value); await this.saveSettings(); });
    document.getElementById('setting-skip-back').addEventListener('change', async (e) => { this.settings.skipBack = Number(e.target.value); await this.saveSettings(); this.renderPlaybackUI(); });
    document.getElementById('setting-skip-fwd').addEventListener('change', async (e) => { this.settings.skipFwd = Number(e.target.value); await this.saveSettings(); this.renderPlaybackUI(); });
    document.getElementById('setting-webaudio-enabled').addEventListener('change', async (e) => { this.settings.webAudioEnabled = e.target.checked; this.player.applyEQ(); await this.saveSettings(); });
    document.getElementById('setting-haptics-enabled').addEventListener('change', async (e) => { this.settings.hapticsEnabled = e.target.checked; await this.saveSettings(); });

    document.getElementById('btn-request-persist').addEventListener('click', async () => {
      if (!navigator.storage?.persist) return UI.toast('Persistent storage API unavailable.', 'error');
      const granted = await navigator.storage.persist();
      UI.toast(granted ? 'Persistent storage granted.' : 'Browser kept best-effort policy.');
      this.renderSettings();
    });
    document.getElementById('btn-purge-audio-blobs').addEventListener('click', async () => {
      const ok = await UI.confirm({ title: 'Remove Local Audio Copies', message: 'Free storage by removing cached audio? Notes, bookmarks, and coverage remain preserved.', confirmLabel: 'Remove Copies', danger: true });
      if (!ok) return;
      for (const f of await this.db.getAll('files')) {
        if (f.storageMode === 'local-copy') { await MediaStorage.deleteAudioCopy(f); f.blob = null; await this.db.put('files', f); }
      }
      await this.refreshData(); this.renderSettings(); UI.toast('Local audio copies removed.');
    });
    document.getElementById('btn-export-backup').addEventListener('click', () => this.exportBackup());
    document.getElementById('btn-restore-backup').addEventListener('click', () => document.getElementById('file-input-backup').click());
    document.getElementById('file-input-backup').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) this.previewAndRestoreBackup(f); });
    document.getElementById('sidebar-shortcuts-btn').addEventListener('click', () => this.openShortcutsModal());
    document.getElementById('btn-open-shortcuts').addEventListener('click', () => this.openShortcutsModal());
    document.getElementById('btn-full-reset')?.addEventListener('click', () => this.openFullResetModal());

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this._deferredInstallPrompt = e;
      this._syncInstallUI();
    });
    window.addEventListener('appinstalled', () => {
      this._deferredInstallPrompt = null;
      this._syncInstallUI();
      UI.toast('Cadence installed on your device!', 'success');
    });
    document.getElementById('btn-install-pwa')?.addEventListener('click', async () => {
      if (!this._deferredInstallPrompt) return;
      this._deferredInstallPrompt.prompt();
      const { outcome } = await this._deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') this._deferredInstallPrompt = null;
      this._syncInstallUI();
    });
    document.getElementById('btn-check-updates')?.addEventListener('click', async () => {
      if (this._pendingUpdateReload) { window.location.reload(); return; }
      if (!this._swReg) return UI.toast('Offline service worker is not active in this environment.', 'info');
      try {
        await this._swReg.update();
        if (this._swReg.installing || this._swReg.waiting) UI.toast('Downloading update…', 'info');
        else UI.toast(`Cadence v${APP_CONFIG.version} is up to date.`, 'success');
      } catch {
        UI.toast('Could not check for updates while offline.', 'error');
      }
    });

    // Mini Player & Swipe Gestures (#15)
    document.getElementById('mini-expand-btn').addEventListener('click', () => { document.getElementById('full-player').hidden = false; this.renderPlaybackUI(); });
    this._bindMiniPlayerSwipes();
    document.getElementById('fp-close-btn').addEventListener('click', () => { document.getElementById('full-player').hidden = true; });
    document.getElementById('fp-view-book-btn').addEventListener('click', () => { document.getElementById('full-player').hidden = true; if (this.player.book) this.navigate('book-detail', this.player.book.id); });
    this._bindSheetDragClose();

    document.getElementById('mini-play-btn').addEventListener('click', () => this.player.togglePlay());
    document.getElementById('fp-play-btn').addEventListener('click', () => this.player.togglePlay());
    document.getElementById('mini-back-btn').addEventListener('click', () => this.player.skip(-this.settings.skipBack));
    document.getElementById('fp-skip-back-btn').addEventListener('click', () => this.player.skip(-this.settings.skipBack));
    document.getElementById('mini-fwd-btn').addEventListener('click', () => this.player.skip(this.settings.skipFwd));
    document.getElementById('fp-skip-fwd-btn').addEventListener('click', () => this.player.skip(this.settings.skipFwd));
    document.getElementById('fp-prev-chap-btn').addEventListener('click', () => this.player.jumpChapter(-1));
    document.getElementById('fp-next-chap-btn').addEventListener('click', () => this.player.jumpChapter(1));
    document.getElementById('fp-speed-down').addEventListener('click', () => this.player.setSpeed(this.player.audio.playbackRate - 0.05));
    document.getElementById('fp-speed-up').addEventListener('click', () => this.player.setSpeed(this.player.audio.playbackRate + 0.05));
    document.querySelectorAll('#fp-speed-presets .sp-btn').forEach(btn => btn.addEventListener('click', () => this.player.setSpeed(Number(btn.dataset.speed))));
    document.getElementById('fp-sleep-btn').addEventListener('click', () => this.openSleepTimerModal());
    document.getElementById('mini-bookmark-btn').addEventListener('click', () => this.createQuickBookmark());
    document.getElementById('fp-bookmark-btn').addEventListener('click', () => this.createQuickBookmark());
    document.getElementById('fp-note-btn').addEventListener('click', () => this.openNewNoteModal(this.player.book));
    document.getElementById('fp-mute-btn').addEventListener('click', () => this.player.toggleMute());
    document.getElementById('fp-volume').addEventListener('input', (e) => { this.player.setVolume(Number(e.target.value)); Utils.setRangeFill(e.target); });

    document.getElementById('fp-timeline-scope-toggle').addEventListener('click', () => {
      this.timelineScope = this.timelineScope === 'book' ? 'chapter' : 'book';
      document.getElementById('fp-timeline-scope-label').textContent = this.timelineScope === 'book' ? 'Book Timeline & Coverage' : 'Chapter Timeline & Coverage';
      document.getElementById('fp-timeline-scope-toggle').textContent = this.timelineScope === 'book' ? 'Switch to Chapter View' : 'Switch to Book View';
      this.renderPlaybackTick(true);
    });

    document.querySelectorAll('[data-fp-tab]').forEach(tab => tab.addEventListener('click', () => {
      this.fullPlayerTab = tab.dataset.fpTab;
      document.querySelectorAll('[data-fp-tab]').forEach(t => { t.classList.toggle('is-active', t === tab); t.setAttribute('aria-selected', String(t === tab)); });
      document.querySelectorAll('.fp-tab-panel').forEach(p => { p.hidden = p.id !== `fp-panel-${this.fullPlayerTab}`; });
      this._renderFullPlayerToolPanel();
    }));

    document.getElementById('modal-close-btn').addEventListener('click', () => UI.closeModal());
    document.getElementById('modal-backdrop').addEventListener('click', (e) => { if (e.target.id === 'modal-backdrop') UI.closeModal(); });
    document.addEventListener('keydown', (e) => UI.trapFocus(e));

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.openCommandPalette(); return; }
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.key === 'Escape') {
        if (!document.getElementById('modal-backdrop').hidden) UI.closeModal();
        else if (!document.getElementById('full-player').hidden) document.getElementById('full-player').hidden = true;
      } else if (e.code === 'Space' && this.player.book) { e.preventDefault(); this.player.togglePlay(); }
      else if (e.key === 'ArrowLeft' && this.player.book && !e.target.closest('.coverage-timeline')) { if (e.shiftKey) this.player.jumpChapter(-1); else this.player.skip(-this.settings.skipBack); }
      else if (e.key === 'ArrowRight' && this.player.book && !e.target.closest('.coverage-timeline')) { if (e.shiftKey) this.player.jumpChapter(1); else this.player.skip(this.settings.skipFwd); }
      else if (e.key.toLowerCase() === 'b' && this.player.book) this.createQuickBookmark();
      else if (e.key.toLowerCase() === 'n' && this.player.book) this.openNewNoteModal(this.player.book);
      else if (e.key.toLowerCase() === 'm' && this.player.book) this.player.toggleMute();
      else if (e.key.toLowerCase() === 'f' && this.player.book) { const fp = document.getElementById('full-player'); fp.hidden = !fp.hidden; if (!fp.hidden) this.renderPlaybackUI(); }
    });

    const safeFlush = () => { this.player.saveProgress(); this.coverage.flush(true); };
    window.addEventListener('pagehide', safeFlush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') safeFlush(); });
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (this.settings.themeMode === 'system') this.applyTheme(); });
    if (window.matchMedia('(hover: hover)').matches) {
      document.addEventListener('pointermove', (e) => {
        const card = e.target?.closest?.('.dash-hero-card, .dash-panel, .book-card, .vault-card');
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty('--px', `${((e.clientX - r.left) / Math.max(1, r.width) * 100).toFixed(1)}%`);
        card.style.setProperty('--py', `${((e.clientY - r.top) / Math.max(1, r.height) * 100).toFixed(1)}%`);
      }, { passive: true });
    }
  }

  _bindMiniPlayerSwipes() {
    const mp = document.getElementById('mini-player');
    let sx = 0, sy = 0;
    mp.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    mp.addEventListener('pointerup', (e) => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (dy < -42 && Math.abs(dy) > Math.abs(dx)) { document.getElementById('full-player').hidden = false; this.renderPlaybackUI(); }
      else if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { this.player.skip(dx > 0 ? this.settings.skipFwd : -this.settings.skipBack); }
    });
  }

  _bindSheetDragClose() {
    const handle = document.getElementById('fp-sheet-handle'), sheet = document.querySelector('#full-player .full-player-surface');
    if (!handle || !sheet) return;
    let startY = 0, dragging = false;
    handle.addEventListener('pointerdown', (e) => { dragging = true; startY = e.clientY; try { handle.setPointerCapture?.(e.pointerId); } catch { /* noop */ } sheet.style.transition = 'none'; });
    handle.addEventListener('pointermove', (e) => { if (!dragging) return; const dy = Math.max(0, e.clientY - startY); sheet.style.transform = `translate3d(0,${Math.min(dy, 200)}px,0)`; sheet.style.opacity = String(1 - Math.min(dy, 200) / 260); });
    const finish = (e) => {
      if (!dragging) return; dragging = false; const dy = Math.max(0, e.clientY - startY);
      sheet.style.transition = ''; sheet.style.opacity = ''; sheet.style.transform = '';
      if (dy > 110) document.getElementById('full-player').hidden = true;
    };
    handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new CadenceApp();
  app.start().catch(err => {
    console.error(err);
    UI.toast('Failed to initialise local database. Check browser storage permissions.', 'error', 6000);
  });
});