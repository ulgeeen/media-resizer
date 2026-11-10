# Media Resizer (web)

Toplu görsel ve video boyutlandırma, video + görsel birleştirme. Tamamen tarayıcıda çalışır:
dosyalar hiçbir sunucuya yüklenmez. Kurulum gerekmez; Windows ve Mac'te aynı şekilde çalışır.

## Özellikler
- **Görsel Boyutlandırma:** WebP (kayıpsız) / PNG / JPG (%95). Kısa kenara göre kare kırpma ya da
  özel ölçü (ikisi doluysa ortalanmış cover crop, biri doluysa orantılı). JPG/PNG/WebP/BMP/TIFF girişi.
- **Video Boyutlandırma:** Cover crop ya da orantılı küçültme, H.264 + AAC MP4. MP4/MOV/MKV/WebM girişi
  (AVI tarayıcıda açılamaz).
- **Video + Görsel Birleştirme:** Önce videolar, sonra görseller (isim sırasıyla). Çözünürlük en küçük
  görselin boyutu; kırpma/esnetme yok, siyah bant. 30 fps.
- Çıktı adlarındaki boşluklar silinir. Hedef klasördeki dosyaların üzerine yazılmaz (`_2`, `_3` eklenir).

## Tarayıcı
Chrome ve Edge önerilir: çıktıları doğrudan seçilen klasöre yazar. Safari ve Firefox'ta sonuçlar zip
olarak iner. Firefox'ta ses AAC yerine Opus olabilir.

## Yayına alma (GitHub Pages, ücretsiz)
1. Bu klasörün içeriğini bir GitHub reposuna yükleyin (ücretsiz hesapta repo **public** olmalı).
2. Repo → Settings → Pages → Source: "Deploy from a branch", Branch: `main`, klasör: `/ (root)`.
3. Birkaç dakika sonra site `https://<kullanıcı-adı>.github.io/<repo-adı>/` adresinde açılır.

## Yerelde çalıştırma
`file://` ile açılmaz (modüller ve WebAssembly bir sunucu ister):

```
python -m http.server 8765
```

ardından http://localhost:8765

## Kullanılan kütüphaneler (`lib/`, lisansları yanında)
- [Mediabunny](https://mediabunny.dev) 1.63.0 — video okuma/yazma (WebCodecs), MPL-2.0
- [jSquash WebP](https://github.com/jamsinclair/jSquash) 1.5.0 — kayıpsız WebP kodlayıcı, Apache-2.0
- [UTIF.js](https://github.com/photopea/UTIF.js) 4.1.0 — TIFF okuma, MIT
- [pako](https://github.com/nodeca/pako) 2.1.0 (inflate) — sıkıştırılmış TIFF için, MIT
