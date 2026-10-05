# Validasi Meridian

Dokumen ini membedakan kemampuan implementasi, bukti pengujian otomatis, dan hal yang memerlukan lingkungan nyata. Tidak ada deployment produksi yang diperlukan untuk menjalankan pengujian otomatis.

## Menjalankan pemeriksaan

Gunakan Node proyek bila Node sistem belum versi 24:

```sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm --prefix app run typecheck
npm --prefix app test
npm --prefix app run build
npm run test:server
```

`test:server` memakai `scripts/test-server.mjs`. Setiap suite diisolasi dari direktori data produksi. Server yang dijalankan testkit memiliki direktori sementara, port tersendiri, HTTP OpenAI tiruan, dan layanan HTTP tiruan. Impor tidak sengaja atas `server/db.ts` juga masuk ke direktori karantina suite. Jangan menguji migrasi, restore, atau job terhadap `data/` aktif.

## Bukti yang dicakup otomatis

| Area | Bukti utama |
|---|---|
| Riset → artikel → keputusan manusia → build → deployment | `server/workflows.test.ts`, `server/builds.test.ts`, `server/api.test.ts`; server sungguhan, penyedia tiruan |
| Pemulihan proses terhenti, antrean, pembatalan request API | `server/hardening.test.ts`, `server/engine.test.ts` |
| Backup konsisten saat WAL aktif, integritas SQLite, key/media/build, restore, penolakan arsip rusak dan restore saat server hidup | `server/backup.test.ts` |
| Output situs: title, canonical, satu h1, bahasa, sitemap, structured data, escaping | `server/sitebuild.test.ts` |
| Validasi artikel, sumber, editing, keputusan dan peran | `server/article-edit.test.ts`, `server/api.test.ts` |
| Hubungan data perjalanan, filter situs, reviewer, record hilang | `app/src/views/journey/model.test.ts` |
| Membuka artikel yang tepat dan melindungi perubahan belum tersimpan | `app/src/views/journey/JourneyDialog.test.tsx` |
| Sinkronisasi demo antartab, satu jam simulasi, perpindahan pengendali, isolasi data nyata | `app/src/store/demoSync.test.ts` |
| Rute yang dimuat bertahap, alias lama, role guard | `app/src/navigation.test.tsx`, `app/src/app.smoke.test.tsx`, `app/src/office.test.tsx` |

Tes struktur HTML membuktikan keluaran teknis, bukan kebenaran setiap klaim artikel, kualitas bahasa, indexing, atau kenaikan ranking.

## Pemeriksaan UI sebelum rilis

Gunakan fixture terisolasi. Periksa seluruh menu, filter situs, keadaan kosong, kegagalan, dan pekerjaan aktif. Pada desktop dan ponsel, periksa overflow, keterbacaan, dialog, dan posisi tindakan. Dengan keyboard: Skip to content, fokus yang terlihat, Enter/Space pada tombol, Escape untuk menutup dialog, dan fokus kembali ke pemicu. Pause visual motion serta preferensi reduced motion tidak boleh menghentikan pembaruan data.

Mode terang dan gelap harus menggunakan token yang sama. Jangan mengganti state dengan warna saja: status harus tetap tertulis. Halaman konfigurasi tidak memerlukan animasi aktivitas bila tidak ada pekerjaan yang berjalan.

## Pengujian akun dan domain nyata — panduan awal

Pada pemeriksaan awal pengguna belum menyiapkan domain uji. Pilot 5 Oktober 2026 di bagian akhir memakai `xudotrailer.us`; bukti otomatis tetap tidak membuktikan izin token, perilaku Cloudflare, DNS, sertifikat, kuota OpenAI API, atau akses dari negara target.

Setelah domain uji tersedia:

