# Fondasi Material Design 3

Rangkuman dari bagian Styles dan Foundations di m3.material.io. Halaman sumber disebut di tiap bagian.

## Warna
Sumber: `/styles/color/system`, `/styles/color/roles`

### Cara kerja
- Satu **warna sumber** menghasilkan lima warna kunci: primary, secondary, tertiary, neutral, neutral variant.
- Tiap warna kunci menjadi **palet tonal** (tone 0 = hitam sampai 100 = putih).
- Tone dari palet dipetakan ke **26 peran warna** untuk tema terang dan gelap sekaligus. Contoh pada tema terang: `primary` = tone 40, `on-primary` = tone 100.
- Ruang warnanya HCT (hue, chroma, tone). Tone menentukan kontras, sehingga nilai HSL tidak bisa dipakai sebagai pengganti.
- Tiga tingkat kontras: standar, medium (minimal 3:1), tinggi (7:1). Komponen buatan sendiri ikut mendukungnya asal memakai peran warna.

### Peran dan pemakaiannya

| Peran | Dipakai untuk |
|---|---|
| `primary` / `on-primary` | Isi, teks, dan ikon beremphasis tinggi di atas surface: tombol filled, state aktif |
| `primary-container` / `on-primary-container` | Isi menonjol untuk komponen kunci seperti FAB |
| `secondary` / `on-secondary` | Elemen yang kurang menonjol |
| `secondary-container` / `on-secondary-container` | Komponen resesif: tombol tonal, filter chip terpilih, indikator navigasi aktif |
| `tertiary` (+ container, on-) | Aksen pengimbang; perhatian khusus pada elemen kecil seperti badge |
| `error` (+ container, on-) | Keadaan salah. Warna ini statis dan tidak ikut warna dinamis |
| `surface` | Latar halaman |
| `surface-container-lowest` sampai `-highest` | Area dan komponen di atas surface, lima tingkat emphasis |
| `on-surface` | Teks dan ikon utama di atas surface mana pun |
| `on-surface-variant` | Teks dan ikon beremphasis lebih rendah |
| `inverse-surface`, `inverse-on-surface`, `inverse-primary` | Komponen berkontras terbalik, misalnya snackbar |
| `outline` | Batas penting, misalnya garis text field |
| `outline-variant` | Divider dan batas dekoratif, batas card |
| `surface-dim`, `surface-bright` | Tambahan: surface tergelap dan tercerah yang menjaga urutan kecerahan di kedua tema |
| `*-fixed`, `*-fixed-dim`, `on-*-fixed` | Tambahan: tone sama di tema terang dan gelap. Rawan masalah kontras |

Kosakata: **container** = warna isi, tidak untuk teks atau ikon; **on** = teks dan ikon di atas warna pasangannya; **variant** = versi beremphasis lebih rendah.

### Pemetaan surface bawaan
- Latar: `surface`. Area navigasi: `surface-container`.
- Pemetaan warna per wilayah layout tetap sama di semua breakpoint.
- Card elevated: `surface-container-low`. Card filled: `surface-container-highest`. Card outlined: `surface` + `outline-variant`.
- Text field filled: `surface-container-highest`.

### Jangan
- Memakai `outline` untuk divider atau untuk batas komponen berisi banyak elemen (card).
- Memakai `outline-variant` sebagai satu-satunya penanda batas target interaktif, kecuali isi target sudah berkontras 4,5:1.
- Memasangkan peran di luar pasangannya (misalnya `primary-container` sebagai teks di atas `primary`).

## Tipografi
Sumber: `/styles/typography/type-scale-tokens`, `/styles/typography/applying-type`

- Satu skala, 15 gaya baseline dan 15 gaya emphasized, dari display large sampai label small. Skala mengikuti rasio major second (1,125) dengan dasar 14.
- **Display:** teks terbesar, pendek, paling cocok di layar besar. Boleh font ekspresif.
- **Headline:** teks pendek beremphasis tinggi; penanda bagian utama.
- **Title:** emphasis sedang, tetap pendek; judul card, app bar, bagian sekunder.
- **Body:** bacaan panjang. Font harus terbaca di ukuran kecil.
- **Label:** teks dalam komponen dan keterangan kecil. Tombol memakai label large.
- **Emphasized:** berat lebih tinggi; untuk state terpilih, pesan belum dibaca, aksi utama, headline. Komponen tidak memakainya secara bawaan.
- Di web, line-height sama dengan tinggi kotak teks dan teks berada di tengah vertikal (half-leading). Atur jarak dengan padding dan gap, bukan dengan baseline.
- Warna teks bawaan `on-surface`; alternatif `on-surface-variant`.
- Konversi: sp ÷ 16 = rem. Letter-spacing = tracking px ÷ ukuran huruf.
- Saat teks diperbesar pengguna sampai 200%, spasi tetap.

