// Ortak yardımcılar: dosya adları, sıralama, tuval ve çıktı yazımı
import { makeZip } from './zip.js';

export const IMG_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tiff', '.tif']);
export const VID_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);

export const ext = (name) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
};
const stem = (name) => {
  const i = name.lastIndexOf('.');
  return i < 0 ? name : name.slice(0, i);
};
/** Dosya adından uzantıyı ve boşlukları siler ("yatay video.mp4" -> "yatayvideo"). */
export const cleanBase = (name) => stem(name).replace(/\s+/g, '') || 'dosya';

/** 1, 2, 10 sıralaması (alfabetik 1, 10, 2 yerine). */
export const naturalCompare = (a, b) =>
  a.localeCompare(b, 'tr', { numeric: true, sensitivity: 'base' });

export const even = (v, down = false) => (v % 2 === 0 ? v : down ? v - 1 : v + 1);
export const roundEven = (v) => Math.max(2, 2 * Math.round(v / 2));

export function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Görsel kodlanamadı'))), type, quality));
}

export function formatBytes(n) {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Çıktıları seçilen klasöre yazar (Chrome/Edge). Klasör seçilmediyse
 * hepsini toplayıp işlem sonunda tek dosya ya da zip olarak indirir.
 * Hedef klasörde zaten olan bir dosyanın üzerine asla yazmaz: "_2", "_3" ekler.
 */
export class OutputWriter {
  constructor(dirHandle) {
    this.dir = dirHandle || null;
    this.entries = [];
    this.used = new Set();
  }

  async exists(name) {
    if (!this.dir) return false;
    try {
      await this.dir.getFileHandle(name);
      return true;
    } catch {
      return false;
    }
  }

  async uniqueName(base, extension) {
    let name = `${base}${extension}`;
    let n = 2;
    while (this.used.has(name.toLowerCase()) || (await this.exists(name))) {
      name = `${base}_${n}${extension}`;
      n += 1;
    }
    this.used.add(name.toLowerCase());
    return name;
  }

  async write(name, blob) {
    if (this.dir) {
      const fh = await this.dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      this.entries.push({ name, blob });
    }
  }

  /** Klasör seçilmediyse indirmeyi başlatır; indirilen dosyanın adını döndürür. */
  async finish(zipName) {
    if (this.dir || this.entries.length === 0) return null;
    if (this.entries.length === 1) {
      downloadBlob(this.entries[0].blob, this.entries[0].name);
      return this.entries[0].name;
    }
    downloadBlob(await makeZip(this.entries), zipName);
    return zipName;
  }
}