1. Pilih situs percobaan dan anggaran kecil. Pastikan approval sebelum deployment tetap aktif.
2. Jalankan satu riset dan satu artikel. Buka sumbernya, periksa akurasi dan kualitas bahasa, serta catatan mesin/model yang benar-benar dipakai.
3. Tinjau build dan semua halaman hasilnya. Periksa tautan, gambar/kredit, canonical, sitemap, serta tampilan ponsel.
4. Setelah persetujuan pengguna untuk domain tersebut, uji deployment, DNS/TLS dan akses dari negara target. Catat URL, waktu, hasil dan kegagalan.
5. Uji rollback dengan versi percobaan. Untuk restore data, lakukan latihan pada salinan terisolasi, jangan mengganti data aktif.
6. Gunakan Search Console setelah tersedia untuk menilai indexing dan hasil pencarian. Jangan menggunakan angka demo sebagai hasil SEO.

## Catatan pemulihan

Backup mencakup database, secret.key, media, dan build. Simpan arsip di lokasi cadangan yang terkendali; backup lokal pada disk yang sama belum melindungi dari kehilangan disk. Restore bawaan menolak server aktif dan mempertahankan direktori lama. Pengaturan layanan (`service.sh`) dan variabel lingkungan server berada di luar arsip data: siapkan ulang pada komputer pengganti sesuai README.

## Pemeriksaan 4 Oktober 2026

Frontend: 613 tes lulus; backend: 392 tes lulus dalam lingkungan terisolasi. Dua tes batas waktu CLI sempat gagal pada putaran pertama; suite backend lengkap dijalankan ulang dan lulus. Uji UI memakai fixture tanpa jaringan: hubungan request/artikel/build/workflow, dialog saat motion dijeda, lebar 390 px tanpa overflow, Escape dan pemulihan fokus. Uji dua tab membuktikan Pause all di Dashboard diikuti Office baru, lalu Resume dari Office tercermin kembali di Dashboard.

Office Dashboard dan `/office` menggunakan komponen `Office` yang sama. Dulu setiap tab menjalankan seed dan simulasi sendiri. Sekarang `demoSync.ts` berbagi data demo di memori lewat BroadcastChannel; Web Locks memilih satu pengendali simulasi. Tidak ada snapshot sesi, kredensial, atau data live yang dibagikan. Setelah semua tab ditutup, demo kembali ke contoh awal. Semua tab harus memakai origin yang sama (host dan port sama) dan kode versi baru. Browser tanpa dukungan koordinasi menampilkan demo statis. Mode nyata tetap mengikuti server.

Angka “needs approval” adalah jumlah pekerjaan yang memerlukan keputusan (termasuk artikel), sedangkan angka Meeting room adalah jumlah agen di ruangan itu. Keduanya memang tidak harus sama. Filter situs yang berbeda juga dapat menghasilkan angka persetujuan berbeda.

## Penghapusan mode demo — 5 Oktober 2026

Mode demo dan tombol pengaktifannya telah dihapus dari aplikasi. Preferensi `das-demo` lama dibersihkan; tab lama tidak dapat mengaktifkannya pada versi baru. Konfigurasi agen, skill, integrasi kosong, dan pengaturan awal dipisahkan ke `defaults.ts`; konfigurasi ini tidak memuat situs, artikel, pekerjaan, notifikasi atau log contoh. Dataset `createSeed` hanya digunakan dalam mode pengujian dan dihilangkan oleh bundler dari build produksi. Loop halaman hanya memperbarui progress server dan pemeriksaan sesi.

Riwayat pekerjaan nyata di database dan log operasional server tidak dihapus. Setelah pembaruan, seluruh tab aplikasi perlu dimuat ulang. Pengujian sinkronisasi demo yang dicatat sebelumnya adalah bukti historis untuk fitur yang kini sudah dipensiunkan.

## OpenAI saja — 5 Oktober 2026

Mesin Claude Code diganti dengan OpenAI Responses API. Pilihan dan connector Claude/Gemini, skrip login CLI, dan fixture CLI lama dihapus. API menolak model di luar daftar OpenAI. Startup mengonversi konfigurasi lama dan job yang masih perlu berjalan, menghapus kredensial kedua provider lama, serta mempertahankan buku biaya historis. Upgrade ini tidak membuat backup.

