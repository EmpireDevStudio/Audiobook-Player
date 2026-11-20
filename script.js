/* ==========================================================================
   CADENCE AUDIOBOOK COMMAND CENTRE — CORE APPLICATION ENGINE v2 "LUMEN"
   Local-First | Coverage & Recovery | Web Audio EQ | Binary Metadata Parser
   v2: hidden-attr bug fixes, live timeline scrubbing, session consolidation,
   volume control, speed presets, focus-trapped bottom-sheet modals, toasts,
   richer playback surfaces, mobile sheet gestures.
   ========================================================================== */

'use strict';

/* --------------------------------------------------------------------------
   1. DEVELOPER CONFIGURATION & BANNER
   -------------------------------------------------------------------------- */

const APP_CONFIG = {
  appName: 'Cadence',
  version: '2.0.0',
  schemaVersion: 1,
  dbName: 'cadence_audiobook_command_centre',
  defaultPalette: 'graphite',
  defaultThemeMode: 'dark'
};

/**
 * Customisable Announcement Banner — disabled initially.
 * Set enabled: true and populate message/button fields when needed.
 */
const BANNER_CONFIG = {
  enabled: false,
  message: '',
  showButton: false,
  buttonText: '',
  buttonUrl: '',
  openInNewTab: false
};

/* --------------------------------------------------------------------------
   2. UTILITIES & CAPABILITY DETECTION
   -------------------------------------------------------------------------- */

