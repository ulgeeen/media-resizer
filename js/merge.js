// 3) Video + görsel birleştirme — masaüstü sürümdeki run_merge_pipeline ile aynı kurallar:
// önce videolar (isim sırasıyla), sonra görseller; çözünürlük en küçük görsel (yoksa en küçük video);
// kırpma/esnetme yok, oranı farklı medyaya siyah bant; 30 fps; sessiz parçalara boş ses.
import {
  Output, BufferTarget, Mp4OutputFormat, CanvasSource, AudioBufferSource,
  CanvasSink, AudioBufferSink, QUALITY_HIGH,
} from '../lib/mediabunny.min.mjs';
import { even, makeCanvas } from './util.js';
import { decodeImage, drawScaled } from './images.js';
import { openInput, audioCodec } from './videos.js';

const FPS = 30;
const SAMPLE_RATE = 48000;

/** En küçük görselin (alan olarak) boyutu; görsel yoksa en küçük videonun. Çift sayıya yuvarlanır. */
export async function findSmallestDimensions(images, videos) {
  let best = null;
  for (const f of images) {
    try {
      const bmp = await decodeImage(f);
      const area = bmp.width * bmp.height;
      if (!best || area < best.area) best = { w: bmp.width, h: bmp.height, area, file: f };
      bmp.close();
    } catch { /* okunamayan dosyayı atla */ }
  }
  if (!best) {
    for (const f of videos) {
      let input;
      try {
        input = openInput(f);
        const vt = await input.getPrimaryVideoTrack();
        if (!vt) continue;
        const area = vt.displayWidth * vt.displayHeight;
        if (!best || area < best.area) best = { w: vt.displayWidth, h: vt.displayHeight, area, file: f };
      } catch { /* atla */ } finally {
        input?.dispose?.();
      }
    }
  }
  if (!best) return null;
  return { w: even(best.w, true), h: even(best.h, true), file: best.file };
}

function drawContain(ctx, src, sw, sh, tw, th) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, tw, th);
  const s = Math.min(tw / sw, th / sh);
  const dw = Math.max(1, Math.round(sw * s));
  const dh = Math.max(1, Math.round(sh * s));
  drawScaled(ctx, src, 0, 0, sw, sh, Math.floor((tw - dw) / 2), Math.floor((th - dh) / 2), dw, dh);
}

function silence(seconds) {
  return new AudioBuffer({ length: Math.max(1, Math.round(seconds * SAMPLE_RATE)), numberOfChannels: 2, sampleRate: SAMPLE_RATE });
}

