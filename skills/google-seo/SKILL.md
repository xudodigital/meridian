---
name: google-seo
description: Pedoman SEO default, berdasarkan dokumentasi resmi Google Search Central. Pakai setiap kali merencanakan, menulis, mengaudit, atau menerbitkan konten dan halaman web untuk pencarian - riset keyword, judul dan meta description, struktur URL dan situs, internal link, gambar, canonical, situs multi-negara, AI Overview, serta pemeriksaan kebijakan spam sebelum terbit - kecuali pengguna menyebut pedoman lain.
---

# SEO menurut Google Search Central

Sumber: rangkuman dari SEO Starter Guide Google dan halaman yang dirujuknya di developers.google.com/search (dirayapi 1 Oktober 2026; halaman sumber terakhir diperbarui Desember 2025). Ini ringkasan kerja, bukan salinan. Dokumentasi Google berlisensi CC BY 4.0. Bila ragu, halaman sumber adalah acuan akhir.

## Pengukuran Meridian (diperiksa 5 Oktober 2026)

Halaman [AI features](https://developers.google.com/search/docs/appearance/ai-features) menjelaskan pelaporan gabungan di Web; [AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide) juga menjelaskan laporan Generative AI di Search Console. Jangan menganggap keduanya bukti adanya endpoint API baru. Meridian saat ini mengambil Search Analytics Web dan GA4, belum mengambil laporan AI terpisah. Pertahankan rentang tanggal, freshness, coverage dan status koneksi. Jangan membuat estimasi klik AI terpisah atau menyimpulkan nol ketika datanya tidak tersedia.

## Prinsip yang mengatur semuanya

1. **Konten dibuat untuk orang, bukan untuk mesin pencari.** Menurut Google, konten yang menarik dan berguna lebih berpengaruh daripada semua saran lain dalam panduannya.
2. **Tidak ada jaminan.** Memenuhi semua syarat tidak menjamin halaman dirayapi, diindeks, atau tampil. Jangan menjanjikan peringkat.
3. **Hasil butuh waktu.** Perubahan bisa terlihat dalam beberapa jam sampai beberapa bulan; tunggu beberapa minggu sebelum menilai.
4. **Otomatisasi boleh, manipulasi tidak.** AI boleh dipakai untuk riset dan menyusun konten asli. Menghasilkan banyak halaman tanpa nilai tambah bagi pembaca melanggar kebijakan spam (scaled content abuse), apa pun cara pembuatannya.

## Alur kerja

### 1. Sebelum menulis
- Tentukan siapa pembacanya dan apa yang ingin mereka capai. Tulis hanya topik yang relevan untuk pembaca situs itu.
- Pikirkan kata yang dipakai pembaca saat mencari, termasuk beda kosakata antara pemula dan ahli. Tidak perlu mencakup semua variasi; sistem bahasa Google memahami padanan.
- Tentukan nilai tambah halaman ini dibanding hasil yang sudah ada: informasi asli, pengalaman langsung, analisis, atau data. Bila tidak ada, jangan dibuat.

### 2. Saat menulis
- Tulis alami, rapi, tanpa salah eja. Pecah teks panjang menjadi paragraf dan bagian berheading.
- Jangan menyalin atau sekadar menulis ulang sumber lain. Kutip dan tautkan sumber yang dipercaya.
- Jangan membuat klaim pengalaman yang tidak terjadi ("kami menguji selama tujuh hari") dan jangan menjanjikan jawaban yang belum ada.
- Tidak ada target jumlah kata, minimal maupun maksimal.
- Tampilkan siapa penulisnya bila pembaca wajar mengharapkannya, dan bagaimana konten dibuat. Bila konten sebagian besar dibuat dengan AI, pertimbangkan menjelaskannya kepada pembaca.

### 3. On-page (rincian di `references/on-page.md`)
- **`<title>`:** unik per halaman, jelas, ringkas, akurat; nama situs di awal atau akhir dengan pemisah; bahasa dan aksara sama dengan isi halaman.
- **Judul utama:** satu judul yang paling menonjol, sebaiknya di `<h1>` pertama.
- **Meta description:** unik per halaman, ringkasan satu sampai dua kalimat yang memuat poin terpenting; bukan daftar keyword.
- **URL:** kata yang bermakna bagi pembaca; halaman setopik dikelompokkan dalam direktori.
- **Link:** elemen `<a href>` dengan anchor text deskriptif; setiap halaman penting mendapat link dari minimal satu halaman lain.
- **Gambar:** tajam, dekat teks yang relevan, dengan alt text deskriptif.
- **Kata yang dicari pembaca** ditempatkan di tempat menonjol: title, judul utama, alt text, anchor text. Tanpa pengulangan.

### 4. Teknis
- Googlebot tidak diblokir, halaman menjawab HTTP 200, dan ada konten yang bisa diindeks. Itulah seluruh syarat teknis minimum.
- CSS dan JavaScript tidak diblokir, supaya Google melihat halaman seperti pengguna.
- Satu konten, satu URL. Duplikat dialihkan dengan redirect; bila tidak bisa, pakai `rel="canonical"`.
- Sitemap membantu tetapi tidak wajib.
- Untuk mencegah pengindeksan pakai `noindex` dan biarkan halaman dirayapi; robots.txt hanya mencegah perayapan.
- **Jangan memasang `noindex` dan `Disallow` robots.txt pada URL yang sama.** Bila robots.txt memblokir perayapan, Google tidak pernah melihat `noindex`, dan URL itu masih bisa terindeks. Untuk mengeluarkan halaman dari indeks: `noindex` saja, tanpa `Disallow`.

### 5. Sebelum terbit: periksa kebijakan spam
Jalankan daftar di `references/spam-policies.md`. Bila satu butir saja terkena, halaman tidak diterbitkan dan dikembalikan dengan alasannya.

### 6. Setelah terbit
- Pantau di Search Console: laporan Page Indexing, Crawl Stats, URL Inspection, dan Performance.
- Perbarui konten lama bila isinya berubah, atau hapus bila tidak relevan lagi. Jangan mengubah tanggal tanpa perubahan isi yang berarti.

## Yang tidak perlu dikerjakan

Google menyebut hal-hal berikut tidak layak dijadikan fokus:

| Topik | Kenyataannya |
|---|---|
| Meta keywords | Tidak dipakai Google Search |
| Keyword di nama domain atau path URL | Hampir tanpa pengaruh, selain muncul di breadcrumb |
| TLD (.com, .org, dan lain-lain) | Hanya berarti bila menarget satu negara, dan itu pun sinyal lemah |
| Panjang konten | Tidak ada jumlah kata ajaib |
| Subdomain vs subdirektori | Pilih yang masuk akal bagi bisnis |
| PageRank | Hanya satu dari banyak sinyal |
| "Penalti" konten duplikat di situs sendiri | Tidak ada; tidak efisien, tetapi bukan pelanggaran. Menyalin konten orang lain adalah soal lain |
| Jumlah dan urutan heading | Tidak berpengaruh untuk Search (tetap penting untuk pembaca layar) |
| E-E-A-T | Bukan faktor peringkat; ia kerangka untuk menilai kualitas sendiri |
| Markup atau berkas khusus untuk AI Overview | Tidak ada dan tidak diperlukan |

## Situs multi-negara
- Sinyal negara target: ccTLD (terkuat), hreflang, lokasi server, bahasa dan mata uang lokal, alamat dan nomor telepon lokal, link dari situs lokal.
- Google menentukan bahasa dari **konten yang terlihat**, bukan dari atribut `lang` atau URL. Satu bahasa per halaman untuk isi dan navigasi; hindari terjemahan berdampingan.
- Jangan mengubah konten berdasarkan IP dan jangan mengalihkan pengguna otomatis menurut bahasa. Googlebot umumnya merayapi dari Amerika Serikat dan tidak mengirim header `Accept-Language`.
- hreflang hanya untuk versi bahasa atau wilayah dari konten yang sama. Situs mandiri bertopik berbeda tidak membutuhkannya.
- URL boleh memakai kata lokal dalam UTF-8.
- Pemblokiran domain oleh ISP di suatu negara tidak terlihat oleh Googlebot; periksa terpisah dari jaringan negara itu.

## AI Overview dan AI Mode
- Tidak ada syarat atau optimasi khusus. Praktik SEO yang sama berlaku.
- Syaratnya: halaman terindeks dan boleh tampil dengan snippet.
- Yang membantu: perayapan tidak diblokir (termasuk oleh CDN), internal link, konten penting dalam bentuk teks, gambar dan video pendukung, structured data yang cocok dengan teks terlihat.
- Trafik dari fitur AI tercatat di laporan Performance Search Console, jenis "Web".
- Kendali: `nosnippet`, `data-nosnippet`, `max-snippet`, `noindex`.

## Untuk sistem yang memproduksi konten dengan agent
Butir-butir ini berasal langsung dari kebijakan spam dan panduan konten AI Google:

- Setiap halaman harus lolos pertanyaan "nilai tambah apa bagi pembaca?" sebelum dibuat, bukan sesudahnya.
- Volume bukan tujuan. Memproduksi banyak konten di banyak topik dengan harapan sebagian berhasil adalah tanda bahaya yang disebut Google secara eksplisit.
- Membuat banyak situs untuk menyamarkan skala produksi konten termasuk scaled content abuse.
- Menerjemahkan atau memparafrasekan konten situs lain secara otomatis termasuk scraping.
- Metadata buatan AI (title, meta description, alt text, structured data) dituntut seakurat isi halaman.
- Pelacakan peringkat tidak boleh dengan mengirim kueri otomatis ke Google; itu melanggar kebijakan spam dan Ketentuan Layanan. Pakai data Search Console.
- Link antar-situs milik sendiri yang dibuat untuk peringkat termasuk link spam.

## Berkas pendukung
- `references/on-page.md`: title, snippet, URL, link, gambar, video, canonical, struktur situs.
- `references/spam-policies.md`: daftar periksa kebijakan spam sebelum terbit.
- `references/content-quality.md`: pertanyaan penilaian mandiri untuk konten.
