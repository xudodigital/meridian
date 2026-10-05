# On-page dan teknis

Rangkuman dari Google Search Central. Tanda **[tidak dirayapi]** berarti halaman sumbernya tidak saya baca saat perayapan dan isinya berasal dari pengetahuan umum saya tentang dokumentasi Google; cocokkan dengan sumber bila penting.

## Title link
Sumber: `/search/docs/appearance/title-link`

Google menyusun judul hasil pencarian secara otomatis dari beberapa sumber: elemen `<title>`, judul visual utama, heading seperti `<h1>`, `og:title`, teks besar yang menonjol, anchor text yang mengarah ke halaman, dan structured data WebSite. Kita hanya bisa memengaruhinya.

Aturan menulis `<title>`:
- Setiap halaman punya `<title>`.
- Deskriptif dan ringkas. Hindari kata samar seperti "Beranda" atau "Profil".
- Tidak ada batas panjang, tetapi judul dipotong sesuai lebar perangkat. Hindari teks bertele-tele.
- Tanpa pengulangan keyword ("Sepatu, sepatu murah, jual sepatu").
- Tanpa boilerplate: judul yang sama, atau judul panjang yang hanya berbeda satu kata, di banyak halaman.
- Nama situs ringkas, di awal atau akhir, dipisah tanda hubung, titik dua, atau garis tegak. Keterangan panjang tentang situs hanya di beranda.
- Bahasa dan aksara sama dengan isi utama halaman. Halaman berbahasa Hindi berjudul Hindi, bukan Inggris atau transliterasi Latin.
- Jelas mana judul utama: satu teks paling menonjol, sebaiknya di `<h1>` pertama yang terlihat.

Penyebab Google mengganti judul:
- `<title>` setengah kosong (`| Nama Situs`).
- `<title>` usang (tahun lama, sementara judul di halaman sudah tahun baru).
- `<title>` tidak mencerminkan isi halaman.
- Judul sama untuk beberapa halaman yang berbeda (misalnya tanpa nomor musim atau bagian).
- Tidak jelas mana judul utama karena beberapa heading sama menonjolnya.

Setelah diubah, Google perlu merayapi ulang: beberapa hari sampai beberapa minggu.

## Snippet dan meta description
Sumber: `/search/docs/appearance/snippet`

- Snippet terutama diambil dari **isi halaman** dan bisa berbeda untuk tiap kueri. Meta description dipakai bila lebih tepat menggambarkan halaman.
- Meta description: unik per halaman, ringkasan satu sampai dua kalimat, memuat poin terpenting. Tidak ada batas panjang; dipotong sesuai lebar perangkat.
- Boleh memuat data terstruktur dalam teks: penulis, tanggal, harga, produsen.
- Untuk situs besar, pembuatan otomatis dianjurkan selama hasilnya terbaca manusia, beragam, dan berdasarkan data halaman itu.
- Bila tidak sempat semua, dahulukan beranda dan halaman populer.

| Buruk | Lebih baik |
|---|---|
| Daftar keyword | Menjelaskan apa yang ditawarkan, plus detail seperti jam buka dan lokasi |
| Sama di semua halaman | Ringkasan khusus halaman itu |
| Tidak merangkum halaman (cerita pembuka) | Merangkum seluruh isi halaman |
| Terlalu pendek (dua kata) | Spesifik dan rinci |

Kendali: `nosnippet` (tanpa snippet), `max-snippet:[angka]` (panjang maksimal), atribut `data-nosnippet` (kecualikan bagian tertentu).

Supaya link "Read more" ke bagian halaman bisa muncul: konten langsung terlihat (tidak tersembunyi di tab atau accordion), jangan mengatur posisi scroll lewat JavaScript saat halaman dimuat, dan jangan menghapus hash dari URL.

## URL dan struktur situs
Sumber: SEO Starter Guide

- URL memuat kata yang berguna bagi pembaca (`/pets/cats.html`), bukan pengenal acak. Bagian URL bisa tampil sebagai breadcrumb.
- Kelompokkan halaman setopik dalam direktori. Pada situs dengan lebih dari beberapa ribu URL, ini membantu Google mempelajari seberapa sering tiap direktori berubah.
- Breadcrumb dipelajari otomatis dari URL dan bisa dipertegas dengan structured data.
- Jangan merombak struktur situs yang sudah berjalan hanya demi ini; manfaatnya jangka panjang.

## Konten duplikat dan canonical
Sumber: SEO Starter Guide; rincian `/crawling-indexing/consolidate-duplicate-urls` **[tidak dirayapi]**

- Untuk tiap konten, mesin pencari memilih satu URL (canonical) untuk ditampilkan.
- Duplikat di situs sendiri bukan pelanggaran, tetapi membingungkan pengguna dan memboroskan perayapan.
- Urutan pilihan: buat tiap konten hanya bisa diakses lewat satu URL; bila ada duplikat, redirect ke URL pilihan; bila tidak bisa redirect, pakai `<link rel="canonical">`.
- Bila tidak ditentukan, Google memilih sendiri.

