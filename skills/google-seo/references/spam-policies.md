# Kebijakan spam Google: daftar periksa sebelum terbit

Sumber: `/search/docs/essentials/spam-policies`. Seluruh bagian sudah dicocokkan dengan halaman sumber pada 1 Oktober 2026.

Spam menurut Google: teknik untuk menipu pengguna atau memanipulasi sistem Search, **termasuk upaya memanipulasi jawaban AI generatif di Search**. Pelanggaran dideteksi sistem otomatis dan, bila perlu, tinjauan manusia (manual action). Akibatnya peringkat turun atau situs tidak tampil sama sekali. Google dapat bertindak terhadap praktik spam apa pun, tidak hanya yang terdaftar.

## Paling relevan untuk produksi konten dengan agent

### Scaled content abuse
Banyak halaman dibuat dengan tujuan utama memanipulasi peringkat, bukan membantu pengguna; biasanya konten tidak asli dan bernilai rendah, **apa pun cara pembuatannya**.

Periksa, dan tolak bila "ya":
- [ ] Halaman dibuat dengan AI tanpa nilai tambah bagi pembaca?
- [ ] Isinya hasil scraping feed, hasil pencarian, atau konten lain, termasuk yang diubah otomatis (sinonim, terjemahan, pengaburan)?
- [ ] Isinya gabungan potongan dari beberapa halaman tanpa nilai tambah?
- [ ] Ada beberapa situs yang dibuat untuk menyamarkan skala produksi konten?
- [ ] Halaman hampir tidak bermakna bagi pembaca tetapi sarat keyword?

### Scraping
- [ ] Menerbitkan ulang konten situs lain tanpa konten asli, nilai tambah, atau sumber?
- [ ] Menyalin lalu mengubah sedikit (sinonim, teknik otomatis)?
- [ ] Situs yang hanya menyematkan atau mengumpulkan media dari situs lain?

### Doorway abuse
- [ ] Beberapa situs dengan variasi kecil pada URL dan beranda untuk menjangkau kueri yang sama?
- [ ] Banyak domain atau halaman per wilayah atau kota yang menggiring pengguna ke satu halaman?
- [ ] Halaman yang dibuat hanya untuk menggiring ke bagian lain situs?
- [ ] Halaman-halaman yang sangat mirip, lebih menyerupai hasil pencarian daripada hierarki yang bisa dijelajahi?

### Link spam
Link dibuat terutama untuk memanipulasi peringkat.
- [ ] Membeli atau menjual link, termasuk dibayar dengan barang, jasa, atau produk gratis?
- [ ] Tukar-menukar link berlebihan, atau halaman mitra khusus untuk saling menautkan?
- [ ] Program otomatis yang membuat link ke situs?
- [ ] Link di footer atau template yang disebar ke banyak situs?
- [ ] Artikel tamu, advertorial, atau siaran pers dengan anchor text teroptimasi yang meneruskan nilai peringkat?
- [ ] Komentar forum dengan link teroptimasi?
- [ ] Konten bernilai rendah yang dibuat terutama untuk memanipulasi sinyal link?

Link berbayar sah bila diberi `rel="sponsored"` atau `rel="nofollow"`.

### Keyword stuffing
- [ ] Kata atau frasa diulang sampai terdengar tidak wajar?
- [ ] Blok teks berisi daftar kota atau wilayah yang ingin dibidik?
- [ ] Daftar nomor telepon tanpa nilai tambah?

### Expired domain abuse
- [ ] Domain kedaluwarsa dibeli dan dipakai ulang terutama untuk memanfaatkan peringkat lamanya, dengan konten bernilai rendah yang tidak berhubungan dengan pemakaian sebelumnya?

### Machine-generated traffic
- [ ] Mengirim kueri otomatis ke Google, termasuk scraping hasil pencarian untuk memeriksa peringkat, tanpa izin tertulis? Ini melanggar kebijakan spam dan Ketentuan Layanan Google.

## Teknik penipuan

### Cloaking
Menyajikan konten berbeda kepada pengguna dan mesin pencari untuk memanipulasi peringkat.
- [ ] Isi berbeda untuk Googlebot dan manusia?
- [ ] Teks atau keyword yang hanya disisipkan untuk user agent mesin pencari?

