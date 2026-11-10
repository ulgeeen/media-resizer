// Arayüz: kaynak/hedef seçimi, sekmeler, başlatma ve log
import { IMG_EXTS, VID_EXTS, ext, naturalCompare, formatBytes, OutputWriter } from './util.js';
import { runImageProcess } from './images.js';
import { runVideoProcess, videoSupported } from './videos.js';
import { runMerge, findSmallestDimensions } from './merge.js';

const $ = (id) => document.getElementById(id);
const state = { files: [], sourceName: '', outDir: null, busy: false, tab: 'img' };
const canPickDir = typeof window.showDirectoryPicker === 'function';

// ---------- Log ve ilerleme ----------
const logEl = $('log');
function log(text) {
  logEl.textContent += text;
  logEl.scrollTop = logEl.scrollHeight;
}
function clearLog() { logEl.textContent = ''; }
function progress(p) { $('bar').style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`; }

// ---------- Kaynak ----------
const images = () => state.files.filter((f) => IMG_EXTS.has(ext(f.name)));
const videos = () => state.files.filter((f) => VID_EXTS.has(ext(f.name)));

function setSource(files, name) {
  state.files = files
    .filter((f) => IMG_EXTS.has(ext(f.name)) || VID_EXTS.has(ext(f.name)))
    .sort((a, b) => naturalCompare(a.name, b.name));
  state.sourceName = name;
  const nI = images().length, nV = videos().length;
  const size = state.files.reduce((s, f) => s + f.size, 0);
  $('srcInfo').textContent = state.files.length
    ? `${name} — ${nI} görsel, ${nV} video (${formatBytes(size)})`
    : `${name} — uygun dosya bulunamadı`;
  $('drop').classList.toggle('has', state.files.length > 0);
  if (state.tab === 'merge' && state.files.length) analyze();
}

// Klasör seçiminde yalnızca ilk seviyedeki dosyalar alınır (masaüstü sürümdeki gibi alt klasörler hariç)
$('pickDir').addEventListener('change', (e) => {
  const all = [...e.target.files];
  const top = all.filter((f) => (f.webkitRelativePath || f.name).split('/').length <= 2);
  const folder = all[0]?.webkitRelativePath?.split('/')[0] || 'Klasör';
  setSource(top, `📁 ${folder}`);
  e.target.value = '';
});
$('pickFiles').addEventListener('change', (e) => {
  setSource([...e.target.files], `${e.target.files.length} dosya`);
  e.target.value = '';
});

const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('over')));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  const items = [...(e.dataTransfer.items || [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  const dirs = items.filter((it) => it.isDirectory);
  if (dirs.length === 1 && items.length === 1) {
    const entries = await readAllEntries(dirs[0].createReader());
    const files = await Promise.all(entries.filter((en) => en.isFile).map((en) => new Promise((res, rej) => en.file(res, rej))));
    setSource(files, `📁 ${dirs[0].name}`);
  } else {
    const files = [...e.dataTransfer.files];
    setSource(files, `${files.length} dosya`);
  }
});
async function readAllEntries(reader) {
  const out = [];
  for (;;) {
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) return out;
    out.push(...batch);
  }
}

// ---------- Hedef ----------
if (canPickDir) {
  $('outInfo').textContent = 'Klasör seçilmedi — sonuçlar zip olarak indirilecek';
  $('pickOut').addEventListener('click', async () => {
    try {
      state.outDir = await window.showDirectoryPicker({ id: 'media-resizer-out', mode: 'readwrite' });
      $('outInfo').textContent = `📁 ${state.outDir.name} — dosyalar doğrudan bu klasöre kaydedilecek`;
      $('outInfo').classList.add('has');
    } catch { /* kullanıcı vazgeçti */ }
  });
} else {
  $('pickOut').hidden = true;
  $('outInfo').textContent = 'Bu tarayıcı klasöre yazamıyor — sonuçlar zip olarak indirilecek (Chrome/Edge klasöre doğrudan kaydeder)';
}

// ---------- Sekmeler ----------
const START_LABELS = { img: 'İŞLEMİ BAŞLAT', vid: 'İŞLEMİ BAŞLAT', merge: 'BİRLEŞTİRMEYİ BAŞLAT' };
document.querySelectorAll('[role="tab"]').forEach((btn) => {
  btn.addEventListener('click', () => selectTab(btn.dataset.tab));
});
function selectTab(tab) {
  state.tab = tab;
  document.querySelectorAll('[role="tab"]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[role="tabpanel"]').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
  if (!state.busy) $('start').textContent = START_LABELS[tab];
  if (tab === 'merge' && state.files.length) analyze();
}

// Görsel modu: özel ölçü alanlarını aç/kapat
document.querySelectorAll('input[name="imgMode"]').forEach((r) => r.addEventListener('change', syncImgInputs));
function syncImgInputs() {
  const custom = document.querySelector('input[name="imgMode"]:checked').value === 'custom';
  $('imgW').disabled = !custom;
  $('imgH').disabled = !custom;
}
syncImgInputs();

if (!videoSupported()) {
  $('vidWarn').hidden = false;
  $('mergeWarn').hidden = false;
}

// ---------- Birleştirme analizi ----------
$('analyze').addEventListener('click', () => {
  if (!state.files.length) return alert('Lütfen önce bir Kaynak (IMPORT) klasörü seçin!');
  analyze();
});
async function analyze() {
  if (state.busy) return;
  clearLog();
  const imgs = images(), vids = videos();
  log(`📂 Klasör analizi: ${state.sourceName}\n`);
  log(`  • ${vids.length} video tespit edildi.\n`);
  log(`  • ${imgs.length} görsel tespit edildi.\n`);
  const d = await findSmallestDimensions(imgs, vids);
  if (d) {
    log(`  • En küçük medya: '${d.file.name}' -> ${d.w}×${d.h} px\n`);
    log(`  • Nihai video çözünürlüğü ${d.w}×${d.h} olacak.\n\n`);
  } else {
    log('  ⚠ Klasörde işlenebilecek medya bulunamadı!\n\n');
  }
}

// ---------- Başlat ----------
const readInt = (id) => {
  const v = parseInt($(id).value.trim(), 10);
  return Number.isFinite(v) && v > 0 ? v : null;
};

$('start').addEventListener('click', async () => {
  if (state.busy) return;
  if (!state.files.length) return alert('Lütfen geçerli bir Kaynak (IMPORT) klasörü seçin!');
  const tab = state.tab;
  if (tab !== 'img' && !videoSupported()) return alert('Bu tarayıcı video işleyemiyor. Chrome, Edge ya da güncel Safari kullanın.');

  let job, zipName;
  const writer = new OutputWriter(state.outDir);
  if (tab === 'img') {
    const files = images();
    if (!files.length) return alert('Kaynakta görsel bulunamadı!');
    const opts = {
      mode: document.querySelector('input[name="imgMode"]:checked').value,
      format: $('imgFormat').value,
      w: readInt('imgW'),
      h: readInt('imgH'),
    };
    zipName = 'gorseller.zip';
    job = () => runImageProcess(files, opts, writer, log, progress);
  } else if (tab === 'vid') {
    const files = videos();
    if (!files.length) return alert('Kaynakta video bulunamadı!');
    zipName = 'videolar.zip';
    job = () => runVideoProcess(files, { w: readInt('vidW'), h: readInt('vidH') }, writer, log, progress);
  } else {
    let filename = $('mergeName').value.trim() || 'birlestirilmis_video.mp4';
    if (!/\.mp4$/i.test(filename)) filename += '.mp4';
    let duration = parseFloat($('mergeDur').value.replace(',', '.'));
    if (!(duration > 0)) duration = 3.0;
    zipName = 'birlestirme.zip';
    job = () => runMerge(images(), videos(), { filename, duration }, writer, log, progress);
  }

  state.busy = true;
  document.body.classList.add('busy');
  $('start').disabled = true;
  $('start').textContent = 'İşleniyor, lütfen bekleyin... (sekmeyi kapatmayın)';
  clearLog();
  progress(0);
  try {
    await job();
    const downloaded = await writer.finish(zipName);
    if (downloaded) log(`\n⬇ İndirildi: ${downloaded}\n`);
    else if (state.outDir) log(`\n📁 Kaydedildi: ${state.outDir.name}\n`);
  } catch (err) {
    log(`\n✖ Beklenmeyen hata: ${err.message || err}\n`);
    console.error(err);
  } finally {
    state.busy = false;
    document.body.classList.remove('busy');
    $('start').disabled = false;
    $('start').textContent = START_LABELS[state.tab];
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.busy) e.preventDefault();
});

log('Hazır. Kaynak klasörü seçip işlemi başlatabilirsiniz.\n');