## Link
Sumber: `/search/docs/crawling-indexing/links-crawlable`, `/qualify-outbound-links`

**Bisa dirayapi:** hanya `<a>` dengan atribut `href` yang berisi alamat sungguhan.

| Bisa | Tidak bisa diandalkan |
|---|---|
| `<a href="https://example.com">` | `<a routerLink="...">` |
| `<a href="/produk/sepatu">` | `<span href="...">` |
| `<a href="/produk" onclick="...">` | `<a onclick="goto('...')">` |
| | `<a href="javascript:...">` |

Link yang disisipkan lewat JavaScript tetap bisa dirayapi asal memakai markup di kolom kiri.

**Anchor text:**
- Deskriptif, cukup ringkas, relevan dengan halaman asal dan halaman tujuan.
- Uji: baca anchor text saja, di luar konteks. Bila tujuan link tidak tertebak, perbaiki.
- Hindari "klik di sini", "baca selengkapnya", "situs web", "artikel".
- Hindari anchor yang terlalu panjang (satu kalimat penuh).
- Jangan menjejalkan keyword.
- Jangan menderetkan link berdampingan; kata di sekitar link ikut memberi konteks.
- Link berupa gambar memakai `alt` gambar sebagai anchor text.
- Anchor kosong buruk; atribut `title` hanya cadangan.

**Internal link:**
- Setiap halaman yang penting mendapat link dari minimal satu halaman lain di situs.
- Tautkan halaman lain yang membantu pembaca memahami halaman ini, di dalam konteks kalimat.
- Tidak ada jumlah link ideal. Bila terasa terlalu banyak, memang terlalu banyak.

**Link keluar:**
- Menautkan sumber membangun kepercayaan. Tautkan bila masuk akal dan beri konteks.
- Hanya tautkan sumber yang dipercaya.

| Atribut | Kapan dipakai |
|---|---|
| (tanpa `rel`) | Link biasa |
| `rel="sponsored"` | Iklan, penempatan berbayar, afiliasi |
| `rel="ugc"` | Link dari konten buatan pengguna (komentar, forum) |
| `rel="nofollow"` | Bila tidak ingin situs dikaitkan dengan halaman tujuan dan atribut lain tidak cocok |

Nilai boleh digabung (`rel="ugc nofollow"`). Untuk link dalam situs sendiri yang tidak boleh dirayapi, pakai `disallow` di robots.txt, bukan nofollow.

## Gambar
Sumber: SEO Starter Guide; rincian `/appearance/google-images` **[tidak dirayapi]**

- Gambar tajam dan jelas, diletakkan dekat teks yang relevan. Teks di sekitarnya membantu Google memahami gambar.
- Alt text pendek tetapi deskriptif, menjelaskan hubungan gambar dengan konten.
- **[tidak dirayapi]** Pakai elemen `<img>` (gambar lewat CSS background tidak diindeks), nama berkas deskriptif, format yang didukung, dan gambar responsif.

## Video
Sumber: SEO Starter Guide

- Video berkualitas di halaman tersendiri, dekat teks yang relevan.
- Judul dan deskripsi video ditulis dengan aturan yang sama seperti judul halaman.

## Iklan dan pengalaman halaman
- Iklan tidak boleh mengganggu atau menghalangi pembaca.
- Hindari interstitial yang menyulitkan pemakaian situs.
- Google menilai pengalaman halaman secara menyeluruh, bukan satu atau dua aspek.

## Kendali perayapan dan pengindeksan

| Tujuan | Cara |
|---|---|
| Mencegah halaman terindeks | `noindex`, dan halaman tetap boleh dirayapi |
| Mencegah perayapan | `disallow` di robots.txt (URL masih bisa muncul tanpa isi) |
| Halaman pribadi | Wajib login |
| Memeriksa yang dilihat Google | URL Inspection di Search Console |
| Memeriksa apakah terindeks | Operator `site:domain` |

Halaman yang diblokir robots.txt tetapi ditautkan situs lain bisa tetap terindeks, dengan judul yang diambil dari anchor text luar.

**Kesalahan umum:** memasang `noindex` sekaligus `Disallow` untuk URL yang sama "supaya aman ganda". Keduanya saling membatalkan: `Disallow` membuat Google tidak merayapi halaman, sehingga `noindex` tidak pernah terbaca. Bila diminta mengeluarkan halaman dari indeks, hasilkan `noindex` saja dan jangan tulis aturan `Disallow` untuk URL itu.

## Structured data
Sumber: SEO Starter Guide, panduan konten AI

- Membuat halaman memenuhi syarat untuk tampilan khusus (bintang ulasan, carousel, dan lain-lain).
- Harus cocok dengan teks yang terlihat di halaman, mengikuti pedoman umum dan kebijakan tiap fitur, dan lolos validasi.
- Tidak menjamin tampilan khusus muncul.

## Mempromosikan situs
- Media sosial, komunitas, iklan, buletin (dengan izin), dan promosi luring.
- Dari mulut ke mulut adalah yang paling tahan lama.
- Promosi berlebihan bisa dianggap manipulasi oleh mesin pencari.