const Utils = {
  uid(prefix = 'id') {
    if (crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  },

  clamp(val, min, max) {
    return Math.min(max, Math.max(min, val));
  },

  nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  },

  formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) sec = 0;
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
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
    let idx = 0;
    let v = bytes;
    while (v >= 1024 && idx < units.length - 1) {
      v /= 1024;
      idx++;
    }
    return `${v.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  },

  localDateKey(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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

  isSafeUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  },

  setRangeFill(input) {
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 1;
    const val = Number(input.value);
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
   3. TOAST & MODAL SYSTEMS v2
   -------------------------------------------------------------------------- */

const UI = {
  toast(msg, kind = 'info', duration = 3600) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${kind === 'error' ? 'is-error' : kind === 'success' ? 'is-success' : ''}`;
    const iconChar = kind === 'error' ? '!' : kind === 'success' ? '✓' : 'i';
    el.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${iconChar}</span>
      <span class="toast-msg">${Utils.escapeHtml(msg)}</span>
      <span class="toast-progress" style="animation-duration:${duration}ms"></span>
    `;
    container.appendChild(el);
    const dismiss = () => {
      if (!el.isConnected) return;
      el.classList.add('is-leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 600);
    };
    setTimeout(dismiss, duration);
  },

  _lastFocus: null,

  openModal({ title, bodyEl, bodyHtml, footerButtons = [], onClose = null }) {
    this._lastFocus = document.activeElement;
    this._onClose = onClose || null;
    const backdrop = document.getElementById('modal-backdrop');
    const titleEl = document.getElementById('modal-title');
    const body = document.getElementById('modal-body');
    const footer = document.getElementById('modal-footer');

    titleEl.textContent = title;
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
    if (this._onClose) {
      const fn = this._onClose;
      this._onClose = null;
      fn();
    }
    if (this._lastFocus && typeof this._lastFocus.focus === 'function') {
      this._lastFocus.focus();
    }
  },

  isModalOpen() {
    return !document.getElementById('modal-backdrop').hidden;
  },

  /** Keep keyboard focus imprisoned inside an open modal dialog. */
  trapFocus(e) {
    const backdrop = document.getElementById('modal-backdrop');
    if (backdrop.hidden || e.key !== 'Tab') return;
    const dialog = document.getElementById('modal-dialog');
    const focusables = dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const visible = Array.from(focusables).filter(el => !el.disabled && el.offsetParent !== null);
    if (!visible.length) return;
    const first = visible[0];
    const last = visible[visible.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    } else if (!dialog.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    }
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
   4. LOCAL DATABASE LAYER (IndexedDB + Versioned Migrations)
   Schema identical to v1 — existing user libraries upgrade in place.
   -------------------------------------------------------------------------- */

class DatabaseManager {
  constructor() {
    this.db = null;
  }

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
      req.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  _tx(storeNames, mode = 'readonly') {
    return this.db.transaction(storeNames, mode);
  }

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

/* --------------------------------------------------------------------------
   5. OPFS AUDIO STORAGE HELPER (With IndexedDB Blob Fallback)
   -------------------------------------------------------------------------- */

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
      } catch {
        // Fallback to IndexedDB Blob
      }
    }
    return { storageKind: 'idb', blob: fileOrBlob };
  },

  async readAudioFile(fileRec) {
    if (fileRec.storageMode === 'local-copy') {
      if (fileRec.storageKind === 'opfs' && navigator.storage?.getDirectory) {
        try {
          const root = await navigator.storage.getDirectory();
          const dir = await root.getDirectoryHandle('cadence_audio');
          const fh = await dir.getFileHandle(fileRec.id);
          return await fh.getFile();
        } catch {
          return null;
        }
      }
      if (fileRec.blob) return fileRec.blob;
    }

    if (fileRec.storageMode === 'reference' && fileRec.fileHandle) {
      const handle = fileRec.fileHandle;
      if (handle.queryPermission) {
        let perm = await handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted' && handle.requestPermission) {
          perm = await handle.requestPermission({ mode: 'read' });
        }
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
      } catch {
        // Already removed
      }
    }
  }
};
/* --------------------------------------------------------------------------
   6. PURE-JS METADATA, ARTWORK & M4B/ID3 CHAPTER PARSER
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
      a.onloadedmetadata = () => {
        clearTimeout(timer);
        const dur = Number.isFinite(a.duration) ? a.duration : 0;
        cleanup();
        resolve(dur);
      };
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
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
      bmp.close();
      return canvas.toDataURL('image/jpeg', 0.84);
    } catch {
      return null;
    }
  },

  async parseFile(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const meta = {
      title: '', author: '', narrator: '', album: '', genre: '', year: '',
      trackNumber: null, discNumber: null, artworkDataUrl: null, chapters: []
    };

    try {
      const headBuf = await file.slice(0, Math.min(file.size, 4 * 1024 * 1024)).arrayBuffer();
      const bytes = new Uint8Array(headBuf);
      if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
        await this._parseID3v2(bytes, meta);
      } else if (ext === 'm4b' || ext === 'm4a' || ext === 'mp4' || this._hasFtyp(bytes)) {
        await this._parseMP4(file, meta);
      }
    } catch {
      // Non-fatal fallback to filename
    }

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
      if (encodingByte === 1 || encodingByte === 2) {
        return new TextDecoder(encodingByte === 1 ? 'utf-16' : 'utf-16be').decode(bytes).replace(/\0/g, '').trim();
      }
      if (encodingByte === 3) return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
      return new TextDecoder('iso-8859-1').decode(bytes).replace(/\0/g, '').trim();
    } catch {
      return '';
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
    let offset = 0;
    let moovBuffer = null;

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
                const len = bytes[cp + 8];
                cp += 9;
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
   7. PLAYBACK COVERAGE & RECOVERY ENGINE
   v2: listening sessions are consolidated — a continuous listening block
   updates one session record instead of spawning a row every few seconds.
   -------------------------------------------------------------------------- */

const CoverageStates = {
  IDLE: 'IDLE',
  PREPARING: 'PREPARING',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  SEEKING: 'SEEKING',
  BUFFERING: 'BUFFERING',
  SWITCHING_FILE: 'SWITCHING_FILE',
  ENDED: 'ENDED',
  INTERRUPTED: 'INTERRUPTED'
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
    this.sessionAccumSeconds = 0;
    this.sessionStartCovered = 0;
    this.lastPersistAt = 0;
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
    this.sessionAccumSeconds = 0;
    this.sessionStartCovered = this.getUniqueCoveredSeconds();
    this._activeSessionId = null;
    this.state = CoverageStates.PREPARING;
  }

  setState(newState, bookPos = null) {
    if (!this.bookId) return;
    if (
      newState === CoverageStates.SEEKING ||
      newState === CoverageStates.PAUSED ||
      newState === CoverageStates.SWITCHING_FILE ||
      newState === CoverageStates.ENDED ||
      newState === CoverageStates.INTERRUPTED
    ) {
      this._commitActiveSegment();
      this.confirmedBookPos = null;
    }
    this.state = newState;
    if (newState === CoverageStates.PLAYING && bookPos !== null) {
      this.confirmedBookPos = bookPos;
      this.activeSegStart = bookPos;
      this.activeSegEnd = bookPos;
      if (!this.sessionStartWall) this.sessionStartWall = Date.now();
    }
  }

  recordTick(currentBookPos) {
    if (!this.bookId || this.state !== CoverageStates.PLAYING || !Number.isFinite(currentBookPos)) return;

    if (this.confirmedBookPos === null) {
      this.confirmedBookPos = currentBookPos;
      this.activeSegStart = currentBookPos;
      this.activeSegEnd = currentBookPos;
      return;
    }

    const delta = currentBookPos - this.confirmedBookPos;
    const maxExpectedStep = Math.max(3.5, 2.5 * this.playbackRate);
    if (delta < -0.5 || delta > maxExpectedStep) {
      this._commitActiveSegment();
      this.confirmedBookPos = currentBookPos;
      this.activeSegStart = currentBookPos;
      this.activeSegEnd = currentBookPos;
      return;
    }

    if (delta > 0) {
      this.activeSegEnd = currentBookPos;
      this.totalListeningSeconds += delta;
      this.sessionAccumSeconds += delta;
      this.confirmedBookPos = currentBookPos;
    }

    if (Date.now() - this.lastPersistAt > 5000) {
      this.flush(false);
    }
  }

  _commitActiveSegment() {
    if (this.activeSegStart !== null && this.activeSegEnd !== null && this.activeSegEnd - this.activeSegStart >= 0.4) {
      const clampedStart = Utils.clamp(this.activeSegStart, 0, this.bookDuration || this.activeSegEnd);
      const clampedEnd = Utils.clamp(this.activeSegEnd, 0, this.bookDuration || this.activeSegEnd);
      if (clampedEnd > clampedStart) {
        this.intervals = this.mergeIntervals([...this.intervals, [clampedStart, clampedEnd]]);
      }
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
      const prev = merged[merged.length - 1];
      const curr = sorted[i];
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

  getUniqueCoveredSeconds() {
    return this.getLiveIntervals().reduce((acc, [a, b]) => acc + (b - a), 0);
  }

  getCoveragePercent() {
    if (!this.bookDuration) return 0;
    return Utils.clamp((this.getUniqueCoveredSeconds() / this.bookDuration) * 100, 0, 100);
  }

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

  async unmarkRange(start, end) {
    if (!this.bookId || end <= start) return;
    const next = [];
    for (const [a, b] of this.intervals) {
      if (b <= start || a >= end) next.push([a, b]);
      else {
        if (a < start) next.push([a, start]);
        if (b > end) next.push([end, b]);
      }
    }
    this.intervals = this.mergeIntervals(next);
    await this.flush(false);
  }

  async resetCoverage() {
    if (!this.bookId) return;
    this.intervals = [];
    this.activeSegStart = null;
    this.activeSegEnd = null;
    this.totalListeningSeconds = 0;
    this._activeSessionId = null;
    await this.db.put('coverage', {
      bookId: this.bookId, intervals: [], totalListeningSeconds: 0, updatedAt: Date.now()
    });
  }

  /**
   * v2 session persistence: one record per continuous listening block.
   * A pause longer than 10 minutes starts a new record; anything shorter
   * extends the previous one for the same book.
   */
  async _persistSession(endSession = false) {
    if (this.sessionAccumSeconds < 3) return;
    const nowCovered = this.getUniqueCoveredSeconds();
    const deltaUnique = Math.max(0, nowCovered - this.sessionStartCovered);
    const now = Date.now();
    const dateKey = Utils.localDateKey();

    let rec = null;
    if (this._activeSessionId) {
      rec = await this.db.get('sessions', this._activeSessionId);
      if (rec && (now - (rec.endedAt || 0)) > 10 * 60 * 1000) rec = null;
    }
    if (!rec) {
      const prior = (await this.db.getByIndex('sessions', 'bookId', this.bookId))
        .filter(s => s.dateKey === dateKey && now - (s.endedAt || 0) <= 10 * 60 * 1000)
        .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))[0];
      if (prior) rec = prior;
    }

    if (rec) {
      rec.listenedSeconds = Math.round((rec.listenedSeconds || 0) + this.sessionAccumSeconds);
      rec.uniqueCoveredSeconds = Math.round(Math.max(rec.uniqueCoveredSeconds || 0, 0) + deltaUnique);
      rec.endedAt = now;
      this._activeSessionId = rec.id;
      await this.db.put('sessions', rec);
    } else {
      const id = Utils.uid('sess');
      this._activeSessionId = id;
      await this.db.put('sessions', {
        id,
        bookId: this.bookId,
        dateKey,
        startedAt: this.sessionStartWall || now,
        endedAt: now,
        listenedSeconds: Math.round(this.sessionAccumSeconds),
        uniqueCoveredSeconds: Math.round(deltaUnique)
      });
    }

    this.sessionAccumSeconds = 0;
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
      bookId: this.bookId,
      intervals: this.intervals,
      totalListeningSeconds: this.totalListeningSeconds,
      updatedAt: Date.now()
    });

    await this._persistSession(endSession);
    if (endSession) this._activeSessionId = null;
  }
}
/* --------------------------------------------------------------------------
   8. AUDIO ENGINE & WEB AUDIO NARRATOR EQUALISER
   v2: deadlock-proof file loading, book-scale lock-screen positions,
   volume & mute, seekto media handler, unloadBook cleanup, live titles.
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
    this.eqState = { preset: 'balanced', bass: 0, mid: 0, voice: 1.5, treble: 1, enabled: true };
    this.ctx = null;
    this.sourceNode = null;
    this.nodes = null;
    this.sleepTimer = { mode: 'off', endsAt: null, chapterIndex: null, warningShown: false };
    this._bindAudioEvents();
  }

  _bindAudioEvents() {
    const a = this.audio;
    a.preservesPitch = true;

    a.addEventListener('playing', () => {
      this.app.coverage.setState(CoverageStates.PLAYING, this.getBookPosition());
      this.app.renderPlaybackUI();
      this._updateMediaSessionState('playing');
    });

    a.addEventListener('pause', () => {
      if (this.app.coverage.state !== CoverageStates.SWITCHING_FILE) {
        this.app.coverage.setState(CoverageStates.PAUSED);
        this.saveProgress();
        this.app.coverage.flush(true);
      }
      this.app.renderPlaybackUI();
      this._updateMediaSessionState('paused');
    });

    a.addEventListener('waiting', () => {
      if (!a.paused) this.app.coverage.setState(CoverageStates.BUFFERING);
    });

    a.addEventListener('seeking', () => this.app.coverage.setState(CoverageStates.SEEKING));

    a.addEventListener('seeked', () => {
      const pos = this.getBookPosition();
      if (!a.paused) this.app.coverage.setState(CoverageStates.PLAYING, pos);
      else this.app.coverage.setState(CoverageStates.PAUSED);
      this.saveProgress();
      this.app.renderPlaybackUI();
    });

    a.addEventListener('ratechange', () => {
      this.app.coverage.playbackRate = a.playbackRate || 1;
    });

    a.addEventListener('volumechange', () => {
      this.app._syncVolumeUI();
    });

    a.addEventListener('timeupdate', () => {
      if (!this.book) return;
      const pos = this.getBookPosition();
      if (!a.paused) {
        this.app.coverage.recordTick(pos);
        this._checkSleepChapterEnd();
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
        const bass = this.ctx.createBiquadFilter();
        bass.type = 'lowshelf';
        bass.frequency.value = 120;

        const mid = this.ctx.createBiquadFilter();
        mid.type = 'peaking';
        mid.frequency.value = 950;
        mid.Q.value = 0.9;

        const voice = this.ctx.createBiquadFilter();
        voice.type = 'peaking';
        voice.frequency.value = 3100;
        voice.Q.value = 1.1;

        const treble = this.ctx.createBiquadFilter();
        treble.type = 'highshelf';
        treble.frequency.value = 8000;

        const limiter = this.ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.ratio.value = 8;

        this.sourceNode.connect(bass);
        bass.connect(mid);
        mid.connect(voice);
        voice.connect(treble);
        treble.connect(limiter);
        limiter.connect(this.ctx.destination);
        this.nodes = { bass, mid, voice, treble, limiter };
      } catch {
        this.nodes = null;
      }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume().catch(() => {});
    this.applyEQ();
  }

  applyEQ() {
    if (!this.nodes) return;
    const active = this.eqState.enabled && this.app.settings.webAudioEnabled;
    this.nodes.bass.gain.value = active ? Utils.clamp(this.eqState.bass, -8, 8) : 0;
    this.nodes.mid.gain.value = active ? Utils.clamp(this.eqState.mid, -8, 8) : 0;
    this.nodes.voice.gain.value = active ? Utils.clamp(this.eqState.voice, -8, 8) : 0;
    this.nodes.treble.gain.value = active ? Utils.clamp(this.eqState.treble, -8, 8) : 0;
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

    await this.app.coverage.loadBook(bookId, book.duration);

    if (!files.length) {
      UI.toast('This book has no playable audio files. Re-import the audiobook to restore it.', 'error', 5000);
      return;
    }

    let targetFileIdx = progress?.currentFileIndex || 0;
    let targetTime = progress?.currentTime || 0;
    if (jumpToBookPos !== null) {
      const mapped = this.mapBookPosToFile(jumpToBookPos);
      targetFileIdx = mapped.fileIndex;
      targetTime = mapped.fileTime;
    }

    const rate = book.preferredSpeed || this.app.settings.defaultSpeed || 1;
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

    let blobOrFile = null;
    try {
      blobOrFile = await MediaStorage.readAudioFile(fileRec);
    } catch (err) {
      if (err.message === 'PERMISSION_REQUIRED') {
        UI.toast('Permission required to read your referenced audio file. Click Play again to grant access.', 'error', 5000);
        return;
      }
    }

    if (!blobOrFile) {
      UI.toast(`Audio data unavailable for "${fileRec.name}". Re-import or restore audio access.`, 'error', 5000);
      return;
    }

    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    this.currentObjectUrl = URL.createObjectURL(blobOrFile);
    this.audio.src = this.currentObjectUrl;

    // v2: deadlock-proof readiness wait (readyState short-circuit,
    // error listener, and an 8s timeout fallback).
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.audio.removeEventListener('loadedmetadata', onMeta);
        this.audio.removeEventListener('error', onError);
        if (fileTime > 0 && Number.isFinite(this.audio.duration)) {
          try {
            this.audio.currentTime = Utils.clamp(fileTime, 0, Math.max(0, this.audio.duration - 0.5));
          } catch { /* seek before readiness — ignored */ }
        }
        resolve();
      };
      const onMeta = () => finish();
      const onError = () => finish();
      const timer = setTimeout(() => finish(), 8000);
      if (this.audio.readyState >= 1) {
        finish();
      } else {
        this.audio.addEventListener('loadedmetadata', onMeta);
        this.audio.addEventListener('error', onError);
      }
    });

    if (autoplay) await this.play();
    else this.app.coverage.setState(CoverageStates.PAUSED);
    this.saveProgress();
  }

  /** v2: fully clear player state (used when a book is removed). */
  unloadBook() {
    this.pause();
    this.book = null;
    this.files = [];
    this.chapters = [];
    this.currentFileIndex = 0;
    this.sleepTimer = { mode: 'off', endsAt: null, chapterIndex: null, warningShown: false };
    if (this.currentObjectUrl) {
      URL.revokeObjectURL(this.currentObjectUrl);
      this.currentObjectUrl = null;
    }
    this.audio.removeAttribute('src');
    try { this.audio.load(); } catch { /* noop */ }
    if ('mediaSession' in navigator) {
      try { navigator.mediaSession.metadata = null; } catch { /* noop */ }
      navigator.mediaSession.playbackState = 'none';
    }
    document.body.classList.remove('is-audio-playing');
    document.title = `${APP_CONFIG.appName} — Audiobook Command Centre`;
  }

  async play() {
    if (!this.book) return;
    this.initWebAudioIfNeeded();
    try {
      await this.audio.play();
    } catch {
      UI.toast('Tap Play again to start audio playback.', 'info');
    }
  }

  pause() {
    this.audio.pause();
  }

  togglePlay() {
    if (!this.book) return;
    if (this.audio.paused) this.play();
    else this.pause();
  }

  /* v2: volume & mute */
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
      const f = this.files[i];
      const start = f.startOffset || 0;
      const end = start + (f.duration || 0);
      if (clamped <= end || i === this.files.length - 1) {
        return { fileIndex: i, fileTime: Math.max(0, clamped - start) };
      }
    }
    return { fileIndex: 0, fileTime: 0 };
  }

  getBookPosition() {
    const f = this.files[this.currentFileIndex];
    if (!f) return 0;
    return (f.startOffset || 0) + (this.audio.currentTime || 0);
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
    if (fileIndex !== this.currentFileIndex) {
      await this.loadFileIndex(fileIndex, fileTime, wasPlaying);
    } else {
      try { this.audio.currentTime = fileTime; } catch { /* noop */ }
      if (!wasPlaying) this.app.coverage.setState(CoverageStates.PAUSED);
    }
    this.saveProgress();
    this.app.renderPlaybackUI();
  }

  skip(deltaSeconds) {
    if (!this.book) return;
    this.seekToBookPosition(this.getBookPosition() + deltaSeconds);
  }

  jumpChapter(dir) {
    if (!this.chapters.length) return;
    const { index } = this.getCurrentChapter();
    const target = Utils.clamp(index + dir, 0, this.chapters.length - 1);
    this.seekToBookPosition(this.chapters[target].bookStart);
  }

  async setSpeed(rate) {
    rate = Utils.clamp(Math.round(rate * 20) / 20, 0.5, 3.0);
    this.audio.playbackRate = rate;
    this.app.coverage.playbackRate = rate;
    if (this.book) {
      this.book.preferredSpeed = rate;
      await this.app.db.put('books', this.book);
    }
    this.app.renderPlaybackUI();
  }

  setSleepTimer(mode, minutes = 0) {
    this.clearSleepTimer(false);
    if (mode === 'off') {
      this.app.renderPlaybackUI();
      return;
    }
    const { index } = this.getCurrentChapter();
    this.sleepTimer = {
      mode,
      endsAt: mode === 'minutes' ? Date.now() + minutes * 60000 : null,
      chapterIndex: index,
      warningShown: false
    };
    this.app.renderPlaybackUI();
  }

  clearSleepTimer(rerender = true) {
    this.sleepTimer = { mode: 'off', endsAt: null, chapterIndex: null, warningShown: false };
    const warn = document.getElementById('fp-sleep-warning');
    if (warn) warn.hidden = true;
    if (rerender) this.app.renderPlaybackUI();
  }

  _checkSleepCountdown() {
    if (this.sleepTimer.mode !== 'minutes' || !this.sleepTimer.endsAt) return;
    const rem = this.sleepTimer.endsAt - Date.now();
    const warn = document.getElementById('fp-sleep-warning');
    if (rem <= 15000 && rem > 0) {
      if (warn) {
        warn.hidden = false;
        warn.textContent = `Sleep timer pausing playback in ${Math.ceil(rem / 1000)}s`;
      }
      if (!this.sleepTimer.warningShown) {
        this.sleepTimer.warningShown = true;
        UI.toast('Sleep timer pausing playback soon.', 'info', 4000);
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
    if (index !== this.sleepTimer.chapterIndex) {
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
      bookId: this.book.id,
      currentFileIndex: this.currentFileIndex,
      currentTime: this.audio.currentTime || 0,
      bookPosition: bookPos,
      furthestPosition: Math.max(prev?.furthestPosition || 0, bookPos),
      updatedAt: Date.now()
    };
    await this.app.db.put('progress', rec);
    this.app.progressMap.set(this.book.id, rec);
  }

  _setupMediaSession() {
    if (!('mediaSession' in navigator) || !this.book) return;
    const artwork = this.book.artworkDataUrl ? [{ src: this.book.artworkDataUrl, sizes: '512x512', type: 'image/jpeg' }] : [];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.book.title,
        artist: this.book.author || 'Unknown Author',
        album: this.book.series || 'Audiobook',
        artwork
      });
    } catch { /* unsupported */ }
    const safe = (action, fn) => {
      try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ }
    };
    safe('play', () => this.play());
    safe('pause', () => this.pause());
    safe('seekbackward', () => this.skip(-this.app.settings.skipBack));
    safe('seekforward', () => this.skip(this.app.settings.skipFwd));
    safe('previoustrack', () => this.jumpChapter(-1));
    safe('nexttrack', () => this.jumpChapter(1));
    safe('seekto', (details) => {
      const t = details?.seekTime;
      if (Number.isFinite(t)) this.seekToBookPosition(Utils.clamp(t, 0, this.book.duration || t));
    });
  }

  _updateMediaSessionState(state) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = state;
    // v2: lock-screen positions describe the WHOLE book timeline,
    // matching the UI instead of the current file slice.
    const bookDur = this.book?.duration;
    if (navigator.mediaSession.setPositionState &&
        Number.isFinite(bookDur) && bookDur > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: bookDur,
          playbackRate: this.audio.playbackRate || 1,
          position: Utils.clamp(this.getBookPosition() || 0, 0, bookDur)
        });
      } catch {
        // Ignore unsupported browser edge case
      }
    }
  }
}

/* --------------------------------------------------------------------------
   9. TRANSCRIPT PARSER (WebVTT & SRT)
   -------------------------------------------------------------------------- */

const TranscriptParser = {
  parse(text, fileName = '') {
    const ext = fileName.toLowerCase().endsWith('.srt') ? 'srt' : 'vtt';
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const blocks = normalized.split(/\n{2,}/);
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
/* --------------------------------------------------------------------------
   10. COVERAGE TIMELINE VIEW v2
   One persistent element with delegated listeners — fixes the v1 bug where
   the full-player timeline was rebuilt every tick and lost all event
   handlers (making it inert). Supports hover preview, drag scrubbing,
   click-to-seek, and full keyboard control as a role="slider".
   -------------------------------------------------------------------------- */

class CoverageTimelineView {
  /**
   * @param {object} handlers { onSeek(sec), getBookPos() } — optional live mode.
   * @param {object} scopeProvider { getScope() -> {min, max} } — optional.
   */
  constructor(app, { onSeek, getScope } = {}) {
    this.app = app;
    this.onSeek = onSeek;
    this.getScope = getScope;
    this._signature = '';
    this._scrubRatio = null;

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
      this._tip.hidden = false;
      this._tip.style.left = `${ratio * 100}%`;
      this._tip.textContent = Utils.formatTime(secFromRatio(ratio));
      if (this._scrubRatio !== null) {
        this._playhead.style.left = `${ratio * 100}%`;
      }
    };

    el.addEventListener('pointermove', (e) => {
      if (this._scrubbing) return;
      showTip(ratioFromEvent(e.clientX));
    });
    el.addEventListener('pointerleave', () => {
      if (!this._scrubbing) this._tip.hidden = true;
    });

    /* Drag scrubbing (also covers plain taps/clicks) */
    el.addEventListener('pointerdown', (e) => {
      if (!this.onSeek) return;
      e.preventDefault();
      try { el.setPointerCapture?.(e.pointerId); } catch { /* synthetic event — safe to ignore */ }
      this._scrubbing = true;
      el.classList.add('is-scrubbing');
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
      this._scrubbing = false;
      el.classList.remove('is-scrubbing');
      this._tip.hidden = true;
      this._scrubRatio = null;
      if (e.type !== 'pointercancel' && this.onSeek) {
        this.onSeek(secFromRatio(ratioFromEvent(e.clientX)));
      }
    };
    el.addEventListener('pointerup', endScrub);
    el.addEventListener('pointercancel', endScrub);

    /* Keyboard: role=slider arrows seek, Home/End jump */
    el.addEventListener('keydown', (e) => {
      if (!this.onSeek) return;
      const { min, max } = this._currentScope || { min: 0, max: 0 };
      const span = Math.max(0, max - min);
      const cur = min + (this._lastRatio ?? 0) * span;
      const step = span > 3600 ? 60 : span > 600 ? 30 : 10;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        this.onSeek(Utils.clamp(cur - step, min, max));
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.onSeek(Utils.clamp(cur + step, min, max));
      } else if (e.key === 'Home') {
        e.preventDefault();
        this.onSeek(min);
      } else if (e.key === 'End') {
        e.preventDefault();
        this.onSeek(max);
      }
    });
  }

  /**
   * Repaint. Cheap path: move playhead only. Heavy path (segments) runs only
   * when the interval signature actually changes.
   */
  update(book, chapters, st, isChapterScoped) {
    const curCh = this.app.player.book?.id === book.id ? this.app.player.getCurrentChapter().chapter : null;
    const minT = isChapterScoped && curCh ? curCh.bookStart : 0;
    const maxT = isChapterScoped && curCh ? curCh.bookEnd : (book.duration || 1);
    this._currentScope = { min: minT, max: maxT };
    const span = Math.max(1, maxT - minT);

    const ratio = Utils.clamp(((st.pos - minT) / span) * 100, 0, 100);
    this._lastRatio = ratio / 100;
    this._playhead.style.left = `${ratio}%`;
    this.el.setAttribute('aria-valuenow', String(Math.round(ratio)));
    this.el.setAttribute('aria-label', `Playback position ${Utils.formatTime(st.pos)} of ${Utils.formatTime(maxT)} — drag or use arrow keys to seek`);

    const signature = JSON.stringify([st.intervals.length, st.intervals[st.intervals.length - 1] || null, Math.round(st.gaps.length), minT.toFixed(1), maxT.toFixed(1), chapters.length]);
    if (signature === this._signature) return;
    this._signature = signature;

    const layer = this._segsLayer;
    layer.innerHTML = '';

    st.intervals.forEach(([a, b]) => {
      const sa = Utils.clamp(a, minT, maxT);
      const sb = Utils.clamp(b, minT, maxT);
      if (sb <= sa) return;
      const seg = document.createElement('div');
      seg.className = 'cov-seg-played';
      seg.style.left = `${((sa - minT) / span) * 100}%`;
      seg.style.width = `${((sb - sa) / span) * 100}%`;
      layer.appendChild(seg);
    });

    st.gaps.forEach(([a, b]) => {
      const sa = Utils.clamp(a, minT, maxT);
      const sb = Utils.clamp(b, minT, maxT);
      if (sb <= sa) return;
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
  }
}

/* --------------------------------------------------------------------------
   11. IMPORTER PIPELINE & GROUPING ENGINE
   v2: skip-exact-duplicates option, paint-friendly scan loop.
   -------------------------------------------------------------------------- */

class ImporterService {
  constructor(app) {
    this.app = app;
  }

  isAudioFile(name) {
    return /\.(mp3|m4a|m4b|aac|flac|wav|ogg|opus)$/i.test(name);
  }

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

      const [meta, hash] = await Promise.all([
        MetadataParser.parseFile(file),
        MetadataParser.computeFingerprint(file)
      ]);

      const exactDup = existingFiles.find(ef => ef.hash === hash);
      parsed.push({
        file,
        handle: handle || null,
        folderPath: path || '',
        meta,
        hash,
        exactDuplicateOf: exactDup ? existingBooks.find(b => b.id === exactDup.bookId)?.title || 'Existing Book' : null
      });
    }

    const groups = this._groupIntoBooks(parsed, existingBooks);
    this._showReviewModal(groups);
  }

  _groupIntoBooks(items, existingBooks) {
    const map = new Map();
    for (const item of items) {
      const folderParts = item.folderPath.split('/').filter(Boolean);
      const parentFolder = folderParts.length > 1 ? folderParts[folderParts.length - 2] : '';
      const groupKey = parentFolder
        ? `dir:${parentFolder}`
        : `album:${(item.meta.album || item.meta.title).toLowerCase()}`;

      if (!map.has(groupKey)) {
        map.set(groupKey, {
          id: Utils.uid('prop'),
          title: item.meta.album || parentFolder || item.meta.title || 'Untitled Audiobook',
          author: item.meta.author || '',
          narrator: item.meta.narrator || '',
          genre: item.meta.genre || '',
          year: item.meta.year || '',
          series: '',
          seriesIndex: '',
          artworkDataUrl: item.meta.artworkDataUrl || null,
          items: []
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
        const da = a.meta.discNumber ?? 0;
        const db = b.meta.discNumber ?? 0;
        if (da !== db) return da - db;
        const ta = a.meta.trackNumber ?? 9999;
        const tb = b.meta.trackNumber ?? 9999;
        if (ta !== tb) return ta - tb;
        return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
      });

      const totalDur = g.items.reduce((s, it) => s + (it.meta.duration || 0), 0);
      const exactDup = g.items.find(it => it.exactDuplicateOf)?.exactDuplicateOf || null;
      const likelyDup = !exactDup
        ? existingBooks.find(b => b.title.toLowerCase() === g.title.toLowerCase() && Math.abs((b.duration || 0) - totalDur) < 15)?.title || null
        : null;
      g.duplicateNote = exactDup
        ? `Exact file match with "${exactDup}"`
        : likelyDup
          ? `Likely duplicate of "${likelyDup}" (matching title & duration)`
          : null;
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
        <strong style="display:block;">Storage Mode</strong>
        <label style="display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;font-size:0.85rem;cursor:pointer;">
          <input type="radio" name="import-storage-mode" value="local-copy" checked>
          <span><strong>Store Local Copy</strong> — Saves audio in browser storage (OPFS/IndexedDB). Works offline without re-granting file permissions.</span>
        </label>
        <label style="display:flex;gap:8px;align-items:flex-start;font-size:0.85rem;opacity:${canRef ? 1 : 0.5};cursor:${canRef ? 'pointer' : 'not-allowed'};">
          <input type="radio" name="import-storage-mode" value="reference" ${canRef ? '' : 'disabled'}>
          <span><strong>Reference Existing Files</strong> — ${canRef ? 'Uses minimal storage via File System Access handle; browser may ask to re-confirm permission after restart.' : 'Available when selecting files via Chromium File System Access picker.'}</span>
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
          groups[idx - 1].items.push(...groups[idx].items);
          groups.splice(idx, 1);
          renderGroups();
        });
        card.querySelector('[data-split]')?.addEventListener('click', () => {
          const splitOut = g.items.map(it => ({
            id: Utils.uid('prop'),
            title: it.meta.trackTitle || it.file.name,
            author: g.author,
            narrator: g.narrator,
            genre: g.genre,
            year: g.year,
            series: g.series,
            seriesIndex: '',
            artworkDataUrl: it.meta.artworkDataUrl || g.artworkDataUrl,
            items: [it]
          }));
          groups.splice(idx, 1, ...splitOut);
          renderGroups();
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
          label: 'Confirm Import',
          className: 'btn-primary',
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
    let importedCount = 0;
    let skippedFiles = 0;

    for (const grp of groups) {
      const items = grp.items.filter(it => {
        if (skipDupes && it.exactDuplicateOf) { skippedFiles++; return false; }
        return true;
      });
      if (!items.length) continue;

      const bookId = Utils.uid('book');
      let bookOffset = 0;
      const fileRecs = [];
      const chapRecs = [];

      for (let fi = 0; fi < items.length; fi++) {
        const it = items[fi];
        const fileId = Utils.uid('file');
        const dur = it.meta.duration || 0;
        let storageMeta = { storageKind: 'reference', blob: null };
        if (storageMode === 'local-copy') {
          storageMeta = await MediaStorage.saveAudioCopy(fileId, it.file);
        }

        fileRecs.push({
          id: fileId,
          bookId,
          name: it.file.name,
          size: it.file.size,
          type: it.file.type || 'audio/mpeg',
          duration: dur,
          orderIndex: fi,
          startOffset: bookOffset,
          storageMode,
          storageKind: storageMeta.storageKind,
          blob: storageMeta.blob,
          fileHandle: storageMode === 'reference' ? it.handle : null,
          hash: it.hash
        });

        if (it.meta.chapters.length > 0 && items.length === 1) {
          it.meta.chapters.forEach((c, ci) => {
            const nextStart = it.meta.chapters[ci + 1]?.start ?? dur;
            const cEnd = c.end && c.end > c.start ? c.end : nextStart;
            chapRecs.push({
              id: Utils.uid('chap'),
              bookId,
              fileId,
              title: c.title || `Chapter ${ci + 1}`,
              orderIndex: chapRecs.length,
              fileStart: c.start,
              fileEnd: cEnd,
              bookStart: bookOffset + c.start,
              bookEnd: bookOffset + cEnd,
              duration: Math.max(0, cEnd - c.start)
            });
          });
        } else {
          chapRecs.push({
            id: Utils.uid('chap'),
            bookId,
            fileId,
            title: it.meta.trackTitle || `Part ${fi + 1}`,
            orderIndex: chapRecs.length,
            fileStart: 0,
            fileEnd: dur,
            bookStart: bookOffset,
            bookEnd: bookOffset + dur,
            duration: dur
          });
        }
        bookOffset += dur;
      }

      await this.app.db.put('books', {
        id: bookId,
        title: grp.title.trim() || 'Untitled Audiobook',
        author: grp.author.trim(),
        narrator: grp.narrator.trim(),
        series: grp.series.trim(),
        seriesIndex: grp.seriesIndex ? Number(grp.seriesIndex) : null,
        genre: grp.genre.trim(),
        year: grp.year.trim(),
        language: '',
        duration: bookOffset,
        chapterCount: chapRecs.length,
        storageMode,
        artworkDataUrl: grp.artworkDataUrl || null,
        addedAt: Date.now(),
        lastPlayedAt: null,
        completed: false,
        preferredSpeed: null,
        transcriptId: null,
        collectionIds: []
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
  }
}
/* --------------------------------------------------------------------------
   12. MAIN APPLICATION CONTROLLER
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
    this._fpTimelineView = null;
    this._lastSegmentSyncAt = 0;

    this.books = [];
    this.chaptersMap = new Map();
    this.progressMap = new Map();
    this.coverageMap = new Map();
    this.collections = [];
    this.bookmarks = [];
    this.notes = [];
    this.sessions = [];
    this.transcriptsMap = new Map();

    this.settings = {
      themeMode: APP_CONFIG.defaultThemeMode,
      palette: APP_CONFIG.defaultPalette,
      defaultSpeed: 1.0,
      skipBack: 15,
      skipFwd: 30,
      webAudioEnabled: true,
      dailyGoalMin: 30,
      weeklyGoalMin: 210,
      monthlyGoalMin: 900,
      volume: 1,
      muted: false,
      librarySort: 'recent-played',
      libraryView: 'grid'
    };
  }

  async start() {
    this._applyBannerConfig();
    await this.db.init();
    await this._loadSettings();
    this.applyTheme();
    this._applyLibraryPrefs();
    this.player.audio.volume = Utils.clamp(this.settings.volume ?? 1, 0, 1);
    this.player.audio.muted = !!this.settings.muted;
    await this.refreshData();
    this._bindGlobalEvents();
    this.navigate('dashboard');
    this._syncVolumeUI();
  }

  _applyBannerConfig() {
    const el = document.getElementById('dev-banner');
    if (!BANNER_CONFIG.enabled || !BANNER_CONFIG.message) {
      el.hidden = true;
      return;
    }
    document.getElementById('dev-banner-message').textContent = BANNER_CONFIG.message;
    const btn = document.getElementById('dev-banner-btn');
    if (BANNER_CONFIG.showButton && BANNER_CONFIG.buttonText && Utils.isSafeUrl(BANNER_CONFIG.buttonUrl)) {
      btn.hidden = false;
      btn.textContent = BANNER_CONFIG.buttonText;
      btn.href = BANNER_CONFIG.buttonUrl;
      if (BANNER_CONFIG.openInNewTab) {
        btn.target = '_blank';
        btn.rel = 'noopener noreferrer';
      }
    } else {
      btn.hidden = true;
    }
    el.hidden = false;
  }

  async _loadSettings() {
    const saved = await this.db.get('settings', 'app_settings');
    if (saved?.value) this.settings = { ...this.settings, ...saved.value };
    const eqSaved = await this.db.get('settings', 'eq_state');
    if (eqSaved?.value) this.player.eqState = { ...this.player.eqState, ...eqSaved.value };
  }

  async saveSettings() {
    await this.db.put('settings', { key: 'app_settings', value: this.settings });
  }

  _applyLibraryPrefs() {
    const savedView = this.settings.libraryView === 'list' ? 'list' : 'grid';
    this.libraryView = savedView;
    document.querySelectorAll('[data-lib-view]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.libView === savedView);
    });
    const sortSel = document.getElementById('lib-sort');
    if (sortSel && Array.from(sortSel.options).some(o => o.value === this.settings.librarySort)) {
      sortSel.value = this.settings.librarySort;
    }
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
    const [books, chapters, progresses, coverages, collections, bookmarks, notes, sessions, transcripts] = await Promise.all([
      this.db.getAll('books'),
      this.db.getAll('chapters'),
      this.db.getAll('progress'),
      this.db.getAll('coverage'),
      this.db.getAll('collections'),
      this.db.getAll('bookmarks'),
      this.db.getAll('notes'),
      this.db.getAll('sessions'),
      this.db.getAll('transcripts')
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

    this.progressMap = new Map(progresses.map(p => [p.bookId, p]));
    this.coverageMap = new Map(coverages.map(c => [c.bookId, c]));
    this.transcriptsMap = new Map(transcripts.map(t => [t.bookId, t]));

    this.renderCurrentRoute();
  }

  getBookStats(book) {
    const prog = this.progressMap.get(book.id);
    const covRec = this.coverageMap.get(book.id);
    const liveIntervals = this.player.book?.id === book.id
      ? this.coverage.getLiveIntervals()
      : (covRec?.intervals || []);
    const coveredSec = liveIntervals.reduce((s, [a, b]) => s + (b - a), 0);
    const dur = book.duration || 0;
    const covPct = dur > 0 ? Utils.clamp((coveredSec / dur) * 100, 0, 100) : 0;
    const pos = this.player.book?.id === book.id ? this.player.getBookPosition() : (prog?.bookPosition || 0);
    const gaps = this.coverage.getUnplayedGaps(dur, liveIntervals);
    return { pos, coveredSec, covPct, intervals: liveIntervals, gaps, listenedSec: covRec?.totalListeningSeconds || 0 };
  }

  navigate(route, bookId = null) {
    this.route = route;
    if (bookId) this.selectedBookId = bookId;

    document.querySelectorAll('.view').forEach(v => { v.hidden = true; v.classList.remove('is-active'); });
    const target = document.getElementById(`view-${route}`);
    if (target) {
      target.hidden = false;
      // restart the entrance animation
      target.style.animation = 'none';
      void target.offsetWidth;
      target.style.animation = '';
      target.classList.add('is-active');
    }

    const navRoute = route === 'book-detail' ? 'library' : route;
    document.querySelectorAll('[data-route]').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.route === navRoute);
    });

    const titles = {
      dashboard: 'Command Centre',
      library: 'Audiobook Library',
      'book-detail': 'Audiobook Details',
      vault: 'Knowledge Vault',
      stats: 'Statistics & History',
      settings: 'Settings'
    };
    document.getElementById('mobile-page-title').textContent = titles[route] || 'Cadence';
    window.scrollTo({ top: 0 });
    this.renderCurrentRoute();
  }

  renderCurrentRoute() {
    if (this.route === 'dashboard') this.renderDashboard();
    else if (this.route === 'library') this.renderLibrary();
    else if (this.route === 'book-detail') this.renderBookDetail();
    else if (this.route === 'vault') this.renderVault();
    else if (this.route === 'stats') this.renderStats();
    else if (this.route === 'settings') this.renderSettings();
  }

  /* ------------------------------------------------------------------------
     RENDER: COMMAND CENTRE
     ------------------------------------------------------------------------ */
  renderDashboard() {
    const emptyEl = document.getElementById('dashboard-empty');
    const gridEl = document.getElementById('dashboard-content');
    if (!this.books.length) {
      emptyEl.hidden = false;
      gridEl.hidden = true;
      return;
    }
    emptyEl.hidden = true;
    gridEl.hidden = false;

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
          ${activeBook.artworkDataUrl
            ? `<img class="hero-cover glow-backlight" src="${activeBook.artworkDataUrl}" alt="${Utils.escapeHtml(activeBook.title)}">`
            : `<div class="hero-cover cover-placeholder glow-backlight">${Utils.escapeHtml(Utils.initials(activeBook.title))}</div>`}
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;">
            <div>
              <h2 style="font-size:var(--text-lg);letter-spacing:-0.015em;">${Utils.escapeHtml(activeBook.title)}</h2>
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
    } else {
      hero.hidden = true;
    }

    const todayKey = Utils.localDateKey();
    const todaySec = this.sessions.filter(s => s.dateKey === todayKey).reduce((a, b) => a + b.listenedSeconds, 0);
    const totalUnique = this.books.reduce((s, b) => s + this.getBookStats(b).coveredSec, 0);
    const goalPct = Utils.clamp(((todaySec / 60) / (this.settings.dailyGoalMin || 30)) * 100, 0, 100);

    document.getElementById('dash-metrics-panel').innerHTML = `
      <div class="panel-head">
        <h2>Daily Goal &amp; Library</h2>
        <button type="button" class="btn btn-ghost btn-xs" id="dash-goto-stats">Full Stats</button>
      </div>
      <div class="goal-wrap">
        <div class="goal-ring" style="--pct:${goalPct.toFixed(1)}" role="img" aria-label="Daily goal ${Math.round(todaySec / 60)} of ${this.settings.dailyGoalMin} minutes, ${goalPct.toFixed(0)} percent">
          <span class="goal-ring-inner">
            <span class="goal-ring-val tabular">${goalPct.toFixed(0)}%</span>
            <span class="goal-ring-lbl">of goal</span>
          </span>
        </div>
        <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;font-size:0.82rem;">
            <span>Today: <strong class="tabular">${Math.round(todaySec / 60)}m</strong> / ${this.settings.dailyGoalMin}m</span>
            <span class="tabular" style="color:var(--text-secondary);">${goalPct >= 100 ? 'Goal reached' : `${Math.max(1, Math.round((this.settings.dailyGoalMin - todaySec / 60)))}m to go`}</span>
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
          const st = this.getBookStats(b);
          const isCurrent = this.player.book?.id === b.id;
          return `<div class="list-item-row${isCurrent ? ' is-active' : ''}">
            <div style="min-width:0;display:flex;align-items:center;gap:10px;">
              ${isCurrent ? `<span class="eq-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>` : ''}
              <div style="min-width:0;"><strong>${Utils.escapeHtml(b.title)}</strong><div class="setting-desc">${st.covPct.toFixed(0)}% covered · ${st.gaps.length} gap${st.gaps.length === 1 ? '' : 's'}</div></div>
            </div>
            <button type="button" class="btn btn-secondary btn-xs" data-play-book="${b.id}">${isCurrent ? 'Open' : 'Play'}</button>
          </div>`;
        }).join('');
      unfinPanel.querySelectorAll('[data-play-book]').forEach(btn => {
        btn.addEventListener('click', () => {
          if (this.player.book?.id === btn.dataset.playBook) {
            document.getElementById('full-player').hidden = false;
            this.renderPlaybackUI();
          } else {
            this.player.loadBook(btn.dataset.playBook, true);
          }
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
    recPanel.querySelectorAll('[data-detail-book]').forEach(btn => {
      btn.addEventListener('click', () => this.navigate('book-detail', btn.dataset.detailBook));
    });

    const colPanel = document.getElementById('dash-collections-panel');
    colPanel.innerHTML = `<div class="panel-head"><h2>Collections</h2><button type="button" class="btn btn-ghost btn-xs" id="dash-new-col">+ Create</button></div>` +
      (this.collections.length
        ? this.collections.slice(0, 4).map(c => {
            const count = this.books.filter(b => b.collectionIds?.includes(c.id)).length;
            return `<div class="list-item-row"><span>${Utils.escapeHtml(c.name)}</span><span class="setting-desc">${count} book${count === 1 ? '' : 's'}</span></div>`;
          }).join('')
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
     RENDER: LIBRARY
     ------------------------------------------------------------------------ */
  renderLibrary() {
    const colSel = document.getElementById('lib-filter-collection');
    const curCol = colSel.value;
    colSel.innerHTML = `<option value="all">All Collections</option>` +
      this.collections.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('');
    if (Array.from(colSel.options).some(o => o.value === curCol)) colSel.value = curCol;

    const seriesSet = [...new Set(this.books.map(b => b.series).filter(Boolean))].sort();
    const serSel = document.getElementById('lib-filter-series');
    const curSer = serSel.value;
    serSel.innerHTML = `<option value="all">All Series</option>` +
      seriesSet.map(s => `<option value="${Utils.escapeHtml(s)}">${Utils.escapeHtml(s)}</option>`).join('');
    if (Array.from(serSel.options).some(o => o.value === curSer)) serSel.value = curSer;

    const strip = document.getElementById('lib-collections-strip');
    strip.hidden = !this.collections.length;
    strip.innerHTML = this.collections.map(c => `
      <button type="button" class="pill-chip ${colSel.value === c.id ? 'is-active' : ''}" data-col-chip="${c.id}">
        ${Utils.escapeHtml(c.name)}
      </button>
    `).join('');
    strip.querySelectorAll('[data-col-chip]').forEach(ch => {
      ch.addEventListener('click', () => {
        colSel.value = colSel.value === ch.dataset.colChip ? 'all' : ch.dataset.colChip;
        this.renderLibrary();
      });
    });

    const seriesPanel = document.getElementById('lib-series-panel');
    if (serSel.value !== 'all') {
      const serBooks = this.books
        .filter(b => b.series === serSel.value)
        .sort((a, b) => (a.seriesIndex ?? 999) - (b.seriesIndex ?? 999));
      const completedInSeries = serBooks.filter(b => b.completed).length;
      const nextBook = serBooks.find(b => !b.completed);
      seriesPanel.hidden = false;
      seriesPanel.innerHTML = `
        <div class="panel-head">
          <strong>Series: ${Utils.escapeHtml(serSel.value)} (${completedInSeries}/${serBooks.length} completed)</strong>
          ${nextBook ? `<button type="button" class="btn btn-primary btn-xs" id="series-play-next">Play Next: ${Utils.escapeHtml(nextBook.title)}</button>` : ''}
        </div>
      `;
      seriesPanel.querySelector('#series-play-next')?.addEventListener('click', () => this.player.loadBook(nextBook.id, true));
    } else {
      seriesPanel.hidden = true;
    }

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

    const emptyEl = document.getElementById('lib-empty');
    const listEl = document.getElementById('lib-items');
    listEl.className = this.libraryView === 'grid' ? 'library-grid' : 'library-list';

    if (!filtered.length) {
      emptyEl.hidden = false;
      document.getElementById('lib-empty-msg').textContent = this.books.length
        ? 'No audiobooks match the current search and filters.'
        : 'Import local audio files or folders to populate your library.';
      listEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;

    listEl.innerHTML = filtered.map(b => {
      const st = this.getBookStats(b);
      const isCurrent = this.player.book?.id === b.id;
      const covImg = b.artworkDataUrl
        ? `<img src="${b.artworkDataUrl}" alt="${Utils.escapeHtml(b.title)}" loading="lazy">`
        : `<div class="cover-placeholder">${Utils.escapeHtml(Utils.initials(b.title))}</div>`;

      if (this.libraryView === 'list') {
        return `
          <article class="book-list-row glass-secondary${isCurrent ? ' is-active' : ''}">
            <div class="book-list-thumb" style="overflow:hidden;cursor:pointer;" data-open-detail="${b.id}">${covImg}</div>
            <div class="book-list-main">
              <strong style="cursor:pointer;">${isCurrent ? `<span class="eq-bars" style="margin-right:8px;" aria-hidden="true"><i></i><i></i><i></i><i></i></span>` : ''}${Utils.escapeHtml(b.title)}</strong>
              <div class="setting-desc">${Utils.escapeHtml(b.author || 'Unknown Author')}${b.narrator ? ` · Narrated by ${Utils.escapeHtml(b.narrator)}` : ''}</div>
              <div style="display:flex;gap:12px;align-items:center;margin-top:6px;">
                <div class="progress-bar" style="flex:1;max-width:220px;"><div class="progress-fill" style="width:${st.covPct.toFixed(1)}%"></div></div>
                <span class="setting-desc tabular">${st.covPct.toFixed(0)}% covered · ${Utils.formatDurationHuman(b.duration)}</span>
              </div>
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="btn btn-primary btn-sm" data-play="${b.id}">${isCurrent && !this.player.audio.paused ? 'Pause' : 'Play'}</button>
              <button type="button" class="btn btn-secondary btn-sm" data-open-detail="${b.id}">Details</button>
            </div>
          </article>
        `;
      }

      return `
        <article class="book-card glass-secondary${isCurrent ? ' is-active' : ''}">
          <div class="book-card-cover-wrap" data-open-detail="${b.id}">
            ${covImg}
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
        </article>
      `;
    }).join('');

    listEl.querySelectorAll('[data-play]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (this.player.book?.id === btn.dataset.play) this.player.togglePlay();
        else this.player.loadBook(btn.dataset.play, true);
      });
    });
    listEl.querySelectorAll('[data-open-detail]').forEach(el => {
      el.addEventListener('click', () => this.navigate('book-detail', el.dataset.openDetail));
    });
  }

  /* ------------------------------------------------------------------------
     RENDER: BOOK DETAIL & COVERAGE RECOVERY
     ------------------------------------------------------------------------ */
  renderBookDetail() {
    const book = this.books.find(b => b.id === this.selectedBookId);
    const container = document.getElementById('book-detail-container');
    if (!book) {
      container.innerHTML = `<p>Book not found.</p>`;
      return;
    }

    const chapters = this.chaptersMap.get(book.id) || [];
    const st = this.getBookStats(book);
    const bookBookmarks = this.bookmarks.filter(bm => bm.bookId === book.id);
    const bookNotes = this.notes.filter(n => n.bookId === book.id);
    const transcript = this.transcriptsMap.get(book.id);
    const firstGap = st.gaps[0] || null;
    const isCurrent = this.player.book?.id === book.id;

    container.innerHTML = `
      <div class="detail-hero glass-elevated prism-edge">
        ${book.artworkDataUrl
          ? `<img class="detail-cover glow-backlight" src="${book.artworkDataUrl}" alt="${Utils.escapeHtml(book.title)}">`
          : `<div class="detail-cover cover-placeholder glow-backlight">${Utils.escapeHtml(Utils.initials(book.title))}</div>`}
        <div class="detail-meta">
          <h1 id="detail-book-title">${Utils.escapeHtml(book.title)}</h1>
          <p class="setting-desc">${Utils.escapeHtml(book.author || 'Unknown Author')}${book.narrator ? ` · Narrated by ${Utils.escapeHtml(book.narrator)}` : ''}</p>
          ${book.series ? `<p class="eyebrow">${Utils.escapeHtml(book.series)}${book.seriesIndex ? ` #${book.seriesIndex}` : ''}</p>` : ''}
          <div class="detail-tags">
            <span class="pill-chip">${Utils.formatDurationHuman(book.duration)}</span>
            <span class="pill-chip">${chapters.length} Chapters</span>
            <span class="pill-chip">${st.covPct.toFixed(1)}% Played Coverage</span>
            <span class="pill-chip">${Utils.formatDurationHuman(st.listenedSec)} Total Listened</span>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
            <button type="button" class="btn btn-primary btn-sm" id="detail-play-btn">${isCurrent ? 'Open Player' : `Resume (${Utils.formatTime(st.pos)})`}</button>
            ${firstGap ? `<button type="button" class="btn btn-secondary btn-sm" id="detail-first-gap-btn">Jump to First Unplayed (${Utils.formatTime(firstGap[0])})</button>` : ''}
            <button type="button" class="btn btn-secondary btn-sm" id="detail-upload-art-btn">Replace Cover</button>
            <button type="button" class="btn btn-secondary btn-sm" id="detail-upload-tr-btn">${transcript ? 'Replace Transcript' : 'Attach Transcript (.vtt/.srt)'}</button>
          </div>
        </div>
      </div>

      <section class="glass-secondary dash-panel">
        <div class="panel-head">
          <h2>Playback Coverage &amp; Unplayed Sections</h2>
          <button type="button" class="btn btn-danger btn-xs" id="detail-reset-cov-btn">Reset Coverage</button>
        </div>
        <div id="detail-timeline-mount"></div>
        <p class="setting-desc">Solid segments show recorded playback progression. Hatched segments show unplayed or jumped-over material (${st.gaps.length} unplayed section${st.gaps.length === 1 ? '' : 's'}).</p>
        <div class="form-grid">
          ${st.gaps.slice(0, 12).map(([gs, ge]) => `
            <div class="list-item-row">
              <div>
                <strong class="tabular">${Utils.formatTime(gs)} – ${Utils.formatTime(ge)}</strong>
                <div class="setting-desc">${Utils.formatDurationHuman(ge - gs)} unplayed</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button type="button" class="btn btn-primary btn-xs" data-jump-pos="${gs}">Play Gap</button>
                <button type="button" class="btn btn-ghost btn-xs" data-mark-played="${gs},${ge}">Mark Played</button>
              </div>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="glass-secondary dash-panel">
        <div class="panel-head"><h2>Chapters (${chapters.length})</h2></div>
        <div class="form-grid">
          ${chapters.map((c, idx) => `
            <div class="list-item-row${isCurrent && this.player.getCurrentChapter().index === idx ? ' is-active' : ''}">
              <div style="min-width:0;">
                <strong>${idx + 1}. ${Utils.escapeHtml(c.title)}</strong>
                <div class="setting-desc tabular">${Utils.formatTime(c.bookStart)} · ${Utils.formatDurationHuman(c.duration)}</div>
              </div>
              <button type="button" class="btn btn-secondary btn-xs" data-jump-pos="${c.bookStart}">Play</button>
            </div>
          `).join('')}
        </div>
      </section>

      <section class="glass-secondary dash-panel">
        <div class="panel-head"><h2>Collections</h2></div>
        <div class="collections-strip" style="margin:0;">
          ${this.collections.length
            ? this.collections.map(c => {
                const active = book.collectionIds?.includes(c.id);
                return `<button type="button" class="pill-chip ${active ? 'is-active' : ''}" data-toggle-col="${c.id}">${Utils.escapeHtml(c.name)}</button>`;
              }).join('')
            : `<p class="setting-desc">No collections created yet.</p>`}
        </div>
      </section>

      <section class="glass-secondary dash-panel">
        <div class="panel-head"><h2>Bookmarks &amp; Notes (${bookBookmarks.length + bookNotes.length})</h2></div>
        ${bookBookmarks.map(bm => `
          <div class="list-item-row">
            <div style="min-width:0;"><span class="vault-badge">Bookmark</span> <strong>${Utils.escapeHtml(bm.title)}</strong> <span class="setting-desc tabular">${Utils.formatTime(bm.bookTime)}</span></div>
            <button type="button" class="btn btn-secondary btn-xs" data-jump-pos="${bm.bookTime}">Jump</button>
          </div>
        `).join('')}
        ${bookNotes.map(n => `
          <div class="list-item-row">
            <div style="min-width:0;"><span class="vault-badge">${Utils.escapeHtml(n.type)}</span> <span>${Utils.escapeHtml(n.text)}</span> <span class="setting-desc tabular">${Utils.formatTime(n.bookTime)}</span></div>
            <button type="button" class="btn btn-secondary btn-xs" data-jump-pos="${n.bookTime}">Jump</button>
          </div>
        `).join('')}
      </section>
    `;

    const tlMount = document.getElementById('detail-timeline-mount');
    const detailView = new CoverageTimelineView(this, {
      onSeek: (sec) => {
        if (this.player.book?.id === book.id) this.player.seekToBookPosition(sec);
        else this.player.loadBook(book.id, true, sec);
      }
    });
    detailView.update(book, chapters, st, false);
    tlMount.appendChild(detailView.el);

    document.getElementById('detail-play-btn').addEventListener('click', () => {
      if (this.player.book?.id === book.id) {
        document.getElementById('full-player').hidden = false;
        this.renderPlaybackUI();
      } else {
        this.player.loadBook(book.id, true);
      }
    });
    document.getElementById('detail-first-gap-btn')?.addEventListener('click', () => this.player.loadBook(book.id, true, firstGap[0]));

    document.getElementById('detail-upload-art-btn').addEventListener('click', () => {
      const inp = document.getElementById('file-input-cover');
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        const dataUrl = await MetadataParser.resizeArtworkBlob(f);
        if (dataUrl) {
          book.artworkDataUrl = dataUrl;
          await this.db.put('books', book);
          await this.refreshData();
          UI.toast('Cover artwork updated.', 'success');
        }
        inp.value = '';
      };
      inp.click();
    });

    document.getElementById('detail-upload-tr-btn').addEventListener('click', () => {
      const inp = document.getElementById('file-input-transcript');
      inp.onchange = async () => {
        const f = inp.files?.[0];
        if (!f) return;
        const text = await f.text();
        const parsed = TranscriptParser.parse(text, f.name);
        if (!parsed.cues.length) {
          UI.toast('No valid WebVTT or SRT timed cues found in file.', 'error');
        } else {
          await this.db.put('transcripts', {
            id: book.id, bookId: book.id, format: parsed.format, fileName: f.name, cues: parsed.cues, createdAt: Date.now()
          });
          await this.refreshData();
          UI.toast(`Attached ${parsed.cues.length} transcript cues.`, 'success');
        }
        inp.value = '';
      };
      inp.click();
    });

    document.getElementById('detail-reset-cov-btn').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Reset Playback Coverage',
        message: `Clear all recorded playback coverage and total listening time for "${book.title}"?`,
        confirmLabel: 'Reset Coverage',
        danger: true
      });
      if (!ok) return;
      if (this.player.book?.id === book.id) await this.coverage.resetCoverage();
      else await this.db.put('coverage', { bookId: book.id, intervals: [], totalListeningSeconds: 0, updatedAt: Date.now() });
      await this.refreshData();
      UI.toast('Coverage reset.');
    });

    container.querySelectorAll('[data-jump-pos]').forEach(btn => {
      btn.addEventListener('click', () => this.player.loadBook(book.id, true, Number(btn.dataset.jumpPos)));
    });

    container.querySelectorAll('[data-mark-played]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [a, b] = btn.dataset.markPlayed.split(',').map(Number);
        if (this.player.book?.id === book.id) {
          await this.coverage.markRangePlayed(a, b);
        } else {
          const rec = (await this.db.get('coverage', book.id)) || { bookId: book.id, intervals: [], totalListeningSeconds: 0 };
          rec.intervals = this.coverage.mergeIntervals([...rec.intervals, [a, b]]);
          rec.updatedAt = Date.now();
          await this.db.put('coverage', rec);
        }
        await this.refreshData();
      });
    });

    container.querySelectorAll('[data-toggle-col]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cid = btn.dataset.toggleCol;
        const set = new Set(book.collectionIds || []);
        if (set.has(cid)) set.delete(cid);
        else set.add(cid);
        book.collectionIds = Array.from(set);
        await this.db.put('books', book);
        await this.refreshData();
      });
    });
  }

  /* ------------------------------------------------------------------------
     RENDER: KNOWLEDGE VAULT
     ------------------------------------------------------------------------ */
  renderVault() {
    const bookSel = document.getElementById('vault-filter-book');
    const curBook = bookSel.value;
    bookSel.innerHTML = `<option value="all">All Audiobooks</option>` +
      this.books.map(b => `<option value="${b.id}">${Utils.escapeHtml(b.title)}</option>`).join('');
    if (Array.from(bookSel.options).some(o => o.value === curBook)) bookSel.value = curBook;

    const allTags = [...new Set(this.notes.flatMap(n => n.tags || []))].sort();
    const tagSel = document.getElementById('vault-filter-tag');
    const curTag = tagSel.value;
    tagSel.innerHTML = `<option value="all">All Tags</option>` +
      allTags.map(t => `<option value="${Utils.escapeHtml(t)}">${Utils.escapeHtml(t)}</option>`).join('');
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
      listEl.innerHTML = `<div class="empty-state glass-secondary" style="grid-column:1/-1;"><h2>Knowledge Vault Empty</h2><p>Save timestamped bookmarks, notes, quotes, and transcript highlights while listening to build a searchable personal library of ideas.</p></div>`;
      return;
    }

    listEl.innerHTML = filtered.map(item => {
      const bk = this.books.find(b => b.id === item.bookId);
      const linked = (item.linkedNoteIds || []).map(id => this.notes.find(n => n.id === id)).filter(Boolean);
      return `
        <article class="vault-card glass-secondary">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span class="vault-badge">${Utils.escapeHtml(item.kind)}</span>
            <span class="setting-desc tabular">${Utils.formatTime(item.bookTime)}</span>
          </div>
          <div>
            <strong>${Utils.escapeHtml(bk?.title || 'Unknown Book')}</strong>
            ${item.chapterTitle ? `<div class="setting-desc">${Utils.escapeHtml(item.chapterTitle)}</div>` : ''}
          </div>
          ${item.highlightText ? `<blockquote style="margin:0;padding-left:10px;border-left:2px solid var(--accent);font-style:italic;font-size:0.88rem;">${Utils.escapeHtml(item.highlightText)}</blockquote>` : ''}
          <p style="font-size:0.92rem;">${Utils.escapeHtml(item.text || item.title || item.description || '')}</p>
          ${(item.tags || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;">${item.tags.map(t => `<span class="pill-chip" style="min-height:26px;">#${Utils.escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${linked.length ? `<div class="setting-desc">Connected to: ${linked.map(ln => `"${Utils.escapeHtml(ln.text.slice(0, 32))}…"`).join(', ')}</div>` : ''}
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:auto;">
            ${bk ? `<button type="button" class="btn btn-primary btn-xs" data-vault-jump="${item.bookId},${item.bookTime}">Listen at Timestamp</button>` : ''}
            ${item.kind !== 'bookmark' ? `<button type="button" class="btn btn-secondary btn-xs" data-vault-link="${item.id}">Connect Idea</button>` : ''}
            <button type="button" class="btn btn-ghost btn-xs" data-vault-del="${item.kind === 'bookmark' ? 'bm' : 'nt'}:${item.id}">Delete</button>
          </div>
        </article>
      `;
    }).join('');

    listEl.querySelectorAll('[data-vault-jump]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [bid, pos] = btn.dataset.vaultJump.split(',');
        this.player.loadBook(bid, true, Number(pos));
      });
    });

    listEl.querySelectorAll('[data-vault-link]').forEach(btn => {
      btn.addEventListener('click', () => this.openConnectIdeaModal(btn.dataset.vaultLink));
    });

    listEl.querySelectorAll('[data-vault-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [kind, id] = btn.dataset.vaultDel.split(':');
        await this.db.delete(kind === 'bm' ? 'bookmarks' : 'notes', id);
        await this.refreshData();
        UI.toast('Entry deleted.');
      });
    });
  }

  /* ------------------------------------------------------------------------
     RENDER: STATISTICS, CALENDAR & FINISH-TIME CALCULATOR
     v2: current streak metric, 4-level heatmap calendar, weekly goal ring.
     ------------------------------------------------------------------------ */
  renderStats() {
    const container = document.getElementById('stats-container');
    const totalListened = this.sessions.reduce((s, x) => s + x.listenedSeconds, 0);
    const totalUnique = this.books.reduce((s, b) => s + this.getBookStats(b).coveredSec, 0);
    const completedCount = this.books.filter(b => b.completed).length;

    const activeDays = new Set(this.sessions.map(s => s.dateKey));
    const avgDaily = activeDays.size ? totalListened / activeDays.size : 0;

    // Current listening streak (consecutive active days ending today or yesterday)
    let streak = 0;
    for (let off = 0; off <= 400; off++) {
      const key = Utils.dateKeyOffset(-off);
      if (activeDays.has(key)) streak++;
      else if (off === 0) continue;   // today may not have listening yet — try yesterday
      else break;
    }

    // Monthly calendar with heat levels
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const dayTotals = new Map();
    this.sessions.forEach(s => dayTotals.set(s.dateKey, (dayTotals.get(s.dateKey) || 0) + s.listenedSeconds));
    const goalMin = this.settings.dailyGoalMin || 30;

    let calHtml = '';
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const min = Math.round((dayTotals.get(key) || 0) / 60);
      let heat = 0;
      if (min > 0) {
        const ratio = min / goalMin;
        heat = ratio >= 1 ? 4 : ratio >= 0.66 ? 3 : ratio >= 0.33 ? 2 : 1;
      }
      calHtml += `<button type="button" class="cal-day ${heat ? `has-activity heat-${heat}` : ''} ${this.selectedCalendarDate === key ? 'is-selected' : ''}" data-cal-day="${key}" aria-label="${key}: ${min} minutes listened">
        <span>${d}</span>
        ${min > 0 ? `<span class="cal-min">${min}m</span>` : ''}
      </button>`;
    }

    const selSessions = this.sessions.filter(s => s.dateKey === this.selectedCalendarDate);
    const selMin = Math.round(selSessions.reduce((a, b) => a + b.listenedSeconds, 0) / 60);

    // This week vs weekly goal
    const weekKeys = new Set(Array.from({ length: 7 }, (_, i) => Utils.dateKeyOffset(-6 + i)));
    const weekSec = this.sessions.filter(s => weekKeys.has(s.dateKey)).reduce((a, b) => a + b.listenedSeconds, 0);
    const weekPct = Utils.clamp(((weekSec / 60) / (this.settings.weeklyGoalMin || 210)) * 100, 0, 100);

    // Finish-Time Estimator
    const targetBook = this.player.book || this.books.find(b => !b.completed);
    let estimatorHtml = `<p class="setting-desc">Import an audiobook to calculate completion estimates.</p>`;
    if (targetBook) {
      const st = this.getBookStats(targetBook);
      const remAudioSec = Math.max(0, (targetBook.duration || 0) - st.pos);
      const speed = targetBook.preferredSpeed || this.settings.defaultSpeed || 1;
      const realSecondsNeeded = remAudioSec / speed;
      const dailySecBudget = activeDays.size >= 2 ? avgDaily : (this.settings.dailyGoalMin * 60);
      const estDays = dailySecBudget > 0 ? Math.ceil(realSecondsNeeded / dailySecBudget) : 0;
      const estDate = new Date(Date.now() + estDays * 86400000).toLocaleDateString();
      estimatorHtml = `
        <strong>${Utils.escapeHtml(targetBook.title)}</strong>
        <p class="setting-desc">Remaining at ${speed.toFixed(2)}x: ${Utils.formatDurationHuman(realSecondsNeeded)}</p>
        <p class="setting-desc">${activeDays.size >= 2
          ? `Based on your ${Math.round(avgDaily / 60)}m/active-day average: ~${estDays} day(s) (${estDate})`
          : `Insufficient historical data (<2 days) — using your ${this.settings.dailyGoalMin}m/day target: ~${estDays} day(s) (${estDate})`}</p>
      `;
    }

    // Favourite Authors
    const authorSec = new Map();
    this.books.forEach(b => {
      if (!b.author) return;
      authorSec.set(b.author, (authorSec.get(b.author) || 0) + this.getBookStats(b).coveredSec);
    });
    const topAuthors = [...authorSec.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

    container.innerHTML = `
      <section class="stats-card glass-secondary">
        <h2>Listening Totals vs. Unique Coverage</h2>
        <div class="metric-pair-grid">
          <div class="metric-tile"><span class="metric-val">${Utils.formatDurationHuman(totalListened)}</span><span class="metric-lbl">Total Playback Time</span></div>
          <div class="metric-tile"><span class="metric-val">${Utils.formatDurationHuman(totalUnique)}</span><span class="metric-lbl">Unique Book Coverage</span></div>
          <div class="metric-tile"><span class="metric-val">${completedCount}</span><span class="metric-lbl">Completed Books</span></div>
          <div class="metric-tile"><span class="metric-val">${streak} day${streak === 1 ? '' : 's'}</span><span class="metric-lbl">Current Streak</span></div>
        </div>
        <div>
          <h3>Finish-Time Calculator</h3>
          ${estimatorHtml}
        </div>
      </section>

      <section class="stats-card glass-secondary">
        <div class="panel-head">
          <h2>${now.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <span class="setting-desc">${selMin}m on ${this.selectedCalendarDate}</span>
        </div>
        <div class="calendar-grid">${calHtml}</div>
        <div class="setting-desc">
          ${selSessions.length
            ? `${selSessions.length} session(s) recorded on ${this.selectedCalendarDate}.`
            : `No listening sessions recorded on ${this.selectedCalendarDate}.`}
        </div>
        <div class="goal-wrap" style="margin-top:4px;">
          <div class="goal-ring" style="--pct:${weekPct.toFixed(1)}" role="img" aria-label="Weekly goal ${Math.round(weekSec / 60)} of ${this.settings.weeklyGoalMin} minutes">
            <span class="goal-ring-inner">
              <span class="goal-ring-val tabular">${weekPct.toFixed(0)}%</span>
              <span class="goal-ring-lbl">of week</span>
            </span>
          </div>
          <div style="flex:1;min-width:180px;display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;justify-content:space-between;font-size:0.82rem;">
              <span>This week: <strong class="tabular">${Math.round(weekSec / 60)}m</strong> / ${this.settings.weeklyGoalMin}m</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${weekPct}%"></div></div>
          </div>
        </div>
      </section>

      <section class="stats-card glass-secondary">
        <h2>Reading Goals</h2>
        <div class="setting-desc">Daily Target: ${this.settings.dailyGoalMin}m · Weekly Target: ${this.settings.weeklyGoalMin}m · Monthly Target: ${this.settings.monthlyGoalMin}m</div>
        ${topAuthors.length ? `<div><h3>Top Authors by Coverage</h3>${topAuthors.map(([a, sec]) => `<div class="list-item-row"><span>${Utils.escapeHtml(a)}</span><span class="setting-desc">${Utils.formatDurationHuman(sec)}</span></div>`).join('')}</div>` : ''}
      </section>
    `;

    container.querySelectorAll('[data-cal-day]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectedCalendarDate = btn.dataset.calDay;
        this.renderStats();
      });
    });
  }

  /* ------------------------------------------------------------------------
     RENDER: SETTINGS, STORAGE & CAPABILITIES
     ------------------------------------------------------------------------ */
  async renderSettings() {
    document.querySelectorAll('[data-theme-mode]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.themeMode === this.settings.themeMode);
    });
    document.querySelectorAll('[data-palette-choice]').forEach(b => {
      b.classList.toggle('is-active', b.dataset.paletteChoice === this.settings.palette);
    });
    document.getElementById('setting-default-speed').value = String(this.settings.defaultSpeed);
    document.getElementById('setting-skip-back').value = String(this.settings.skipBack);
    document.getElementById('setting-skip-fwd').value = String(this.settings.skipFwd);
    document.getElementById('setting-webaudio-enabled').checked = !!this.settings.webAudioEnabled;

    // Storage Overview
    const storageEl = document.getElementById('storage-overview');
    const files = await this.db.getAll('files');
    const localCopyBytes = files.filter(f => f.storageMode === 'local-copy').reduce((s, f) => s + (f.size || 0), 0);
    let estHtml = `<div class="cap-item"><span>Local Audio Copies</span><strong>${Utils.formatBytes(localCopyBytes)}</strong></div>`;
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      estHtml += `<div class="cap-item"><span>Browser Origin Used</span><strong>${Utils.formatBytes(est.usage || 0)}</strong></div>`;
      estHtml += `<div class="cap-item"><span>Browser Quota</span><strong>${Utils.formatBytes(est.quota || 0)}</strong></div>`;
    }
    if (navigator.storage?.persisted) {
      const p = await navigator.storage.persisted();
      estHtml += `<div class="cap-item"><span>Persistent Storage</span><strong>${p ? 'Granted' : 'Best Effort'}</strong></div>`;
    }
    storageEl.innerHTML = estHtml;

    // Capabilities
    const caps = Utils.detectCapabilities();
    document.getElementById('capabilities-list').innerHTML = `
      <div class="cap-item"><span>IndexedDB</span><strong>${caps.indexedDB ? 'Supported' : 'Unavailable'}</strong></div>
      <div class="cap-item"><span>OPFS Audio Storage</span><strong>${caps.opfs ? 'Supported' : 'IDB Fallback'}</strong></div>
      <div class="cap-item"><span>File System Access</span><strong>${caps.fileSystemAccess ? 'Supported' : 'Standard Input'}</strong></div>
      <div class="cap-item"><span>Web Audio EQ</span><strong>${caps.webAudio ? 'Supported' : 'Native Only'}</strong></div>
      <div class="cap-item"><span>Media Session Keys</span><strong>${caps.mediaSession ? 'Supported' : 'Unavailable'}</strong></div>
      <div class="cap-item"><span>MP3 / M4B Codecs</span><strong>${caps.codecs.mp3 || 'no'} / ${caps.codecs.m4b || 'no'}</strong></div>
      <div class="cap-item"><span>App Version</span><strong>v${APP_CONFIG.version}</strong></div>
    `;
  }

  /* ------------------------------------------------------------------------
     RENDER: PLAYBACK UI (Mini-Player, Full Player, Coverage, EQ, Transcript)
     ------------------------------------------------------------------------ */
  renderMiniPlayerVisibility() {
    document.getElementById('mini-player').hidden = !this.player.book;
  }

  renderPlaybackUI() {
    const book = this.player.book;
    if (!book) return;
    const isPlaying = !this.player.audio.paused;
    const { chapter, index } = this.player.getCurrentChapter();
    const st = this.getBookStats(book);

    document.body.classList.toggle('is-audio-playing', isPlaying);
    document.title = `${isPlaying ? '▶ ' : ''}${book.title} — ${APP_CONFIG.appName}`;

    const playSvg = `<polygon points="7,5 20,12 7,19" fill="currentColor"/>`;
    const pauseSvg = `<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>`;
    document.getElementById('mini-play-icon').innerHTML = isPlaying ? pauseSvg : playSvg;
    document.getElementById('fp-play-icon').innerHTML = isPlaying ? pauseSvg : playSvg;
    document.getElementById('fp-play-btn').classList.toggle('is-playing', isPlaying);

    document.getElementById('mini-title').textContent = book.title;
    document.getElementById('mini-subtitle').textContent = chapter ? chapter.title : (book.author || 'Playing');
    const miniCov = document.getElementById('mini-cover');
    const miniFb = document.getElementById('mini-cover-fallback');
    if (book.artworkDataUrl) {
      miniCov.src = book.artworkDataUrl; miniCov.hidden = false; miniFb.hidden = true;
    } else {
      miniCov.removeAttribute('src'); miniCov.hidden = true; miniFb.hidden = false; miniFb.textContent = Utils.initials(book.title);
    }

    document.getElementById('fp-book-title').textContent = book.title;
    document.getElementById('fp-book-author').textContent = [book.author, book.narrator ? `Narrated by ${book.narrator}` : ''].filter(Boolean).join(' · ');
    document.getElementById('fp-current-chapter').textContent = chapter ? chapter.title : '';
    document.getElementById('fp-chapter-indicator').textContent = `Chapter ${index + 1} of ${Math.max(1, this.player.chapters.length)}`;
    document.getElementById('fp-coverage-badge').textContent = `${st.covPct.toFixed(1)}% Covered`;
    document.getElementById('fp-speed-readout').textContent = `${(this.player.audio.playbackRate || 1).toFixed(2)}x`;
    document.getElementById('fp-skip-back-label').textContent = `-${this.settings.skipBack}s`;
    document.getElementById('fp-skip-fwd-label').textContent = `+${this.settings.skipFwd}s`;

    const fpCov = document.getElementById('fp-cover');
    const fpFb = document.getElementById('fp-cover-fallback');
    if (book.artworkDataUrl) {
      fpCov.src = book.artworkDataUrl; fpCov.hidden = false; fpFb.hidden = true;
    } else {
      fpCov.removeAttribute('src'); fpCov.hidden = true; fpFb.hidden = false; fpFb.textContent = Utils.initials(book.title);
    }

    const sl = this.player.sleepTimer;
    document.getElementById('fp-sleep-btn').textContent = sl.mode === 'off'
      ? 'Sleep: Off'
      : sl.mode === 'end-chapter'
        ? 'Sleep: End Ch.'
        : sl.mode === 'end-book'
          ? 'Sleep: End Book'
          : `Sleep: ${Math.max(1, Math.ceil((sl.endsAt - Date.now()) / 60000))}m`;

    this._updateSpeedPresets();
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

    // Persistent full-player timeline — cheap playhead move every tick,
    // heavier segment re-layout throttled to twice per second.
    const tlContainer = document.getElementById('fp-coverage-timeline');
    if (tlContainer) {
      if (!this._fpTimelineView || this._fpTimelineView.el.parentNode !== tlContainer) {
        tlContainer.innerHTML = '';
        this._fpTimelineView = new CoverageTimelineView(this, {
          onSeek: (sec) => this.player.seekToBookPosition(sec)
        });
        tlContainer.appendChild(this._fpTimelineView.el);
        // keep the original static tooltip element reference in sync
        const legacyTip = document.getElementById('fp-timeline-tooltip');
        if (legacyTip) legacyTip.remove();
      }
      const heavyDue = force || (performance.now() - this._lastSegmentSyncAt) > 500;
      if (heavyDue) {
        this._lastSegmentSyncAt = performance.now();
        document.getElementById('fp-coverage-badge').textContent = `${st.covPct.toFixed(1)}% Covered`;
        this._fpTimelineView.update(book, this.player.chapters, st, isChap);
      } else {
        // playhead-only fast path
        const span = Math.max(1, maxT - minT);
        const ratio = Utils.clamp(((st.pos - minT) / span) * 100, 0, 100);
        this._fpTimelineView._lastRatio = ratio / 100;
        this._fpTimelineView._playhead.style.left = `${ratio}%`;
      }
    }

    if (this.fullPlayerTab === 'transcript') {
      this._highlightTranscriptCue(st.pos);
    }
    if (this.fullPlayerTab === 'chapters') {
      this._highlightCurrentChapterRow();
    }
  }

  _highlightCurrentChapterRow() {
    const panel = document.getElementById('fp-panel-chapters');
    if (!panel || !this.player.book) return;
    const { index } = this.player.getCurrentChapter();
    panel.querySelectorAll('.fp-chap-row').forEach(row => {
      row.classList.toggle('is-current', Number(row.dataset.chapIndex) === index);
    });
  }

  _updateSpeedPresets() {
    const rate = Math.round((this.player.audio.playbackRate || 1) * 100) / 100;
    document.querySelectorAll('#fp-speed-presets .sp-btn').forEach(btn => {
      btn.classList.toggle('is-active', Number(btn.dataset.speed) === rate);
    });
  }

  _syncVolumeUI() {
    const a = this.player.audio;
    const slider = document.getElementById('fp-volume');
    const icon = document.getElementById('fp-vol-icon');
    if (slider) {
      slider.value = String(a.muted ? 0 : a.volume);
      Utils.setRangeFill(slider);
    }
    if (icon) {
      const level = a.muted ? 0 : a.volume;
      icon.innerHTML = level === 0
        ? `<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M17 9l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>`
        : level < 0.45
          ? `<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 9.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`
          : `<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`;
    }
  }

  _renderFullPlayerToolPanel() {
    const book = this.player.book;
    if (!book) return;
    const st = this.getBookStats(book);
    const { index: curChapIdx } = this.player.getCurrentChapter();

    // Chapters — rebuilt only when the chapter set changes; current row
    // highlighting is handled per tick via _highlightCurrentChapterRow.
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
      chapPanel.querySelectorAll('[data-fp-chap]').forEach(el => {
        const go = () => this.player.seekToBookPosition(Number(el.dataset.fpChap));
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
      });
    }

    // Coverage Recovery
    const covPanel = document.getElementById('fp-panel-coverage');
    const firstGap = st.gaps[0] || null;
    covPanel.innerHTML = `
      <div class="metric-pair-grid">
        <div class="metric-tile"><span class="metric-val">${st.covPct.toFixed(1)}%</span><span class="metric-lbl">Unique Covered</span></div>
        <div class="metric-tile"><span class="metric-val">${Utils.formatDurationHuman(st.listenedSec)}</span><span class="metric-lbl">Total Listened</span></div>
      </div>
      ${firstGap ? `<button type="button" class="btn btn-primary btn-sm" id="fp-jump-first-gap">Jump to First Unplayed (${Utils.formatTime(firstGap[0])})</button>` : '<p class="setting-desc">No unplayed gaps detected.</p>'}
      ${st.gaps.slice(0, 8).map(([a, b]) => `
        <div class="list-item-row">
          <span class="tabular">${Utils.formatTime(a)} – ${Utils.formatTime(b)}</span>
          <button type="button" class="btn btn-secondary btn-xs" data-fp-gap="${a}">Play Gap</button>
        </div>
      `).join('')}
    `;
    covPanel.querySelector('#fp-jump-first-gap')?.addEventListener('click', () => this.player.seekToBookPosition(firstGap[0]));
    covPanel.querySelectorAll('[data-fp-gap]').forEach(btn => {
      btn.addEventListener('click', () => this.player.seekToBookPosition(Number(btn.dataset.fpGap)));
    });

    // Equaliser — rebuilt only when the EQ state signature changes so an
    // in-progress slider drag is never destroyed mid-gesture.
    const eq = this.player.eqState;
    const eqPanel = document.getElementById('fp-panel-eq');
    const eqKey = `eq:${eq.preset}:${eq.bass}:${eq.mid}:${eq.voice}:${eq.treble}:${this.settings.webAudioEnabled ? 1 : 0}`;
    if (eqPanel.dataset.key !== eqKey) {
      eqPanel.dataset.key = eqKey;
      eqPanel.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:6px;">
          ${Object.entries(EQ_PRESETS).filter(([k]) => k !== 'custom').map(([k, p]) => `
            <button type="button" class="pill-chip ${eq.preset === k ? 'is-active' : ''}" data-eq-preset="${k}">${p.label}</button>
          `).join('')}
        </div>
        <div class="eq-slider-row"><span>Bass (120Hz)</span><input type="range" min="-8" max="8" step="0.5" value="${eq.bass}" data-eq-band="bass" aria-label="Bass gain"><span class="tabular">${eq.bass} dB</span></div>
        <div class="eq-slider-row"><span>Mid (950Hz)</span><input type="range" min="-8" max="8" step="0.5" value="${eq.mid}" data-eq-band="mid" aria-label="Mid gain"><span class="tabular">${eq.mid} dB</span></div>
        <div class="eq-slider-row"><span>Clarity (3.1k)</span><input type="range" min="-8" max="8" step="0.5" value="${eq.voice}" data-eq-band="voice" aria-label="Clarity gain"><span class="tabular">${eq.voice} dB</span></div>
        <div class="eq-slider-row"><span>Treble (8kHz)</span><input type="range" min="-8" max="8" step="0.5" value="${eq.treble}" data-eq-band="treble" aria-label="Treble gain"><span class="tabular">${eq.treble} dB</span></div>
        <p class="setting-desc">Preset “Off (Native)” bypasses the equaliser completely; drag sliders for a custom profile.</p>
      `;
      eqPanel.querySelectorAll('input[data-eq-band]').forEach(inp => {
        Utils.setRangeFill(inp);
        inp.addEventListener('input', async () => {
          this.player.eqState.preset = 'custom';
          this.player.eqState.enabled = true;
          this.player.eqState[inp.dataset.eqBand] = Number(inp.value);
          this.player.initWebAudioIfNeeded();
          this.player.applyEQ();
          Utils.setRangeFill(inp);
          inp.nextElementSibling.textContent = `${inp.value} dB`;
          await this.db.put('settings', { key: 'eq_state', value: this.player.eqState });
          eqPanel.dataset.key = ''; // allow refresh when drag finishes
        });
      });
      eqPanel.querySelectorAll('[data-eq-preset]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const p = EQ_PRESETS[btn.dataset.eqPreset];
          this.player.eqState = { preset: btn.dataset.eqPreset, bass: p.bass, mid: p.mid, voice: p.voice, treble: p.treble, enabled: p.enabled };
          this.player.initWebAudioIfNeeded();
          this.player.applyEQ();
          await this.db.put('settings', { key: 'eq_state', value: this.player.eqState });
          this._renderFullPlayerToolPanel();
        });
      });
    }

    // Transcript — rebuilt only when the transcript identity changes.
    const trPanel = document.getElementById('fp-panel-transcript');
    const tr = this.transcriptsMap.get(book.id);
    const trKey = `tr:${book.id}:${tr ? tr.cues.length : 0}`;
    if (trPanel.dataset.key !== trKey) {
      trPanel.dataset.key = trKey;
      if (!tr) {
        trPanel.innerHTML = `<p class="setting-desc">No transcript attached to this audiobook. Attach a local .vtt or .srt file from Book Details to enable synced reading and text highlights.</p>`;
      } else {
        trPanel.innerHTML = tr.cues.slice(0, 600).map((c, idx) => `
          <div class="transcript-cue" data-cue-idx="${idx}" data-cue-start="${c.start}">
            <span class="setting-desc tabular">${Utils.formatTime(c.start)}</span>
            <span>${Utils.escapeHtml(c.text)}</span>
            <button type="button" class="btn btn-ghost btn-xs" style="align-self:flex-start;" data-cue-hl="${idx}">Save Highlight</button>
          </div>
        `).join('');
        trPanel.querySelectorAll('[data-cue-start]').forEach(el => {
          el.addEventListener('click', (e) => {
            if (e.target.closest('[data-cue-hl]')) return;
            this.player.seekToBookPosition(Number(el.dataset.cueStart));
          });
        });
        trPanel.querySelectorAll('[data-cue-hl]').forEach(btn => {
          btn.addEventListener('click', async () => {
            const cue = tr.cues[Number(btn.dataset.cueHl)];
            const { chapter, index } = this.player.getCurrentChapter();
            await this.db.put('notes', {
              id: Utils.uid('note'),
              bookId: book.id,
              chapterIndex: index,
              chapterTitle: chapter?.title || '',
              bookTime: cue.start,
              type: 'highlight',
              tags: ['transcript'],
              text: 'Saved transcript highlight',
              highlightText: cue.text,
              linkedNoteIds: [],
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
            await this.refreshData();
            UI.toast('Transcript highlight saved to Knowledge Vault.', 'success');
          });
        });
      }
      // v2: paint the current cue immediately, even while paused.
      this._highlightTranscriptCue(this.player.getBookPosition());
    }
  }

  _highlightTranscriptCue(pos) {
    const tr = this.transcriptsMap.get(this.player.book?.id);
    if (!tr) return;
    const panel = document.getElementById('fp-panel-transcript');
    const idx = tr.cues.findIndex(c => pos >= c.start && pos <= c.end);
    panel.querySelectorAll('.transcript-cue').forEach(el => {
      const isCurrent = Number(el.dataset.cueIdx) === idx;
      if (el.classList.contains('is-current') !== isCurrent) {
        el.classList.toggle('is-current', isCurrent);
        if (isCurrent) {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    });
  }

  /* ------------------------------------------------------------------------
     MODALS: IMPORT, QUICK BOOKMARK, NOTES, METADATA EDIT, BACKUP, GOALS
     ------------------------------------------------------------------------ */
  openImportChooserModal() {
    const caps = Utils.detectCapabilities();
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <p class="setting-desc">Select audio files or an audiobook folder. Files are scanned locally; nothing is uploaded to any server.</p>
      <div class="form-grid form-grid-2">
        <button type="button" class="btn btn-primary" id="imp-pick-files">Select Audio Files</button>
        <button type="button" class="btn btn-secondary" id="imp-pick-folder">Select Folder</button>
        ${caps.fileSystemAccess ? `<button type="button" class="btn btn-secondary" id="imp-fsa-files">Pick Files (Reference / Copy)</button>` : ''}
        ${typeof window.showDirectoryPicker === 'function' ? `<button type="button" class="btn btn-secondary" id="imp-fsa-dir">Pick Folder (Reference / Copy)</button>` : ''}
      </div>
    `;

    wrap.querySelector('#imp-pick-files').addEventListener('click', () => {
      UI.closeModal();
      document.getElementById('file-input-audio').click();
    });
    wrap.querySelector('#imp-pick-folder').addEventListener('click', () => {
      UI.closeModal();
      document.getElementById('file-input-folder').click();
    });
    wrap.querySelector('#imp-fsa-files')?.addEventListener('click', async () => {
      try {
        const handles = await window.showOpenFilePicker({ multiple: true });
        UI.closeModal();
        const entries = await Promise.all(handles.map(async h => ({ file: await h.getFile(), path: h.name, handle: h })));
        await this.importer.processFileEntries(entries);
      } catch { /* User cancelled */ }
    });
    wrap.querySelector('#imp-fsa-dir')?.addEventListener('click', async () => {
      try {
        const dirHandle = await window.showDirectoryPicker();
        UI.closeModal();
        const entries = [];
        const walk = async (dh, prefix) => {
          for await (const entry of dh.values()) {
            const p = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.kind === 'file') entries.push({ file: await entry.getFile(), path: p, handle: entry });
            else if (entry.kind === 'directory') await walk(entry, p);
          }
        };
        await walk(dirHandle, dirHandle.name);
        await this.importer.processFileEntries(entries);
      } catch { /* User cancelled */ }
    });

    UI.openModal({ title: 'Import Audiobooks', bodyEl: wrap });
  }

  async createQuickBookmark() {
    const book = this.player.book;
    if (!book) return;
    const pos = this.player.getBookPosition();
    const { chapter, index } = this.player.getCurrentChapter();
    await this.db.put('bookmarks', {
      id: Utils.uid('bm'),
      bookId: book.id,
      chapterIndex: index,
      chapterTitle: chapter?.title || '',
      chapterTime: chapter ? Math.max(0, pos - chapter.bookStart) : pos,
      bookTime: pos,
      title: `Bookmark at ${Utils.formatTime(pos)}`,
      description: '',
      createdAt: Date.now()
    });
    await this.refreshData();
    UI.toast(`Bookmarked at ${Utils.formatTime(pos)}`, 'success');
  }

  openNewNoteModal(prefillBook = null) {
    let book = prefillBook || this.player.book || this.books[0];
    if (!book) {
      UI.toast('Import an audiobook first before creating a note.', 'error');
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <label class="field-label">Audiobook
        <select id="note-book-sel">${this.books.map(b => `<option value="${b.id}" ${b.id === book.id ? 'selected' : ''}>${Utils.escapeHtml(b.title)}</option>`).join('')}</select>
      </label>
      <div class="form-grid form-grid-2">
        <label class="field-label">Type
          <select id="note-type-sel">
            <option value="note">Note</option>
            <option value="quote">Quote</option>
            <option value="idea">Idea</option>
            <option value="question">Question</option>
          </select>
        </label>
        <label class="field-label">Tags (comma separated)
          <input type="text" id="note-tags-inp" placeholder="stoicism, focus, leadership">
        </label>
      </div>
      <label class="field-label">Content
        <textarea id="note-text-inp" rows="4" placeholder="Capture your thought, quote, or reflection..."></textarea>
      </label>
      <p class="setting-desc" id="note-position-hint"></p>
    `;

    // v2: position follows whichever book is selected in the dropdown.
    const posHint = wrap.querySelector('#note-position-hint');
    const selectedBook = () => this.books.find(b => b.id === wrap.querySelector('#note-book-sel').value) || book;
    const currentPos = () => {
      const sel = selectedBook();
      if (this.player.book?.id === sel.id) return this.player.getBookPosition();
      return this.progressMap.get(sel.id)?.bookPosition || 0;
    };
    const refreshHint = () => {
      const p = currentPos();
      const sel = selectedBook();
      const chapters = this.chaptersMap.get(sel.id) || [];
      const ch = [...chapters].reverse().find(c => p >= c.bookStart - 0.25) || chapters[0];
      posHint.textContent = `Timestamp: ${Utils.formatTime(p)}${ch ? ` — during “${ch.title}”` : ''}`;
    };
    refreshHint();
    wrap.querySelector('#note-book-sel').addEventListener('change', refreshHint);

    UI.openModal({
      title: 'New Note',
      bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Save Note',
          className: 'btn-primary',
          onClick: async () => {
            const sel = selectedBook();
            const pos = currentPos();
            const text = wrap.querySelector('#note-text-inp').value.trim();
            if (!text) return UI.toast('Please enter note content.', 'error');
            const tags = wrap.querySelector('#note-tags-inp').value.split(',').map(s => s.trim()).filter(Boolean);
            const chapters = this.chaptersMap.get(sel.id) || [];
            const ch = [...chapters].reverse().find(c => pos >= c.bookStart - 0.25) || chapters[0];
            await this.db.put('notes', {
              id: Utils.uid('note'),
              bookId: sel.id,
              chapterIndex: ch ? chapters.indexOf(ch) : 0,
              chapterTitle: ch?.title || '',
              bookTime: pos,
              type: wrap.querySelector('#note-type-sel').value,
              tags,
              text,
              highlightText: '',
              linkedNoteIds: [],
              createdAt: Date.now(),
              updatedAt: Date.now()
            });
            await this.refreshData();
            UI.closeModal();
            UI.toast('Note saved to Knowledge Vault.', 'success');
          }
        }
      ]
    });
  }

  openConnectIdeaModal(noteId) {
    const note = this.notes.find(n => n.id === noteId);
    if (!note) return;
    const others = this.notes.filter(n => n.id !== noteId);
    if (!others.length) {
      UI.toast('Create another note first to connect ideas across books.');
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = others.map(o => {
      const bk = this.books.find(b => b.id === o.bookId);
      const checked = (note.linkedNoteIds || []).includes(o.id);
      return `<label class="list-item-row" style="cursor:pointer;">
        <span><strong>${Utils.escapeHtml(bk?.title || '')}</strong>: ${Utils.escapeHtml(o.text.slice(0, 64))}</span>
        <input type="checkbox" value="${o.id}" ${checked ? 'checked' : ''}>
      </label>`;
    }).join('');

    UI.openModal({
      title: 'Connect Related Ideas',
      bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Save Connections',
          className: 'btn-primary',
          onClick: async () => {
            note.linkedNoteIds = Array.from(wrap.querySelectorAll('input:checked')).map(c => c.value);
            note.updatedAt = Date.now();
            await this.db.put('notes', note);
            await this.refreshData();
            UI.closeModal();
            UI.toast('Connections updated.', 'success');
          }
        }
      ]
    });
  }

  openCreateCollectionModal() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<label class="field-label">Collection Name <input type="text" id="new-col-name" placeholder="e.g., Philosophy, Currently Studying"></label>`;
    UI.openModal({
      title: 'New Personal Collection',
      bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Create',
          className: 'btn-primary',
          onClick: async () => {
            const name = wrap.querySelector('#new-col-name').value.trim();
            if (!name) return;
            await this.db.put('collections', { id: Utils.uid('col'), name, description: '', orderIndex: this.collections.length, createdAt: Date.now() });
            await this.refreshData();
            UI.closeModal();
            UI.toast(`Collection "${name}" created.`, 'success');
          }
        }
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
      title: 'Edit Metadata',
      bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Save Changes',
          className: 'btn-primary',
          onClick: async () => {
            book.title = wrap.querySelector('#ed-title').value.trim() || book.title;
            book.author = wrap.querySelector('#ed-author').value.trim();
            book.narrator = wrap.querySelector('#ed-narrator').value.trim();
            book.series = wrap.querySelector('#ed-series').value.trim();
            const si = wrap.querySelector('#ed-series-idx').value;
            book.seriesIndex = si ? Number(si) : null;
            book.genre = wrap.querySelector('#ed-genre').value.trim();
            await this.db.put('books', book);
            await this.refreshData();
            UI.closeModal();
            UI.toast('Metadata updated.', 'success');
          }
        }
      ]
    });
  }

  async deleteBookWithConfirm(book) {
    const ok = await UI.confirm({
      title: 'Remove Audiobook',
      message: `Remove "${book.title}" and its local browser audio copies, coverage history, bookmarks, and notes? Original files on your disk are never touched.`,
      confirmLabel: 'Remove Book',
      danger: true
    });
    if (!ok) return;

    if (this.player.book?.id === book.id) {
      this.player.unloadBook();
      this.renderMiniPlayerVisibility();
      document.getElementById('full-player').hidden = true;
    }
    const files = await this.db.getByIndex('files', 'bookId', book.id);
    for (const f of files) {
      await MediaStorage.deleteAudioCopy(f);
      await this.db.delete('files', f.id);
    }
    const chaps = await this.db.getByIndex('chapters', 'bookId', book.id);
    for (const c of chaps) await this.db.delete('chapters', c.id);
    for (const bm of this.bookmarks.filter(x => x.bookId === book.id)) await this.db.delete('bookmarks', bm.id);
    for (const nt of this.notes.filter(x => x.bookId === book.id)) await this.db.delete('notes', nt.id);
    await this.db.delete('progress', book.id);
    await this.db.delete('coverage', book.id);
    await this.db.delete('transcripts', book.id);
    await this.db.delete('books', book.id);

    await this.refreshData();
    this.navigate('library');
    UI.toast('Audiobook removed.');
  }

  async exportBackup() {
    const payload = {
      app: APP_CONFIG.appName,
      version: APP_CONFIG.version,
      schemaVersion: APP_CONFIG.schemaVersion,
      exportedAt: new Date().toISOString(),
      data: {
        books: await this.db.getAll('books'),
        chapters: await this.db.getAll('chapters'),
        progress: await this.db.getAll('progress'),
        coverage: await this.db.getAll('coverage'),
        sessions: await this.db.getAll('sessions'),
        bookmarks: await this.db.getAll('bookmarks'),
        notes: await this.db.getAll('notes'),
        collections: await this.db.getAll('collections'),
        transcripts: await this.db.getAll('transcripts'),
        settings: await this.db.getAll('settings')
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cadence-backup-${Utils.localDateKey()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    UI.toast('Backup exported.', 'success');
  }

  async previewAndRestoreBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.data || !Array.isArray(parsed.data.books)) {
        return UI.toast('Invalid Cadence backup file.', 'error');
      }
      const d = parsed.data;
      const wrap = document.createElement('div');
      wrap.className = 'form-grid';
      wrap.innerHTML = `
        <p class="setting-desc">Backup v${Utils.escapeHtml(parsed.version || '?')} exported ${Utils.escapeHtml(parsed.exportedAt || '')}</p>
        <div class="metric-pair-grid">
          <div class="metric-tile"><span class="metric-val">${d.books.length}</span><span class="metric-lbl">Books</span></div>
          <div class="metric-tile"><span class="metric-val">${(d.notes || []).length + (d.bookmarks || []).length}</span><span class="metric-lbl">Notes &amp; Bookmarks</span></div>
        </div>
        <label style="display:flex;gap:8px;font-size:0.85rem;cursor:pointer;"><input type="radio" name="restore-mode" value="merge" checked> Merge with existing records</label>
        <label style="display:flex;gap:8px;font-size:0.85rem;cursor:pointer;"><input type="radio" name="restore-mode" value="replace"> Replace existing library &amp; history</label>
      `;

      UI.openModal({
        title: 'Restore Backup',
        bodyEl: wrap,
        footerButtons: [
          { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
          {
            label: 'Apply Restore',
            className: 'btn-primary',
            onClick: async () => {
              const mode = wrap.querySelector('input[name="restore-mode"]:checked')?.value || 'merge';
              const stores = ['books', 'chapters', 'progress', 'coverage', 'sessions', 'bookmarks', 'notes', 'collections', 'transcripts', 'settings'];
              if (mode === 'replace') {
                for (const s of stores) await this.db.clearStore(s);
              }
              for (const s of stores) {
                if (Array.isArray(d[s]) && d[s].length) await this.db.putMany(s, d[s]);
              }
              await this._loadSettings();
              this.applyTheme();
              await this.refreshData();
              UI.closeModal();
              UI.toast('Backup restored successfully.', 'success');
            }
          }
        ]
      });
    } catch {
      UI.toast('Could not parse backup JSON.', 'error');
    }
  }

  openSleepTimerModal() {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid form-grid-2';
    [
      { label: 'Off', mode: 'off', min: 0 },
      { label: '15 Minutes', mode: 'minutes', min: 15 },
      { label: '30 Minutes', mode: 'minutes', min: 30 },
      { label: '45 Minutes', mode: 'minutes', min: 45 },
      { label: '60 Minutes', mode: 'minutes', min: 60 },
      { label: 'End of Chapter', mode: 'end-chapter', min: 0 },
      { label: 'End of Book', mode: 'end-book', min: 0 }
    ].forEach(opt => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-secondary';
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        this.player.setSleepTimer(opt.mode, opt.min);
        UI.closeModal();
      });
      wrap.appendChild(btn);
    });
    UI.openModal({ title: 'Sleep Timer', bodyEl: wrap });
  }

  openShortcutsModal() {
    UI.openModal({
      title: 'Keyboard Shortcuts',
      bodyHtml: `
        <div class="list-item-row"><span>Play / Pause</span><strong>Space</strong></div>
        <div class="list-item-row"><span>Skip Backward / Forward</span><strong>Left / Right Arrow</strong></div>
        <div class="list-item-row"><span>Previous / Next Chapter</span><strong>Shift + Left / Right</strong></div>
        <div class="list-item-row"><span>Seek from Timeline</span><strong>Focus + Arrows</strong></div>
        <div class="list-item-row"><span>Quick Bookmark</span><strong>B</strong></div>
        <div class="list-item-row"><span>New Note</span><strong>N</strong></div>
        <div class="list-item-row"><span>Toggle Full Player</span><strong>F</strong></div>
        <div class="list-item-row"><span>Mute / Unmute</span><strong>M</strong></div>
      `
    });
  }

  openGoalsModal() {
    const wrap = document.createElement('div');
    wrap.className = 'form-grid';
    wrap.innerHTML = `
      <label class="field-label">Daily Goal (minutes) <input type="number" id="g-daily" value="${this.settings.dailyGoalMin}"></label>
      <label class="field-label">Weekly Goal (minutes) <input type="number" id="g-weekly" value="${this.settings.weeklyGoalMin}"></label>
      <label class="field-label">Monthly Goal (minutes) <input type="number" id="g-monthly" value="${this.settings.monthlyGoalMin}"></label>
    `;
    UI.openModal({
      title: 'Listening Goals',
      bodyEl: wrap,
      footerButtons: [
        { label: 'Cancel', className: 'btn-secondary', onClick: () => UI.closeModal() },
        {
          label: 'Save Goals',
          className: 'btn-primary',
          onClick: async () => {
            this.settings.dailyGoalMin = Math.max(5, Number(wrap.querySelector('#g-daily').value) || 30);
            this.settings.weeklyGoalMin = Math.max(15, Number(wrap.querySelector('#g-weekly').value) || 210);
            this.settings.monthlyGoalMin = Math.max(60, Number(wrap.querySelector('#g-monthly').value) || 900);
            await this.saveSettings();
            this.renderCurrentRoute();
            UI.closeModal();
          }
        }
      ]
    });
  }

  /* ------------------------------------------------------------------------
     GLOBAL EVENT WIRING
     ------------------------------------------------------------------------ */
  _bindGlobalEvents() {
    // Route navigation
    document.querySelectorAll('[data-route]').forEach(btn => {
      btn.addEventListener('click', () => this.navigate(btn.dataset.route));
    });

    // Import triggers
    ['sidebar-import-btn', 'mobile-import-btn', 'dash-import-action', 'lib-import-btn', 'lib-empty-import-btn'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => this.openImportChooserModal());
    });
    document.getElementById('empty-import-files-btn').addEventListener('click', () => document.getElementById('file-input-audio').click());
    document.getElementById('empty-import-folder-btn').addEventListener('click', () => document.getElementById('file-input-folder').click());

    document.getElementById('file-input-audio').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) await this.importer.processFileEntries(files.map(f => ({ file: f, path: f.name })));
    });
    document.getElementById('file-input-folder').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) await this.importer.processFileEntries(files.map(f => ({ file: f, path: f.webkitRelativePath || f.name })));
    });

    // Drag & Drop import anywhere on body
    document.body.addEventListener('dragover', (e) => e.preventDefault());
    document.body.addEventListener('drop', async (e) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) await this.importer.processFileEntries(files.map(f => ({ file: f, path: f.name })));
    });

    // Quick theme toggle buttons
    const toggleLightDark = async () => {
      const isDark = document.documentElement.dataset.theme === 'dark';
      this.settings.themeMode = isDark ? 'light' : 'dark';
      this.applyTheme();
      await this.saveSettings();
      if (this.route === 'settings') this.renderSettings();
    };
    document.getElementById('sidebar-theme-toggle').addEventListener('click', toggleLightDark);
    document.getElementById('mobile-theme-btn').addEventListener('click', toggleLightDark);

    // Library filters & views (with persisted sort/view preferences)
    ['lib-search', 'lib-filter-status', 'lib-filter-collection', 'lib-filter-series', 'lib-sort'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => this.renderLibrary());
      document.getElementById(id).addEventListener('change', () => this.renderLibrary());
    });
    document.getElementById('lib-sort').addEventListener('change', async (e) => {
      this.settings.librarySort = e.target.value;
      await this.saveSettings();
    });
    document.querySelectorAll('[data-lib-view]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.libraryView = btn.dataset.libView;
        this.settings.libraryView = this.libraryView;
        await this.saveSettings();
        document.querySelectorAll('[data-lib-view]').forEach(b => b.classList.toggle('is-active', b === btn));
        this.renderLibrary();
      });
    });
    document.getElementById('lib-new-collection-btn').addEventListener('click', () => this.openCreateCollectionModal());

    // Book Detail Topbar
    document.getElementById('detail-back-btn').addEventListener('click', () => this.navigate('library'));
    document.getElementById('detail-edit-btn').addEventListener('click', () => {
      const b = this.books.find(x => x.id === this.selectedBookId);
      if (b) this.openEditBookModal(b);
    });
    document.getElementById('detail-delete-btn').addEventListener('click', () => {
      const b = this.books.find(x => x.id === this.selectedBookId);
      if (b) this.deleteBookWithConfirm(b);
    });

    // Vault
    document.getElementById('vault-new-note-btn').addEventListener('click', () => this.openNewNoteModal());
    ['vault-search', 'vault-filter-type', 'vault-filter-book', 'vault-filter-tag'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => this.renderVault());
      document.getElementById(id).addEventListener('change', () => this.renderVault());
    });

    // Stats
    document.getElementById('stats-edit-goals-btn').addEventListener('click', () => this.openGoalsModal());

    // Settings
    document.querySelectorAll('[data-theme-mode]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.settings.themeMode = btn.dataset.themeMode;
        this.applyTheme();
        await this.saveSettings();
        this.renderSettings();
      });
    });
    document.querySelectorAll('[data-palette-choice]').forEach(btn => {
      btn.addEventListener('click', async () => {
        this.settings.palette = btn.dataset.paletteChoice;
        this.applyTheme();
        await this.saveSettings();
        this.renderSettings();
      });
    });
    document.getElementById('setting-default-speed').addEventListener('change', async (e) => {
      this.settings.defaultSpeed = Number(e.target.value);
      await this.saveSettings();
    });
    document.getElementById('setting-skip-back').addEventListener('change', async (e) => {
      this.settings.skipBack = Number(e.target.value);
      await this.saveSettings();
      this.renderPlaybackUI();
    });
    document.getElementById('setting-skip-fwd').addEventListener('change', async (e) => {
      this.settings.skipFwd = Number(e.target.value);
      await this.saveSettings();
      this.renderPlaybackUI();
    });
    document.getElementById('setting-webaudio-enabled').addEventListener('change', async (e) => {
      this.settings.webAudioEnabled = e.target.checked;
      this.player.applyEQ();
      document.getElementById('fp-panel-eq').dataset.key = '';
      await this.saveSettings();
    });

    document.getElementById('btn-request-persist').addEventListener('click', async () => {
      if (!navigator.storage?.persist) return UI.toast('Persistent storage API is unavailable in this browser.', 'error');
      const granted = await navigator.storage.persist();
      UI.toast(granted ? 'Persistent storage granted.' : 'Browser kept best-effort storage policy.');
      this.renderSettings();
    });

    document.getElementById('btn-purge-audio-blobs').addEventListener('click', async () => {
      const ok = await UI.confirm({
        title: 'Remove Local Audio Copies',
        message: 'Remove locally cached audio file copies to free space? Metadata, notes, bookmarks, and playback coverage history will remain preserved.',
        confirmLabel: 'Remove Copies',
        danger: true
      });
      if (!ok) return;
      const files = await this.db.getAll('files');
      for (const f of files) {
        if (f.storageMode === 'local-copy') {
          await MediaStorage.deleteAudioCopy(f);
          f.blob = null;
          await this.db.put('files', f);
        }
      }
      this.renderSettings();
      UI.toast('Local audio copies removed.');
    });

    document.getElementById('btn-export-backup').addEventListener('click', () => this.exportBackup());
    document.getElementById('btn-restore-backup').addEventListener('click', () => document.getElementById('file-input-backup').click());
    document.getElementById('file-input-backup').addEventListener('change', (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) this.previewAndRestoreBackup(f);
    });

    document.getElementById('sidebar-shortcuts-btn').addEventListener('click', () => this.openShortcutsModal());
    document.getElementById('btn-open-shortcuts').addEventListener('click', () => this.openShortcutsModal());

    // Mini Player & Full Player
    document.getElementById('mini-expand-btn').addEventListener('click', () => {
      document.getElementById('full-player').hidden = false;
      this.renderPlaybackUI();
    });
    document.getElementById('fp-close-btn').addEventListener('click', () => {
      document.getElementById('full-player').hidden = true;
    });
    document.getElementById('fp-view-book-btn').addEventListener('click', () => {
      document.getElementById('full-player').hidden = true;
      if (this.player.book) this.navigate('book-detail', this.player.book.id);
    });

    // Mobile sheet gesture: drag the handle down to dismiss the full player.
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
    document.querySelectorAll('#fp-speed-presets .sp-btn').forEach(btn => {
      btn.addEventListener('click', () => this.player.setSpeed(Number(btn.dataset.speed)));
    });
    document.getElementById('fp-sleep-btn').addEventListener('click', () => this.openSleepTimerModal());
    document.getElementById('mini-bookmark-btn').addEventListener('click', () => this.createQuickBookmark());
    document.getElementById('fp-bookmark-btn').addEventListener('click', () => this.createQuickBookmark());
    document.getElementById('fp-note-btn').addEventListener('click', () => this.openNewNoteModal(this.player.book));

    // Volume & mute (v2)
    document.getElementById('fp-mute-btn').addEventListener('click', () => this.player.toggleMute());
    document.getElementById('fp-volume').addEventListener('input', (e) => {
      this.player.setVolume(Number(e.target.value));
      Utils.setRangeFill(e.target);
    });

    document.getElementById('fp-timeline-scope-toggle').addEventListener('click', () => {
      this.timelineScope = this.timelineScope === 'book' ? 'chapter' : 'book';
      document.getElementById('fp-timeline-scope-label').textContent = this.timelineScope === 'book' ? 'Book Timeline & Coverage' : 'Chapter Timeline & Coverage';
      document.getElementById('fp-timeline-scope-toggle').textContent = this.timelineScope === 'book' ? 'Switch to Chapter View' : 'Switch to Book View';
      this.renderPlaybackTick(true);
    });

    document.querySelectorAll('[data-fp-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        this.fullPlayerTab = tab.dataset.fpTab;
        document.querySelectorAll('[data-fp-tab]').forEach(t => {
          const active = t === tab;
          t.classList.toggle('is-active', active);
          t.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('.fp-tab-panel').forEach(p => {
          p.hidden = p.id !== `fp-panel-${this.fullPlayerTab}`;
        });
        this._renderFullPlayerToolPanel();
      });
    });

    // Modal close & Escape key + focus trap
    document.getElementById('modal-close-btn').addEventListener('click', () => UI.closeModal());
    document.getElementById('modal-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'modal-backdrop') UI.closeModal();
    });
    document.addEventListener('keydown', (e) => UI.trapFocus(e));

    // Keyboard Shortcuts (safely ignored inside inputs/textareas)
    document.addEventListener('keydown', (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;

      if (e.key === 'Escape') {
        if (!document.getElementById('modal-backdrop').hidden) UI.closeModal();
        else if (!document.getElementById('full-player').hidden) document.getElementById('full-player').hidden = true;
      } else if (e.code === 'Space' && this.player.book) {
        e.preventDefault();
        this.player.togglePlay();
      } else if (e.key === 'ArrowLeft' && this.player.book && !e.target.closest('.coverage-timeline')) {
        if (e.shiftKey) this.player.jumpChapter(-1);
        else this.player.skip(-this.settings.skipBack);
      } else if (e.key === 'ArrowRight' && this.player.book && !e.target.closest('.coverage-timeline')) {
        if (e.shiftKey) this.player.jumpChapter(1);
        else this.player.skip(this.settings.skipFwd);
      } else if (e.key.toLowerCase() === 'b' && this.player.book) {
        this.createQuickBookmark();
      } else if (e.key.toLowerCase() === 'n' && this.player.book) {
        this.openNewNoteModal(this.player.book);
      } else if (e.key.toLowerCase() === 'm' && this.player.book) {
        this.player.toggleMute();
      } else if (e.key.toLowerCase() === 'f' && this.player.book) {
        const fp = document.getElementById('full-player');
        fp.hidden = !fp.hidden;
        if (!fp.hidden) this.renderPlaybackUI();
      }
    });

    // Persist coverage & progress before browser tab suspension/unload
    const safeFlush = () => {
      this.player.saveProgress();
      this.coverage.flush(true);
    };
    window.addEventListener('pagehide', safeFlush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') safeFlush();
    });
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (this.settings.themeMode === 'system') this.applyTheme();
    });
  }

  /** Drag-to-close gesture for the full player sheet handle (mobile). */
  _bindSheetDragClose() {
    const handle = document.getElementById('fp-sheet-handle');
    const sheet = document.querySelector('#full-player .full-player-surface');
    if (!handle || !sheet) return;

    let startY = 0;
    let dragging = false;

    handle.addEventListener('pointerdown', (e) => {
      dragging = true;
      startY = e.clientY;
      try { handle.setPointerCapture?.(e.pointerId); } catch { /* synthetic event — safe to ignore */ }
      sheet.style.transition = 'none';
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = Math.max(0, e.clientY - startY);
      sheet.style.transform = `translate3d(0, ${Math.min(dy, 200)}px, 0)`;
      sheet.style.opacity = String(1 - Math.min(dy, 200) / 260);
    });
    const finish = (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = Math.max(0, e.clientY - startY);
      sheet.style.transition = '';
      sheet.style.opacity = '';
      sheet.style.transform = '';
      if (dy > 110) {
        document.getElementById('full-player').hidden = true;
      }
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const app = new CadenceApp();
  app.start().catch(err => {
    console.error(err);
    UI.toast('Failed to initialise local database. Check browser storage permissions.', 'error', 6000);
  });
});