Paywall bukan cloaking bila Google melihat konten penuh seperti pelanggan.

### Hidden text and link abuse
- [ ] Teks putih di latar putih, di balik gambar, di luar layar lewat CSS, atau berukuran maupun beropasitas 0?
- [ ] Link yang disembunyikan pada satu karakter kecil?

Bukan pelanggaran: accordion, tab, slider, tooltip, dan teks khusus pembaca layar.

### Sneaky redirects
- [ ] Mesin pencari diberi satu jenis konten sementara pengguna dialihkan ke konten yang jauh berbeda?
- [ ] Pengguna desktop melihat halaman normal sementara pengguna ponsel dialihkan ke domain lain yang tidak berhubungan?

Bukan pelanggaran: pindah alamat situs, menggabungkan beberapa halaman menjadi satu, mengalihkan pengguna ke halaman dalam setelah login. Ukurannya: apakah pengalihan dimaksudkan untuk menipu pengguna atau mesin pencari.

### Misleading functionality
- [ ] Situs menjanjikan fungsi (generator, alat, layanan) yang sebenarnya tidak ada dan hanya menggiring ke iklan?

### Malicious practices
- [ ] Malware atau perangkat lunak yang tidak diinginkan?
- [ ] Membajak tombol kembali di browser?

## Pihak ketiga dan afiliasi

### Site reputation abuse
Konten pihak ketiga dipasang di situs mapan terutama untuk menumpang sinyal peringkat situs itu.
- [ ] Menerbitkan konten pihak ketiga yang tidak terpadu dengan situs, tanpa pengawasan editorial, demi peringkat?

Yang dinilai tinjauan manusia: kesesuaian tampilan dengan situs induk, kualitas, kejelasan penulis dan penanggung jawab, dan apakah konten yang sama muncul di banyak situs lain.

### Thin affiliation
- [ ] Halaman afiliasi yang hanya menyalin deskripsi dan ulasan dari penjual tanpa konten asli atau nilai tambah?
- [ ] Situs templat dengan konten yang sama atau mirip, diulang di dalam satu situs atau di beberapa domain atau bahasa?

Halaman afiliasi yang baik menambah nilai: informasi harga, ulasan asli, pengujian sungguhan dan penilaian, navigasi kategori, perbandingan produk.

### User-generated spam
- [ ] Ada konten spam yang ditambahkan pengguna dan dibiarkan: akun spam di layanan yang bebas didaftari, kiriman spam di forum, komentar spam di blog, berkas spam yang diunggah?

Pencegahan: moderasi area publik, dan beri `rel="ugc"` (boleh digabung `nofollow`) pada link dari pengguna.

### Hacked content
- [ ] Ada halaman, kode, link tersembunyi, atau pengalihan yang tidak dibuat pemilik situs? Peretas sering memakai cloaking supaya sulit terdeteksi.

## Praktik lain yang dapat menurunkan atau menghapus situs dari hasil pencarian

### Policy circumvention
- [ ] Membuat atau memakai subdomain, subdirektori, atau situs baru untuk melanjutkan praktik yang sudah melanggar?
- [ ] Memakai cara lain untuk terus menyebarkan konten atau perilaku yang melanggar?

Akibatnya bisa lebih luas: kehilangan kelayakan untuk fitur tertentu (Top Stories, Discover) dan penghapusan bagian situs yang lebih besar.

### Scam and fraud
- [ ] Meniru bisnis atau layanan resmi lewat situs tiruan?
- [ ] Menampilkan informasi palsu tentang suatu bisnis atau layanan, termasuk kontak atau layanan pelanggan palsu?

### Legal removals dan personal information removals
- Bila sebuah situs menerima banyak permintaan penghapusan hak cipta yang sah, konten lain dari situs itu ikut diturunkan. Hal serupa berlaku untuk pencemaran nama baik, barang palsu, dan perintah pengadilan.
- Situs yang menerima banyak permintaan penghapusan informasi pribadi, atau memakai praktik penghapusan yang memeras, juga diturunkan.

## Bila terkena
Pemberitahuan muncul di laporan Manual actions dan pusat pesan Search Console. Setelah masalah diperbaiki, ajukan permintaan peninjauan ulang.