export async function runMerge(images, videos, opts, writer, log, progress) {
  if (!videos.length && !images.length) {
    log('✖ Hata: Birleştirilecek video veya görsel bulunamadı!\n');
    return;
  }
  const dims = await findSmallestDimensions(images, videos);
  if (!dims) {
    log('✖ Hata: Medya boyutları okunamadı.\n');
    return;
  }
  const { w: tw, h: th } = dims;
  const ac = await audioCodec();
  log(`🎯 Referans en küçük medya: '${dims.file.name}'\n`);
  log(`📏 Hedef video çözünürlüğü: ${tw}×${th} (kırpma yok, esnetme yok, siyah bantla sığdırma)\n`);
  log(`📦 Bulunan: ${videos.length} video | ${images.length} görsel\n`);
  if (ac !== 'aac') log('⚠ Bu tarayıcı AAC ses kodlayamıyor; ses Opus olarak kaydedilecek.\n');
  log('-'.repeat(65) + '\n');

  const canvas = makeCanvas(tw, th);
  const ctx = canvas.getContext('2d');
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const vsrc = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  const asrc = new AudioBufferSource({ codec: ac, bitrate: 192_000 });
  output.addVideoTrack(vsrc, { frameRate: FPS });
  output.addAudioTrack(asrc);
  await output.start();

  const total = videos.length + images.length;
  let done = 0;
  let frameIdx = 0; // toplam kare sayacı; zaman = frameIdx / FPS
  let clips = 0;

  if (videos.length) log('🎬 1. Aşama: Videolar orantılı sığdırılıyor...\n');
  for (const f of videos) {
    let input;
    let k = 0; // bu parçadan eklenen kare sayısı
    try {
      input = openInput(f);
      const vt = await input.getPrimaryVideoTrack();
      if (!vt) throw new Error('video izi yok');
      if (!(await vt.canDecode())) throw new Error('bu tarayıcı videonun kodeğini çözemiyor');
      const at = await input.getPrimaryAudioTrack();
      const start = await input.getFirstTimestamp([vt]);
      const end = await input.computeDuration([vt]);
      const n = Math.max(1, Math.round((end - start) * FPS));
      const seconds = n / FPS;

      // Ses: parçanın süresi kadar 48 kHz stereo tampona yerleştir (yoksa sessizlik)
      let audio = silence(seconds);
      if (at && (await at.canDecode())) {
        const octx = new OfflineAudioContext(2, audio.length, SAMPLE_RATE);
        for await (const { buffer, timestamp } of new AudioBufferSink(at).buffers()) {
          const off = timestamp - start;
          if (off >= seconds) break;
          const node = octx.createBufferSource();
          node.buffer = buffer;
          node.connect(octx.destination);
          if (off < 0) node.start(0, -off); else node.start(off);
        }
        audio = await octx.startRendering();
      }

      // Görüntü: 30 fps'e örnekle, siyah zemine ortala
      const sink = new CanvasSink(vt, { poolSize: 2 });
      const stamps = Array.from({ length: n }, (_, i) => start + i / FPS);
      for await (const wc of sink.canvasesAtTimestamps(stamps)) {
        if (wc) drawContain(ctx, wc.canvas, wc.canvas.width, wc.canvas.height, tw, th);
        await vsrc.add((frameIdx + k) / FPS, 1 / FPS);
        k += 1;
        if (k % 15 === 0) progress((done + k / n) / total);
      }
      // Kod çözücü eksik kare döndürdüyse son kareyi tekrarla; ses ile görüntü aynı sürede kalsın
      for (; k < n; k++) await vsrc.add((frameIdx + k) / FPS, 1 / FPS);
      await asrc.add(audio);
      frameIdx += n;
      clips += 1;
      log(`  ✔ Video hazırlandı [${clips}]: ${f.name} (${seconds.toFixed(2)} sn)\n`);
    } catch (err) {
      log(`  ✖ Hata (${f.name}): ${err.message || err}\n`);
      if (k > 0) { // yarıda kalan parça: zaman çizelgesi kaymasın diye sesi de aynı süreye tamamla
        await asrc.add(silence(k / FPS));
        frameIdx += k;
      }
    } finally {
      input?.dispose?.();
    }
    done += 1;
    progress(done / total);
  }

  if (images.length) log(`\n🖼️ 2. Aşama: Görseller ${opts.duration} saniyelik kliplere dönüştürülüyor...\n`);
  for (const f of images) {
    try {
      const bmp = await decodeImage(f);
      drawContain(ctx, bmp, bmp.width, bmp.height, tw, th);
      bmp.close();
      const n = Math.max(1, Math.round(opts.duration * FPS));
      for (let k = 0; k < n; k++) await vsrc.add((frameIdx + k) / FPS, 1 / FPS);
      await asrc.add(silence(n / FPS));
      frameIdx += n;
      clips += 1;
      log(`  ✔ Görsel eklendi [${clips}]: ${f.name} (${opts.duration} sn)\n`);
    } catch (err) {
      log(`  ✖ Hata (${f.name}): ${err.message || err}\n`);
    }
    done += 1;
    progress(done / total);
  }

  if (!clips) {
    await output.cancel();
    log('\n✖ Birleştirilecek geçerli klip oluşmadı.\n');
    return;
  }

  log('\n🔗 3. Aşama: Dosya tamamlanıyor...\n');
  await output.finalize();
  const blob = new Blob([output.target.buffer], { type: 'video/mp4' });
  const base = opts.filename.replace(/\.mp4$/i, '');
  const name = await writer.uniqueName(base, '.mp4');
  await writer.write(name, blob);
  log('\n' + '='.repeat(65) + '\n');
  log(`🎉 TEK VİDEO BAŞARIYLA OLUŞTURULDU: ${name}\n`);
  log(`   ${tw}×${th}, ${(frameIdx / FPS).toFixed(2)} sn\n`);
  log('='.repeat(65) + '\n');
}
