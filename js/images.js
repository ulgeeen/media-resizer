// 1) Toplu görsel işleme — masaüstü sürümdeki run_image_process ile aynı kurallar
import encodeWebp from '../lib/webp/encode.js';
import { ext, cleanBase, makeCanvas, canvasToBlob } from './util.js';

export const FORMATS = {
  webp: { label: 'WebP (Kayıpsız)', ext: '.webp' },
  png: { label: 'PNG (Transparan)', ext: '.png' },
  jpg: { label: 'JPG (Yüksek Kalite)', ext: '.jpg' },
};

/** Dosyayı çözüp ImageBitmap döndürür. EXIF yönü uygulanır; TIFF için UTIF kullanılır. */
export async function decodeImage(file) {
  const e = ext(file.name);
  if (e === '.tif' || e === '.tiff') {
    const buf = await file.arrayBuffer();
    const ifds = self.UTIF.decode(buf);
    if (!ifds.length) throw new Error('TIFF okunamadı');
    self.UTIF.decodeImage(buf, ifds[0]);
    const rgba = self.UTIF.toRGBA8(ifds[0]);
    const { width, height } = ifds[0];
    return createImageBitmap(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, width * height * 4), width, height));
  }
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (err) {
    if (err?.name === 'TypeError') return createImageBitmap(file);
    throw new Error('Görsel açılamadı (dosya bozuk ya da tarayıcı bu formatı desteklemiyor)');
  }
}

/**
 * Kaynağın (sx,sy,sw,sh) bölgesini dw×dh boyutuna çizer. Büyük küçültmelerde
 * yarıya yarıya inerek keskinlik ve kenar yumuşaklığı korunur.
 */
export function drawScaled(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh) {
  let cur = src;
  let cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw / 2 >= dw && ch / 2 >= dh) {
    const nw = Math.max(1, Math.round(cw / 2));
    const nh = Math.max(1, Math.round(ch / 2));
    const tmp = makeCanvas(nw, nh);
    const tctx = tmp.getContext('2d');
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
    cur = tmp;
    cx = 0; cy = 0; cw = nw; ch = nh;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(cur, cx, cy, cw, ch, dx, dy, dw, dh);
}

/** Ortalanmış "cover" kırpma bölgesi (PIL ImageOps.fit, centering 0.5). */
function coverCrop(w, h, tw, th) {
  if (w / h > tw / th) {
    const cw = (h * tw) / th;
    return [(w - cw) / 2, 0, cw, h];
  }
  const ch = (w * th) / tw;
  return [0, (h - ch) / 2, w, ch];
}

async function processOne(file, opts) {
  const bmp = await decodeImage(file);
  try {
    const W = bmp.width, H = bmp.height;
    let tw = W, th = H, crop = [0, 0, W, H];
    if (opts.mode === 'square') {
      const side = Math.min(W, H);
      tw = th = side;
      crop = coverCrop(W, H, side, side);
    } else if (opts.w && opts.h) {
      tw = opts.w; th = opts.h;
      crop = coverCrop(W, H, tw, th);
    } else if (opts.w) {
      tw = opts.w; th = Math.max(1, Math.round((H * opts.w) / W));
    } else if (opts.h) {
      th = opts.h; tw = Math.max(1, Math.round((W * opts.h) / H));
    }

    const canvas = makeCanvas(tw, th);
    const ctx = canvas.getContext('2d', { willReadFrequently: opts.format === 'webp' });
    if (!ctx) throw new Error(`Tuval oluşturulamadı (${tw}×${th} bu tarayıcı için fazla büyük olabilir)`);
    if (opts.format === 'jpg') {
      ctx.fillStyle = '#ffffff'; // JPG'de şeffaflık yok: beyaz zemine oturt
      ctx.fillRect(0, 0, tw, th);
    }
    drawScaled(ctx, bmp, ...crop, 0, 0, tw, th);

    if (opts.format === 'webp') {
      const data = ctx.getImageData(0, 0, tw, th);
      const buf = await encodeWebp(data, { lossless: 1, quality: 100, method: 4, exact: 1 });
      return { blob: new Blob([buf], { type: 'image/webp' }), w: tw, h: th };
    }
    if (opts.format === 'png') return { blob: await canvasToBlob(canvas, 'image/png'), w: tw, h: th };
    return { blob: await canvasToBlob(canvas, 'image/jpeg', 0.95), w: tw, h: th };
  } finally {
    bmp.close();
  }
}

export async function runImageProcess(files, opts, writer, log, progress) {
  const fmt = FORMATS[opts.format];
  log(`🚀 Toplam ${files.length} görsel [${fmt.label}] olarak işleniyor...\n`);
  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const tag = `[${i + 1}/${files.length}]`;
    try {
      const { blob, w, h } = await processOne(f, opts);
      const name = await writer.uniqueName(cleanBase(f.name), fmt.ext);
      await writer.write(name, blob);
      log(`✔ ${tag} ${f.name} -> ${name} (${w}×${h})\n`);
      ok += 1;
    } catch (err) {
      log(`✖ Hata (${f.name}): ${err.message || err}\n`);
    }
    progress((i + 1) / files.length);
  }
  log(`\n🎉 Tamamlandı! ${ok}/${files.length} görsel aktarıldı.\n`);
}