Pemeriksaan yang dijalankan: suite lengkap frontend 607 tes lulus dan backend 398 tes lulus. Pemeriksaan tipe frontend dan server serta build produksi lulus. UI Integrations dan Models and skills diperiksa lewat browser dengan fixture terisolasi; pada lebar 390 px keduanya tidak memiliki overflow horizontal. Fixture UI dan server preview dihapus setelah pemeriksaan. Server lokal dimulai ulang dengan versi baru; health endpoint dan halaman utama memberikan HTTP 200, dan halaman utama memuat build terbaru.

HTTP OpenAI tiruan memeriksa model yang dikirim, konteks skill, input gambar, pembatasan web search, `store: false`, penggunaan token/cache, estimasi biaya, timeout, pembatalan, rate limit, refusal dan redaksi rahasia pada galat. Koneksi OpenAI sungguhan belum diuji: workspace saat pemeriksaan tidak memiliki API key OpenAI. Tiga runner AI (Keyword, Content Writer, Site Builder) menggunakan model; Orchestrator dan Deploy & Monitor tetap berjalan sebagai kode, enam peran lain tetap belum memiliki runner. Backup otomatis tetap dinonaktifkan sesuai permintaan pengguna.

## Panduan pengguna baru — 5 Oktober 2026

Workspace kosong kini mendahulukan `StartGuide`: tujuan produk, jalur enam langkah menuju preview pertama, satu tindakan utama, dan penjelasan hal yang dapat disiapkan kemudian. Formulir koneksi OpenAI, profil situs dan request riset dibuka langsung di Workspace. Negara tidak lagi dipilih otomatis dalam mode nyata. Daftar agen dan Office tetap tersedia dalam bagian tertutup sebelum pekerjaan pertama; peran yang belum memiliki runner juga ditutup secara bawaan.

Progres berasal dari data server untuk pasangan siteId/domain yang sama, termasuk status gagal atau sedang berjalan. Tanggapan POST riset diterapkan segera tanpa menunggu SSE; event yang lebih baru tidak ditimpa tanggapan queued yang terlambat. Formulir OpenAI mempertahankan alasan gagal dan menyegarkan engine setelah penyimpanan berhasil. Pengujian mencakup alur awal tanpa job otomatis, batas peran, domain yang berubah, request yang diterima dan race SSE/POST.

Suite frontend lengkap setelah perubahan terakhir: 624 tes lulus. Pemeriksaan tipe dan build produksi lulus. Pemeriksaan browser menggunakan fixture terisolasi tanpa koneksi OpenAI nyata atau data produksi: alur Connect OpenAI ke Add a site, serta ukuran 360, 600, 840, 1200 dan 1600 px tanpa overflow horizontal. Fixture dan server preview dihapus setelah pemeriksaan. Perubahan ini tidak membuat akun, situs, kredensial, pekerjaan atau backup pada workspace nyata.

## Eksekusi skill dan Site Builder Material 3 — 5 Oktober 2026

Penugasan skill bawaan sekarang dibaca oleh tiga runner AI pada panggilan berikutnya. Panduan wajib tetap dimuat meskipun penugasan opsional dikosongkan; agen Planned dan runner kode tetap ditandai sesuai kemampuannya. Entri katalog tambahan dan pemulihan versi UI tidak dianggap mengubah berkas instruksi. Loader memuat referensi CSS, mendukung skill tanpa folder references, menolak path di luar daftar bawaan/folder skill, dan membaca berkas terkini tanpa cache permanen. Referensi provider Gemini/harga lama milik orchestration tidak dimuat pada runtime OpenAI.

Generator mengambil lapisan token langsung dari skill M3, kemudian menimpa warna lewat HCT dan menyesuaikan font/tinggi baris. Sudut card 12px, pasangan warna, skala tipografi, state, fokus, target navigasi/daftar isi 48px, tema gelap, reduced motion dan empat breakpoint transisi mengikuti token/panduan. Build menolak token tidak terdefinisi. Instruksi identitas menjelaskan bahwa AI memilih identitas/foto, sedangkan template kode membentuk layout.