## Bentuk
Sumber: `/styles/shape/corner-radius-scale`

| Token | Radius | Contoh komponen |
|---|---|---|
| none | 0 | Dialog layar penuh |
| extra-small | 4px | Menu, snackbar, tooltip, sudut atas text field |
| small | 8px | Chip |
| medium | 12px | Card |
| large | 16px | Sudut navigation drawer, FAB |
| large-increased | 20px | |
| extra-large | 28px | Dialog, item carousel, bottom sheet |
| extra-large-increased | 32px | |
| extra-extra-large | 48px | |
| full | penuh | Tombol, search bar, badge |

- Radius gaya boleh diubah untuk seluruh situs, atau satu komponen dipetakan ke gaya lain (misalnya tombol dari full ke small).
- Sudut asimetris dipakai pada item yang dikelompokkan rapat (menu, split button).
- M3 Expressive: tombol berubah bentuk saat ditekan (lebih kotak), dan toggle button berganti bentuk saat terpilih.
- Pustaka 35 bentuk dekoratif: hanya untuk elemen visual, hemat, tidak untuk container teks.

## Elevasi
Sumber: `/styles/elevation/applying-elevation`, `/styles/elevation/tokens`

| Level | Tinggi | Komponen pada keadaan diam |
|---|---|---|
| 0 | 0 | App bar (belum digulir), tombol filled/tonal/outlined, card filled/outlined, chip, list, navigation rail, tabs |
| 1 | 1dp | Tombol elevated, card elevated, chip elevated, bottom sheet modal, navigation drawer modal, side sheet modal |
| 2 | 3dp | App bar (digulir), menu, navigation bar, rich tooltip, toolbar |
| 3 | 6dp | Dialog, FAB, search, date dan time picker |
| 4 | 8dp | Tidak untuk keadaan diam |
| 5 | 12dp | Tidak untuk keadaan diam |

Elevasi ditunjukkan dengan tiga cara: beda tone, bayangan, atau scrim. Makin sedikit level yang dipakai, makin kuat tiap level mengarahkan perhatian.

## Motion
Sumber: `/styles/motion/overview/specs`, `/styles/motion/easing-and-duration`

- Sistem baru (M3 Expressive) memakai spring. Dua skema: **expressive** (ada pantulan) dan **standard**. Tiap skema punya kecepatan fast, default, slow untuk **spatial** dan **effects**.
- Di web, pakai kurva pengganti di `tokens.css`. Kurva expressive spatial melewati nilai akhir (overshoot); jangan dipakai untuk opasitas atau warna.
- Sistem lama (easing dan durasi) masih dipakai untuk transisi dan tidak lagi dikembangkan.

| Jenis transisi | Easing | Durasi |
|---|---|---|
| Mulai dan berakhir di layar | Standard | 300ms |
| Masuk layar | Standard decelerate / emphasized decelerate | 250ms / 400ms |
| Keluar layar | Standard accelerate / emphasized accelerate | 200ms |

- Kontrol pilihan kecil: sekitar 200ms. Area besar (card menjadi layar penuh): sekitar 500ms.

## Layout
Sumber: `/foundations/layout/breakpoints`, `/grids-spacing`, `/scaffold`, `/canonical-examples`

### Breakpoint

| Breakpoint | Lebar | Pane | Navigasi | Aksi tambahan |
|---|---|---|---|---|
| Compact | < 600 | 1 | Navigation bar, atau rail modal | Bottom sheet |
| Medium | 600–839 | 1 (boleh 2 untuk konten ringan) | Navigation bar atau rail tertutup | Menu |
| Expanded | 840–1199 | 2 | Rail tertutup atau terbuka | Menu |
| Large | 1200–1599 | 2 | Rail terbuka | Menu |
| Extra-large | ≥ 1600 | 2, sampai 3 | Rail terbuka | Menu |

Rancang untuk breakpoint, bukan perangkat. Media query: `600px`, `840px`, `1200px`, `1600px`.

### Lima pertanyaan saat pindah breakpoint
1. Apa yang **ditampilkan** (yang tadinya tersembunyi)?
2. Bagaimana layar **dibagi** menjadi pane?
3. Apa yang **diubah ukurannya** (card, feed, list)? Jaga 40–60 karakter per baris.
4. Apa yang **dipindahkan** (aksi dari bawah ke tepi depan, kolom kedua)?
5. Apa yang **ditukar** dengan komponen setara (navigation bar menjadi rail, bottom sheet menjadi menu)?

