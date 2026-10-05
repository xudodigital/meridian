---
name: material-3-web
description: Sistem desain default untuk membangun website. Pakai setiap kali membuat atau mengubah halaman, tema, template, atau komponen web (HTML/CSS/JS, WordPress, atau framework apa pun), kecuali pengguna atau profil situs menyebut sistem desain lain. Menerapkan Material Design 3 (termasuk pembaruan M3 Expressive) lewat design token CSS - warna berbasis peran, skala tipografi, bentuk, elevasi, motion, layout adaptif, state, dan aksesibilitas.
---

# Material Design 3 untuk web

Sumber: rangkuman dari https://m3.material.io (dirayapi 1 Oktober 2026). Ini ringkasan kerja, bukan salinan dokumentasi. Bila ada angka yang meragukan, halaman sumber adalah acuan akhir.

## Hal yang harus diketahui lebih dulu

1. **Jangan memasang Material Web Components (`@material/web`) untuk proyek baru.** Situs resmi menyatakan pustaka itu dalam mode pemeliharaan dan M3 Expressive tidak diimplementasikan di web. Bangun dengan HTML semantik dan CSS biasa, memakai token di `references/tokens.css`.
2. **Sistem token spacing M3 hanya tersedia di Jetpack Compose.** Di web, pakai skala 8px dari `tokens.css` sebagai padanannya.
3. **Motion spring tidak ada di CSS.** Pakai kurva pengganti resmi (tabel "Web: convert springs to curves") yang sudah ada di `tokens.css`.
4. **1dp = 1px CSS. 1sp = 0,0625rem** (16sp = 1rem). Ukuran huruf selalu dalam rem.
5. **Setiap situs harus punya tema sendiri.** M3 adalah sistem, bukan satu tampilan. Skema ungu bawaan (baseline) hanya cadangan; lihat langkah 1 di bawah.

## Alur kerja

1. **Tentukan tema situs** dari profil situs: satu warna sumber (brand), typeface brand dan plain, dan tingkat kebulatan sudut. Hasilkan skema warna terang dan gelap dari warna sumber dengan Material Theme Builder atau pustaka `@material/material-color-utilities`, lalu timpa token `--md-sys-color-*`. Jangan memilih 26 warna dengan tangan dan jangan menggeser warna lewat HSL; tone M3 memakai ruang warna HCT.
2. **Salin `references/tokens.css`** ke proyek sebagai lapisan token. Semua komponen hanya boleh merujuk token, tidak pernah nilai hex atau px lepas untuk warna, radius, bayangan, dan durasi.
3. **Rancang layout per breakpoint** (lihat `references/foundations.md`, bagian Layout): mulai dari compact, lalu tanyakan apa yang perlu ditampilkan, dibagi, diubah ukurannya, dipindahkan, atau ditukar di ukuran berikutnya.
4. **Bangun komponen** mengikuti `references/components.md`. Pakai elemen HTML asli (`button`, `a`, `input`, `dialog`, `nav`) sebelum ARIA.
   - Saat menyerahkan kode, sertakan CSS komponennya. Bila memakai pola dari `tokens.css` (`.md-state`, `.md-button`, `.md-icon-button`, `.md-dialog`), sebutkan namanya dan apa yang sudah ditanganinya (state, target 48px, scrim), supaya penerima tidak mengira bagian itu terlewat.
   - Bila brief bertentangan dengan aturan di skill ini, jangan dikerjakan apa adanya: serahkan versi yang benar dan jelaskan singkat bagian mana yang diubah dan mengapa.
5. **Periksa** dengan daftar di bagian akhir berkas ini.

## Aturan inti