Suite lengkap: **625 tes frontend dan 402 tes backend lulus**; typecheck frontend/server serta build produksi lulus. Setelah penyesuaian CSS terakhir, 19 tes generator dijalankan ulang dan lulus. Browser memeriksa 35 kombinasi halaman/tema/bahasa/lebar: beranda, artikel, kategori dan Tentang; Indonesia dan Arab RTL; terang/gelap; 360/600/840/1200/1600px, tanpa overflow halaman. Fokus keyboard memiliki outline 3px. Pasangan teks/container diuji pada enam warna sumber dalam kedua skema. Fixture bersifat lokal di luar data aplikasi, tanpa OpenAI nyata atau deployment; ini belum mengukur Core Web Vitals lapangan.

## Tugas SEO dan penyederhanaan UI — 5 Oktober 2026

Semua 11 peran bawaan memiliki runner: sembilan memakai OpenAI, Orchestrator dan Deploy & Monitor memakai kode. Research/SERPs, arsitektur, audit/refresh, usulan internal link, analisis, visual SVG dan Digital PR tersedia sebagai tugas draft di Research and SEO. Hasil review tidak mengubah artikel atau mengirim outreach. Strategi yang direview diberikan kepada Content Writer.

Suite lengkap terbaru: **628 tes frontend dan 411 tes backend lulus**. Tes tugas SEO menggunakan direktori sementara, OpenAI/DataForSEO tiruan dan snapshot GSC lokal: biaya, role, JSON, tautan kontekstual, SVG aman, pemulihan antrean setelah restart, penolakan hasil pada domain berubah dan konteks strategi ditinjau telah diuji. Pengamatan HTTP/HTML dan penolakan IP privat diuji secara deterministik. Ini tidak memverifikasi hasil model nyata, layanan eksternal, full crawl, indexing atau CWV lapangan.

Teks utama dipendekkan; rincian harga, koneksi, anggaran dan backup berada dalam details tertutup. Blok note/lede/Info dan deskripsi utama mengikuti lebar container. Browser memeriksa Integrations, Settings dan tugas SEO dalam fixture sementara pada 360/600/840/1200/1600px; tidak ditemukan overflow halaman. Note Settings termasuk Reset workspace mengikuti lebar section (1120px pada viewport 1440px). Formulir tugas tetap menolak run tanpa koneksi OpenAI. Fixture dihapus setelah pemeriksaan dan tidak ditulis ke database pengguna.

Pemeriksa bukti skill lulus untuk 14 paket, dengan 12 evidence.json historis yang dipulihkan. Ini memverifikasi ID rujukan; arsip sumber lengkap dan validasi ulang seluruh kutipan tidak tersedia. Lihat SKILL-SOURCES.md untuk batas pemeriksaan. Backup otomatis tetap dinonaktifkan.

Typecheck frontend dan server serta build produksi lulus. Server lokal dimulai ulang, health 200, bundle baru `index-C1Ku18Wb.js` tersaji. Pemeriksaan database baca-saja: requests/articles/seo_tasks/job_runs/site_builds masing-masing 0; backup ZIP 0 dan automatic backup false. Tidak ada job nyata atau deployment yang dijalankan saat validasi ini.

## Team and roles — koreksi grid tablet, 5 Oktober 2026

Baris tunggal dalam tabel kartu sekarang membentang seluruh grid, termasuk tabel lebar tujuh kolom. Frame/latar luar tabel dinonaktifkan pada mode kartu agar tidak meninggalkan bidang putih kosong. Tombol People dan sesi dapat membungkus tanpa mengubah izin pengguna. Teks penjelasan singkat tetap digunakan.

65 tes terkait system/empty/polish lulus, typecheck frontend dan build produksi lulus. Browser memeriksa satu anggota/sesi pada 768px (baris dan container sama-sama 720px), tiga anggota pada 360/600/768/840/1200/1600px tanpa overflow halaman, serta satu record tujuh kolom pada 1000px (baris/container 952px tanpa frame). Fixture dan server QA dihapus/dihentikan setelah pemeriksaan; tidak ada akun atau sesi pengguna yang diubah. Server lokal menyajikan bundle baru.