### Scaffold
- **Bar** membingkai halaman (app bar, navigation bar). **Rail** adalah ruang tepi untuk navigasi dan toolbar. **Pane** memuat konten.
- Pane **fixed** (lebar tetap; disarankan 360 atau 412px) atau **flexible**. Minimal satu fleksibel.
- Dua pane: split (50/50) atau fixed-dan-flexible.
- Pane beradaptasi dengan tiga cara: tampil/sembunyi, melayang (levitate), atau reflow.
- Urutan mengisi layout: kolom grid, lalu bar dan rail di tepi, lalu pane.

### Layout kanonik
- **Feed:** grid card untuk menelusuri banyak konten. Cocok untuk beranda, arsip, kategori.
- **List-detail:** daftar di satu pane, rincian di pane sebelah. Pada compact menjadi dua halaman.
- **Supporting pane:** konten utama sekitar dua pertiga lebar, konten pendukung sisanya. Cocok untuk artikel dengan sidebar.

### Spasi dan kepadatan
- Dasar 8px. Nilai kecil yang dipakai: 2, 4, 6, 10, 12.
- Tiga jenis: padding (dalam elemen), gap (antar-elemen), margin (luar elemen). Padding dan gap didahulukan.
- Elemen yang berhubungan didekatkan; antar-kelompok diberi ruang lebih. Kelompok eksplisit memakai garis, divider, atau container; kelompok implisit memakai kedekatan.
- Elemen sejenis memakai spasi dan ukuran yang sama; elemen depan (thumbnail, avatar, ikon) selalu sejajar.
- Tombol diletakkan dekat konten yang dipengaruhinya.
- Ruang kosong yang lapang menegaskan konten terpenting.
- Kepadatan lebih tinggi (mengurangi padding atas-bawah 4px per langkah) hanya untuk tampilan data, tidak untuk dialog, snackbar, atau menu, dan tidak sampai target di bawah 48px.

## State
Sumber: `/foundations/interaction/states`

- State layer berwarna sama dengan konten dan berada di antara container dan konten.
- Hover 8%, focus 10%, pressed 10%, dragged 16%.
- State layer ikon berukuran 40px; target interaktifnya 48px.

## Aksesibilitas
Sumber: `/foundations/designing`

- Teks kecil 4,5:1. Teks besar (18pt biasa atau 14pt tebal ke atas) dan grafik 3:1.
- Komponen yang berkelompok (misalnya deretan tombol): container 3:1 terhadap latar. Komponen yang berdiri sendiri dan menonjol (FAB) tidak wajib.
- Landmark ARIA: navigation, search, main (satu), banner (satu), complementary, contentinfo (satu), region, form.
- Heading mengikuti hierarki konten, bukan tampilan; tidak melompati level; satu `h1`.
- Urutan HTML menentukan urutan baca pembaca layar.
- Label aksesibilitas wajib untuk: tombol ikon, gambar interaktif, progress dan pesan error, ikon status, gambar bermakna, tautan generik ("Selengkapnya").
- Label menjelaskan tujuan ("Cari"), bukan gambar ("kaca pembesar"), dan tidak menyebut peran ("tombol").
- Pakai elemen asli platform; komponen buatan sendiri butuh pengujian tambahan.

## Penulisan UI
Sumber: `/foundations/content-design/style-guide`

- Sentence case untuk semua teks UI; nama produk tetap berhuruf kapital.
- Jelaskan akibat suatu aksi dengan bahasa netral dan langsung, termasuk cara membatalkannya. Jangan menakut-nakuti atau memengaruhi keputusan.
- Judul dan heading spesifik supaya mudah dipindai.
- Hindari singkatan, termasuk singkatan Latin.
- Label tombol 1–3 kata; label navigasi 1–2 kata.

## Kegunaan dan M3 Expressive
Sumber: `/foundations/usability`

- Tentukan tujuan utama tiap halaman dan beri emphasis terkuat: ukuran terbesar, warna primary, posisi mudah dijangkau, ruang kosong di sekelilingnya.
- Tujuan sekunder memakai warna sekunder dan container halus.
- Alat emphasis: warna dan kontras, pengelompokan dalam container, motion, bentuk, ukuran, tipografi. Jangan memakai semuanya sekaligus.
- Satu tugas utama per halaman.