### Warna
- Warna diberikan lewat **peran**, bukan nilai. Selalu pasangkan container dengan `on-`-nya: `primary` + `on-primary`, `secondary-container` + `on-secondary-container`, dan seterusnya. Pasangan yang salah merusak kontras.
- `surface` untuk latar halaman; `surface-container` (lowest sampai highest) untuk area dan komponen di atasnya. Area yang bertumpuk harus memakai peran surface berbeda.
- Teks: `on-surface` (utama), `on-surface-variant` (sekunder). Tautan dalam teks: `primary`, dan **harus bergaris bawah**.
- `outline` untuk batas penting (misalnya text field, kontras 3:1); `outline-variant` untuk divider dan batas dekoratif. Jangan pakai `outline` untuk divider atau batas card.
- `primary` untuk aksi terpenting; `secondary` untuk elemen yang kurang menonjol; `tertiary` untuk aksen pengimbang; `error` hanya untuk kesalahan.
- Peran `fixed` jarang diperlukan; jangan dipakai bila kontras penting.

### Tipografi
- Lima peran × tiga ukuran: display, headline, title, body, label. Situs tidak perlu memakai semuanya; pilih beberapa.
- Display dan headline memakai typeface **brand**; body dan label memakai typeface **plain**. Jangan pakai font dekoratif untuk body.
- Jangan mengubah ukuran huruf token; sesuaikan line-height dan letter-spacing bila mengganti font.
- Line-height sekitar 1,2× untuk teks besar dan 1,5× untuk body. Panjang baris 40–60 karakter.
- Angka dalam tabel atau yang sering berubah: `font-variant-numeric: tabular-nums`.
- Bahasa beraksara tinggi butuh line-height lebih besar: Vietnam, Thai, Bangla, Hindi, Arab, CJK sekitar 7% lebih tinggi; Burma dan Telugu sekitar 30%; Nastaliq (Urdu) sekitar 100%. Setel `--md-lang-height` di `tokens.css` sesuai bahasa situs.
- Semua teks UI memakai **sentence case**, termasuk tombol, judul, dan navigasi. Ini berlaku untuk teks di HTML maupun CSS: jangan menulis label dengan huruf kapital semua ("SAVE CHANGES") dan jangan memakai `text-transform: uppercase`, walaupun brief memintanya. Tulis "Save changes" dan jelaskan alasannya.

### Bentuk
- Skala radius: 0, 4, 8, 12, 16, 20, 28, 32, 48, penuh. Pakai token, jangan angka di antaranya.
- Sudut bersarang: radius dalam = radius luar − padding.
- Sudut besar atau penuh tidak untuk komponen padat informasi seperti card berisi banyak teks.

### Elevasi
- Enam level (0–5). Keadaan diam hanya level 0–3; level 4–5 untuk hover dan drag. Hover atau focus biasanya menaikkan satu level.
- Pemisah bawaan adalah **beda tone surface**, bukan bayangan. Bayangan dipakai hemat: untuk elemen di atas latar ramai atau elemen mengambang.
- `surface-tint` sudah usang; jangan dipakai.
- Scrim di belakang modal: warna `scrim` dengan opasitas 32%.

### State
- State digambar dengan **state layer**: lapisan warna konten (`on-`) di atas container. Hover 8%, focus 10%, pressed 10%, dragged 16%. Hanya satu layer pada satu waktu.
- Disabled: konten 38% opasitas, container 12% dari `on-surface`. Disabled tidak wajib memenuhi kontras.
- Focus keyboard selalu punya indikator yang terlihat (`:focus-visible`).
- Setiap elemen interaktif yang diserahkan harus membawa state hover, focus, dan pressed: pasang kelas `.md-state` dari `tokens.css` (misalnya `class="md-button md-button--filled md-state"`) atau tulis aturannya sendiri. Tombol tanpa state belum selesai.

### Motion
- Efek (warna, opasitas) memakai kurva `effects`; perpindahan posisi dan ukuran memakai kurva `spatial`.
- Keluar lebih cepat daripada masuk; area kecil lebih singkat daripada area besar. Animasi keluar tidak pernah berdurasi sama dengan animasi masuk (contoh dialog: masuk 500ms, keluar 200ms).
- **Durasi dan kurva selalu diambil dari token motion** (tiap token sudah berisi durasi dan kurva). Jangan menulis durasi sendiri. Komponen tidak pernah beranimasi lebih dari 750ms; bila brief meminta lebih lama (misalnya "bounce 1,2 detik"), tolak, jelaskan alasannya, dan pakai token `expressive` spatial sebagai pengganti kesan memantul.
- Scrim ditulis `color-mix(in srgb, var(--md-sys-color-scrim) 32%, transparent)`, bukan `rgba` hitam.
- Tiap berkas CSS yang memuat animasi atau transisi menyertakan aturan `prefers-reduced-motion`, walaupun `tokens.css` sudah punya aturan global.
- Hormati `prefers-reduced-motion`.