## Avatar agen dan dekorasi Office — 5 Oktober 2026

Tanaman, jendela dekoratif, meja, kursi, laptop dan cangkir dihapus dari ilustrasi Office. Header ringkas mempertahankan jam. Komponen SVG `AgentAvatar` dipakai bersama oleh Office Dashboard, Office terpisah, kartu, detail agen dan Models and skills. Sebelas peran memiliki warna dan emblem masing-masing; ekspresi dan pose mengikuti status agen. Gerakan working mematuhi reduced motion dan kontrol jeda visual yang sudah ada. Tidak ada aset jarak jauh atau panggilan AI untuk avatar.

Suite frontend lengkap: **628 tes lulus**; typecheck frontend dan build produksi lulus. Browser memeriksa Office pada 360/600/840/1200/1600px tanpa overflow halaman, sebelas avatar idle, nol elemen furniture/dekorasi lama, serta Office terpisah. Working/approval/idle/error/off diperiksa dalam tema gelap. Kartu dan detail menggunakan portrait yang sama; 24 ID gradient pada 12 portrait unik. Fixture hanya memakai state pengujian terisolasi; berkas dan server QA dihapus/dihentikan setelah pemeriksaan. Data pengguna tidak diubah. Backend tidak berubah dan suite backend tidak dijalankan ulang untuk perubahan visual ini. Server lokal memberikan HTTP 200 untuk health, halaman utama dan bundle baru `index-5DI2U_wf.js`.

## Perilaku avatar — 5 Oktober 2026

Avatar idle bergantian menyeruput kopi dan melamun, karena status idle ditempatkan di Break room. Fase animasi berbeda antarwarna agen. Approval mengangkat tangan dan melambai; limit/kuota API pada error memakai mata spiral, kepala bergoyang dan bintang. Pesan HTTP 429, rate limit dan kuota diperiksa dari alasan kegagalan yang sudah tersedia; budget harian, kunci hilang dan timeout tidak diperlakukan sebagai limit API. Pesan kegagalan lama tidak memengaruhi job baru. Animasi hanya dekorasi SVG/CSS, tanpa status/job/timer backend tambahan, cangkir menjadi prop avatar tanpa meja atau tanaman.

Suite frontend lengkap **631 tes lulus**, termasuk tiga tes pemetaan kegagalan/status. Typecheck frontend dan build produksi lulus. Browser memeriksa pose kopi/lamunan/limit/approval/working dalam terang dan gelap, perubahan transform selama animasi aktif, portrait, serta 11 agen Break room pada 360/600/840/1200/1600px tanpa overflow halaman. Jeda visual menghasilkan nol animasi aktif pada semua elemen avatar; CSS reduced motion menonaktifkan seluruh animasi turunannya. Fixture dan server QA dihapus/dihentikan. Data pengguna dan backend tidak diubah; tidak ada permintaan API sungguhan. Server lokal menyajikan bundle `index-qAHQyyL3.js`, dengan HTTP 200 untuk health, halaman utama dan bundle.


## Codex lokal dan pilot Ruang Seduh — 5 Oktober 2026

Adaptor pribadi `server/codex-local.ts` memakai login ChatGPT CLI resmi yang sudah tersedia. `./start-codex.sh` memilih mode secara eksplisit; startup API tetap menjadi bawaan. CLI memakai folder sementara kosong, read-only sandbox, tanpa shell/commands, apps, MCP atau subagent; web hanya diaktifkan oleh kebutuhan tugas. Variabel API key tidak diwariskan, berkas autentikasi tidak dibaca/disalin, output proses dibatasi dan raw diagnostics tidak ditampilkan. Timeout/pembatalan menghentikan kelompok proses. Status Ready memeriksa instalasi/login, bukan menjamin inference atau kuota. Model runtime dan asal engine dicatat pada job serta ledger; token Codex tidak diberi harga API.

