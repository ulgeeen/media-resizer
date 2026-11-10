// 2) Toplu video boyutlandırma — tarayıcının donanım kodlayıcısı (WebCodecs) ile H.264 MP4
import {
  Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat,
  ALL_FORMATS, QUALITY_HIGH, canEncodeAudio,
} from '../lib/mediabunny.min.mjs';
import { ext, cleanBase, even, roundEven } from './util.js';

export const videoSupported = () => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined';

let aacOk = null;
export async function audioCodec() {
  if (aacOk === null) aacOk = await canEncodeAudio('aac');
  return aacOk ? 'aac' : 'opus';
}

export function openInput(file) {
  if (ext(file.name) === '.avi') {
    throw new Error('AVI tarayıcıda açılamıyor. MP4, MOV, MKV ya da WebM kullanın.');
  }
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

/** Hedef ölçüyü hesaplar. Masaüstü sürümle aynı: ikisi doluysa cover crop, biri doluysa orantılı. */
function targetSize(sw, sh, tw, th) {
  if (tw && th) return [even(tw), even(th)];
  if (tw) return [even(tw), roundEven((sh * even(tw)) / sw)];
  if (th) return [roundEven((sw * even(th)) / sh), even(th)];
  return [sw - (sw % 2), sh - (sh % 2)];
}

async function resizeOne(file, tw, th, onProgress) {
  const input = openInput(file);
  try {
    const vt = await input.getPrimaryVideoTrack();
    if (!vt) throw new Error('Dosyada video izi yok');
    const [w, h] = targetSize(vt.displayWidth, vt.displayHeight, tw, th);

    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    const ac = await audioCodec();
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        width: w, height: h, fit: 'cover',
        codec: 'avc', bitrate: QUALITY_HIGH, forceTranscode: true,
        allowTransformationMetadata: false, // döndürmeyi görüntüye işle; çıktı tam w×h olsun
      },
      audio: { codec: ac, bitrate: 192_000 },
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const why = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(', ');
      throw new Error(`Dönüştürülemedi (${why || 'desteklenmeyen format'})`);
    }
    conversion.onProgress = (p) => onProgress(p);
    await conversion.execute();
    return { blob: new Blob([output.target.buffer], { type: 'video/mp4' }), w, h };
  } finally {
    input.dispose?.();
  }
}

export async function runVideoProcess(files, opts, writer, log, progress) {
  let desc = 'orijinal boyut';
  if (opts.w && opts.h) desc = `${even(opts.w)}×${even(opts.h)} cover crop`;
  else if (opts.w) desc = `genişlik ${even(opts.w)} px, orantılı`;
  else if (opts.h) desc = `yükseklik ${even(opts.h)} px, orantılı`;
  log(`🚀 Toplam ${files.length} video boyutlandırılıyor (${desc})...\n`);
  if ((await audioCodec()) !== 'aac') {
    log('⚠ Bu tarayıcı AAC ses kodlayamıyor; ses Opus olarak kaydedilecek. En iyi sonuç için Chrome ya da Edge kullanın.\n');
  }

  let ok = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const tag = `[${i + 1}/${files.length}]`;
    log(`… ${tag} ${f.name} işleniyor\n`);
    try {
      const t0 = performance.now();
      const { blob, w, h } = await resizeOne(f, opts.w, opts.h, (p) => progress((i + p) / files.length));
      const name = await writer.uniqueName(cleanBase(f.name), '.mp4');
      await writer.write(name, blob);
      log(`✔ ${tag} ${f.name} -> ${name} (${w}×${h}, ${((performance.now() - t0) / 1000).toFixed(1)} sn)\n`);
      ok += 1;
    } catch (err) {
      log(`✖ Video hatası (${f.name}): ${err.message || err}\n`);
    }
    progress((i + 1) / files.length);
  }
  log(`\n🎉 Tamamlandı! ${ok}/${files.length} video dışa aktarıldı.\n`);
}