### Layout
- Lima breakpoint lebar: compact < 600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large ≥ 1600.
- Navigasi adaptif dipilih sesuai jumlah tujuan dan jenis situs. Navigation bar memerlukan 3–5 tujuan; jangan menambah tujuan palsu pada situs artikel yang hanya memiliki Beranda dan Tentang. Situs seperti itu dapat mempertahankan navigasi tautan pada app bar dengan label utuh, target 48px dan reflow. Untuk aplikasi dengan 3–5 tujuan, pertimbangkan bar pada compact dan rail pada layar lebih lebar sesuai tabel pilihan di `references/foundations.md`.
- Pane: 1 pada compact dan medium; 2 pada expanded dan large; sampai 3 pada extra-large. Selalu ada minimal satu pane fleksibel.
- Spasi kelipatan 8px (4px untuk detail kecil). Atur padding dan gap pada container induk; hindari margin pada anak.

### Aksesibilitas
- Kontras teks kecil 4,5:1; teks besar dan grafik 3:1; container komponen yang berkelompok 3:1 terhadap latar.
- Target sentuh minimal 48×48px walau visualnya lebih kecil. Caranya: elemen `position: relative` dengan pseudo-element yang memperluas area klik, misalnya visual 40px ditambah `::after { content: ""; position: absolute; inset: -4px; }`. Menulis `width: 40px; height: 40px` saja **tidak** memenuhi syarat. Pola siap pakai: `.md-button` dan `.md-icon-button` di `tokens.css`.
- Satu `h1` per halaman, heading tidak melompati level, landmark (`header`, `nav`, `main`, `aside`, `footer`) lengkap; landmark yang muncul lebih dari sekali diberi label.
- Ikon tanpa teks punya label yang menjelaskan tujuannya, bukan bentuknya. Gambar dekoratif disembunyikan dari pembaca layar. Jangan menulis peran elemen di dalam label.

## Yang tidak boleh
- Lebih dari satu tombol filled utama di satu tampilan. Tombol filled diberikan kepada aksi **terpenting** (misalnya Publish), bukan aksi pertama dalam urutan.
- Tombol dengan label terpotong, dibungkus ke baris kedua, atau huruf kapital semua.
- Mencampur text field filled dan outlined dalam satu formulir.
- Navigation bar dengan kurang dari 3 atau lebih dari 5 tujuan, atau tanpa label.
- Memaksa konten ke dalam card bila spasi, heading, atau divider sudah cukup.
- Teks di atas gambar tanpa scrim atau bidang pelindung.
- Menukar komponen yang fungsinya tidak setara antar-breakpoint (misalnya tombol menjadi chip).
- Kepadatan tinggi sebagai bawaan; pengguna yang memilihnya.

## Pemeriksaan sebelum selesai
- [ ] Skema warna dihasilkan dari warna sumber situs ini, terang dan gelap.
- [ ] Tidak ada hex, radius, bayangan, atau durasi di luar token.
- [ ] Setiap container memakai pasangan `on-` yang benar.
- [ ] Layout diuji di 360, 600, 840, 1200, dan 1600px tanpa scroll horizontal.
- [ ] Semua target interaktif ≥ 48px; focus terlihat; urutan tab logis.
- [ ] Line-height disetel untuk bahasa situs.
- [ ] `prefers-reduced-motion` dan tema gelap bekerja.

## Berkas pendukung
- `references/tokens.css`: lapisan token siap pakai.
- `references/foundations.md`: warna, tipografi, bentuk, elevasi, motion, layout, state, aksesibilitas, penulisan UI.
- `references/components.md`: ukuran, warna, dan aturan pakai tiap komponen.
- `references/meridian-site-builder.md`: penerapan pada generator statis Meridian, batas tugas AI, dan pemeriksaan hasil build.