Pemeriksaan yang dijalankan: **637 tes frontend dan 415 tes backend lulus**, typecheck frontend/server serta build produksi lulus. Setelah perubahan terakhir pada guard ledger dan disclosure draft, 34 tes engine/writer/adaptor dijalankan ulang dan lulus. Empat tes adaptor memakai CLI tiruan terisolasi untuk args, JSONL/UTF-8, lingkungan tanpa API key, batas waktu, pembatalan dan redaksi galat. Uji API tetap memakai HTTP tiruan. Bundle akhir frontend `index-Dnp_jwV8.js`.

Bukti nyata yang berbeda dari tes otomatis:

- Codex CLI 0.160.0 melalui autentikasi ChatGPT berhasil mengembalikan JSON dalam smoke test tanpa alat.
- Workspace nyata yang sebelumnya kosong kini menyimpan satu situs pilot `xudotrailer.us`, Indonesia/Indonesian. Tidak ada data demo atau akun tambahan yang dibuat.
- Strategi editorial selesai (task 1), riset keyword selesai (request 3, 13 usulan), artikel selesai (article 3, status review), serta pencarian/penilaian satu foto selesai. Engine tercatat `codex-local`, model runtime `gpt-6.1-sol`. Ini panggilan inference nyata; bukan fixture. Usulan keyword tidak memuat volume/difficulty yang diukur.
- Tiga sumber resep dibuka kembali untuk memeriksa klaim utama: Beaneka Tubruk Guide, Kopi Aroma Tips, NESCAFÉ Cara Membuat Kopi Tubruk. Tidak ada uji rasa langsung. Foto Wikimedia Commons mencantumkan Gunawan Kartapranata dan CC BY-SA 3.0.
- Salinan review lokal di `http://localhost:4399` dirender dengan generator Meridian dari draft nyata dan foto, tanpa mengubah approval database. Brand/warna/label dipilih untuk salinan ini, bukan hasil job identitas normal Site Builder. Salinan diberi banner draft/noindex, tanpa structured data yang mengklaim tanggal publikasi; bukan build produksi yang dapat di-deploy dari Meridian. Generator asli memberikan nol galat untuk 17 berkas. Empat halaman pada 360/600/840/1200/1600px memiliki satu h1, bahasa id, gambar termuat dan tidak memiliki overflow horizontal (20 kombinasi).
- Melalui Chrome pemilik, Cloudflare Pages Direct Upload project `ruang-seduh-meridian` dibuat tanpa deployment; DNS TXT membuktikan kepemilikan. Domain apex dipasangkan melalui Custom domains, CNAME dibuat otomatis, dashboard menunjukkan Active dan SSL enabled. Tidak ada token Cloudflare/GitHub baru atau VPS yang diperlukan.

**Status sebelum persetujuan manusia (digantikan catatan publikasi di bawah):** review bahasa/approval artikel oleh manusia, build normal Site Builder dan keputusan build, upload publik pertama, pemeriksaan isi/HTTP setelah deployment, akses dari jaringan Indonesia, rollback nyata, Search Console/GA4, indexing dan hasil SEO. Pada saat pencatatan domain memberi HTTP 522 karena belum ada deployment; itu bukan bukti situs sudah live. Status deploy Meridian tidak dipalsukan untuk tindakan manual di Cloudflare. Domain .us dipakai untuk pilot sesuai pilihan pemilik; tidak dianggap domain Indonesia.

Server Meridian tetap hidup pada port 4310 dalam mode Codex lokal; server salinan review pada port 4399, keduanya hanya localhost. Backup otomatis tetap off. Hasil kerja pilot merupakan data nyata dan dipertahankan.


### Pilot sudah diterbitkan — 5 Oktober 2026, 15:30 UTC+7

Pemilik mengonfirmasi telah membaca dan menyetujui artikel serta beranda, lalu meminta publikasi. Berdasarkan konfirmasi itu, review bahasa dicatat melalui UI. Disclosure diperbarui melalui editor agar menjelaskan proses AI lalu review manusia yang benar-benar terjadi; isi artikel dan sumber tetap. Pengubahan disclosure membatalkan review lama sesuai aturan editor, kemudian review dicatat kembali berdasarkan konfirmasi pemilik dan artikel disetujui. Terjemahan lama diberi penanda stale. Disclosure kini dapat diedit melalui jalur validasi dan audit normal; teks kosong/lebih dari 1.000 karakter ditolak. Kredit foto menyebut penyesuaian ukuran/encoding selain sumber, penulis dan lisensi.

Site Builder normal dijalankan melalui UI dengan Codex lokal: build 4, versi 1, 17 berkas/455.729 byte, satu artikel, 5 halaman termasuk 404. Nama Ruang Seduh, warna, font dan label dihasilkan job identitas nyata, bukan identitas salinan review sebelumnya. Build disetujui sesuai instruksi publikasi, ZIP diunduh dari Meridian dan diperiksa agar hanya berisi situs statis. Cloudflare Pages Direct Upload menerima 17/17 berkas dan menampilkan Success. Pemilih berkas native Chrome digunakan karena ekstensi belum diberi akses file URLs; tidak ada perluasan izin ekstensi, API token baru, VPS atau biaya API yang dikonfigurasikan.

Hasil publik pada **https://xudotrailer.us/**:

- Beranda, artikel, kategori, tentang, robots, sitemap, CSS, foto dan ikon termuat; semua 16 berkas yang disajikan identik byte-per-byte dengan ZIP build yang disetujui (`_headers` adalah konfigurasi host, tidak disajikan sebagai aset).
- HTTPS valid, halaman utama/artikel HTTP 200; HTTP dialihkan ke HTTPS; URL yang tidak ada HTTP 404 dengan halaman 404 situs.
- Canonical dan sitemap menggunakan domain xudotrailer.us; robots mengizinkan crawl. Disclosure pembaca mencatat proses review manusia. Tidak ada banner draft/noindex dari salinan review lokal yang dipublikasikan.
- Empat halaman pada 360/600/840/1200/1600px: satu h1, bahasa id, tidak ada overflow horizontal dan tidak ada gambar rusak (20 kombinasi). Ini pemeriksaan layout, bukan pengukuran Core Web Vitals lapangan.
- Check now Meridian berhasil dari Media Sarana Data/Yogyakarta, Jujur Amanah Barokah/Garut dan Wow Internet Indonesia/Jakarta: DNS Normal, HTTPS 200, Reachable. Ini bukti tiga probe saat pemeriksaan, bukan jaminan semua jaringan selamanya.
- Ledger menyimpan enam panggilan inference nyata berhasil, 378.467 token, engine codex-local, model gpt-6.1-sol. Token memakai batas akun ChatGPT, tidak diberi tarif API.

Setelah perubahan publikasi: 36 tes backend generator/editor dan 29 tes frontend editing/review lulus, typecheck server serta build produksi frontend lulus. Bundle akhir frontend `index-DbKzZ5QP.js`. Tes penuh 637 frontend/415 backend di atas adalah hasil sebelum perubahan publikasi, bukan klaim jumlah tes terbaru.

Batas yang masih berlaku: Search Console/GA4 belum terhubung; indexing, traffic/ranking, rollback publik nyata dan kualitas rasa kopi belum diuji. Publikasi lewat dashboard Cloudflare belum dicatat oleh deploy API Meridian, sehingga build internal tetap Approved/Not deployed dan situs Never deployed di sana. Tidak mengubah database untuk berpura-pura bahwa integrasi API melakukan deploy. Domain .us dipakai sebagai pilot sesuai domain pemilik. Server salinan review localhost:4399 dihentikan setelah publikasi. Server Meridian tetap localhost:4310 mode Codex lokal; situs statis aktif terus di Cloudflare ketika Mac/server dimatikan. Backup otomatis tetap off.

Bukti tersimpan pada outputs thread: `ruang-seduh-v1.zip`, `ruang-seduh-public-checks.json`, `ruang-seduh-live-layout-checks.json`, `ruang-seduh-flow-proof.json`, `ruang-seduh-live.png` dan `ruang-seduh-article-live.png`.
