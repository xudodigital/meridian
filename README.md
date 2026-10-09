# Meridian

Ruang kendali untuk agen AI yang menjalankan situs SEO, satu situs per negara. Tidak ada yang dipublikasikan tanpa persetujuan manusia.

Versi ini berjalan di komputer sendiri (`localhost`).

## Menjalankan

```bash
./start.sh
```

Lalu buka http://localhost:4310. Skrip itu memasang paket dan membangun aplikasi bila perlu. Hentikan dengan Ctrl+C. Port bisa diganti: `PORT=5000 ./start.sh`.

Untuk pilot pribadi tanpa API key, masuk ke Codex CLI resmi menggunakan ChatGPT, lalu jalankan **`./start-codex.sh`**. Meridian memakai login CLI yang sudah ada; tidak membaca atau menyalin berkas autentikasi. Mode ini memakai batas penggunaan ChatGPT/Codex. Jangan menjalankan dua server pada folder data yang sama.

### Gemma 4 di localhost (Ollama)

Meridian mendukung **Gemma localhost**, **Codex local**, dan **OpenAI API** sebagai pilihan eksplisit di **Integrations > Agent engine**. Codex Local tetap tersedia; pilihan model OpenAI setiap Agent disimpan untuk dipakai kembali saat mode API dipilih. Pilihan dari dashboard tersimpan setelah restart dan mengungguli `MERIDIAN_ENGINE` sebagai nilai awal. Pergantian mesin/model ditolak selama pekerjaan masih berjalan atau mengantre. Tidak ada fallback otomatis.

1. Pasang Ollama dan Gemma pada **PC yang sama dengan server Meridian**. Pada PC tersebut, jalankan `ollama pull gemma4:31b`, lalu pastikan Ollama berjalan. Perintah ini **mengunduh model besar**; Meridian tidak menjalankannya otomatis. Panduan resmi: [Gemma 4 di Ollama](https://ollama.com/library/gemma4).
2. Jalankan Meridian seperti biasa. Buka **Integrations > Gemma localhost > Connect**, isi URL `http://127.0.0.1:11434`, model `gemma4:31b`, dan context size (bawaan 32768), lalu **Save and test**. Tes hanya memeriksa model yang terpasang dan versi runtime.
3. Pilih **Gemma localhost (Ollama)** pada **Agent engine**. Status siap membutuhkan model dengan kemampuan teks. Pekerjaan yang membutuhkan gambar atau tools juga memeriksa kemampuan tersebut sebelum dijalankan. Endpoint hanya menerima loopback HTTP; tag/model cloud ditolak.
4. Konfigurasi awal alternatif: `MERIDIAN_ENGINE=gemma-local`, `MERIDIAN_OLLAMA_URL=http://127.0.0.1:11434`, `MERIDIAN_GEMMA_MODEL=gemma4:31b`, dan `MERIDIAN_GEMMA_CONTEXT=32768`. Nilai yang disimpan melalui UI diutamakan. Tetap jalankan **satu server per folder data**.

Adaptor menggunakan [API chat Ollama](https://docs.ollama.com/api/chat), JSON, input gambar yang sudah diperiksa, skill yang sama, timeout dan pembatalan. Token berasal dari `prompt_eval_count` dan `eval_count`; biaya inferensi lokal tidak diberi tarif API. Metrik biaya/API dan model berharga disembunyikan pada dashboard ketika Gemma atau Codex lokal dipilih. Catatan historis tetap ada. Anggaran tetap berlaku pada mode API atau ketika DataForSEO terhubung; tanpa layanan tersebut, biaya API historis tidak menahan pekerjaan lokal.

**Sumber dan batasan:** Gemma tidak mendapat pencarian web bawaan. Pekerjaan yang memerlukan sumber dapat memakai tool baca halaman HTTPS publik (maksimal 8 panggilan); alamat privat, kredensial URL dan scraping pencarian ditolak. Sumber harus benar-benar terbaca dan kutipannya harus sesuai URL yang dibaca, tetapi kebenaran klaim tetap perlu diperiksa manusia. JavaScript, PDF, halaman login/paywall tidak didukung tool ini. Cantumkan URL sumber pada permintaan atau pilih Codex Local untuk pencarian web. Riset SERP membutuhkan SerpApi, SearchAPI.io atau DataForSEO; volume keyword memakai Google Ads langsung atau DataForSEO; GSC/GA4 tetap diperlukan untuk metrik situs. Pemilihan gambar tetap melalui Wikimedia Commons, bukan gambar yang dikarang model.

Context size, kecepatan, RAM/VRAM dan kualitas bahasa harus diuji pada hardware serta kuantisasi yang dipakai. Context yang hampir penuh atau jawaban terpotong dihentikan; ini bukan jaminan seluruh model/kuantisasi mempunyai perilaku identik. Review manusia, approval build, serta deployment Cloudflare tetap memakai alur yang sama. Pengujian otomatis adapter memakai server Ollama tiruan yang terisolasi; kelulusannya bukan bukti benchmark atau demonstrasi nyata Gemma 31B.


## Akun

Saat pertama dibuka (belum ada akun), Meridian menampilkan **Create the owner account**: nama, email, kata sandi (minimal 12 karakter) dan konfirmasinya. Akun pertama ini adalah admin. Setelah itu akun baru hanya lewat undangan.

- **Undangan**: admin membuka Team and roles, Invite person, lalu memilih email, peran, dan (untuk native reviewer) satu situs. Meridian tidak mengirim email: aplikasi menampilkan tautan sekali pakai `http://localhost:4310/invite/...` (berlaku 7 hari) dengan tombol Copy, dan admin sendiri yang membagikannya. Orang itu membuka tautan, mengisi nama dan kata sandi, lalu langsung masuk.
- **Peran**: Admin (semua), Editor (semua kecuali Team, Integrations, Settings, dan reset), Native reviewer (hanya Article review untuk situsnya), Viewer (hanya membaca). Aturan ini dijaga server, bukan hanya tampilan. Admin bisa mengubah peran, menonaktifkan, menghapus orang, mencabut undangan, dan mereset 2-step orang lain; admin terakhir tidak bisa dihapus atau diturunkan, dan tidak ada yang bisa melakukannya pada dirinya sendiri.
- **2-step verification**: menu akun, 2-step verification, pindai QR code dengan aplikasi authenticator, masukkan kodenya, lalu simpan 10 recovery code (hanya ditampilkan sekali). Bila Settings, "Require a 2-step verification code at sign-in" dinyalakan, setiap orang tanpa 2-step wajib memasangnya tepat setelah masuk.
- **Sesi**: cookie HttpOnly; keluar otomatis setelah waktu diam yang dipilih di Settings, paling lama 30 hari. Settings, Sign-in security menampilkan sesi Anda sendiri, dengan Sign out per sesi dan "Sign out other sessions".
- **Keamanan masuk**: kata sandi di-hash dengan scrypt; pesan salah sama untuk email tak dikenal dan kata sandi salah; terlalu banyak percobaan gagal mengunci sementara (5 menit).
- **Lupa kata sandi**: ada dua jalan, keduanya memakai tautan sekali pakai `http://localhost:4310/reset/...` yang berlaku 30 menit (server hanya menyimpan hash-nya).
  - *Lewat email*: bila Email (SMTP) sudah terhubung di Integrations, layar Sign in menampilkan "Forgot your password?". Orang itu mengisi emailnya dan Meridian mengirim tautannya. Jawaban layar selalu sama, baik email itu punya akun maupun tidak, dan jumlah email dibatasi (3 per akun, lalu satu tiap 20 menit).
  - *Lewat admin*: di Team and roles, tombol "Reset password" pada baris orang itu membuat tautan yang ditampilkan sekali dengan tombol Copy; admin sendiri yang membagikannya. Tidak bisa untuk diri sendiri (kata sandi sendiri diganti dari menu akun).
  - Memakai tautan itu mengganti kata sandi, mengeluarkan semua sesi orang tersebut, tercatat di audit log, dan (bila email terhubung) mengirim email pemberitahuan. 2-step verification tetap berlaku: setelah reset orang itu masuk dengan kata sandi baru dan kodenya.
  - Bila pemilik (satu-satunya admin) lupa kata sandi dan email belum terhubung, tidak ada jalan pemulihan: buat admin kedua sebagai cadangan, atau hubungkan Email (SMTP).
- **Sesi semua orang**: di Team and roles, bagian "Signed-in sessions" memperlihatkan kepada admin setiap browser yang sedang masuk (siapa, perangkat, terakhir aktif), dengan "Sign out" per sesi dan "Sign out everywhere" per orang.
- **Audit log**: bisa disaring (teks, pelaku, situs, rentang tanggal), dimuat bertahap dengan "Load more", dan diekspor sebagai CSV oleh admin dan editor. Isi sel yang diawali `=`, `+`, `-`, atau `@` diberi tanda kutip tunggal di depan, sehingga tidak dijalankan sebagai rumus oleh spreadsheet.
- **Notifikasi lonceng**: selain hasil pekerjaan agen, lonceng kini menampilkan domain yang diblokir atau mati (dari access check), peringatan anggaran harian, dan laporan mingguan yang terkirim, mengikuti kolom "In-app" di Settings, Alerts.

## Mulai dari mana?

Buka **Workspace**. Bagian **Start here** menjelaskan satu langkah berikutnya berdasarkan koneksi dan pekerjaan nyata untuk situs yang dipilih:

1. **Connect OpenAI** — pada mode API, admin mengisi dan mengetes API key langsung dari Workspace. API menggunakan [billing terpisah dari ChatGPT](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform). Pada mode Codex lokal yang sudah siap, langkah ini dilewati. Pemeriksaan koneksi tidak memulai job AI.
2. **Add a site** — isi domain yang dimiliki atau direncanakan, pilih negara audiens, bahasa artikel dan topik situs. Ini menyimpan profil; tidak membeli domain, mengubah DNS atau menerbitkan situs.
3. **Find keywords** — kirim satu topik melalui formulir riset. Model dan penggunaan kuota dijelaskan sebelum dikirim. Setelah server menerima request, panduan menunjukkan progres tanpa menunggu event stream.
4. **Write an article** — buka hasil riset, pilih satu keyword, lalu konfirmasi permintaan menulis.
5. **Review the article** — baca hasil, periksa sumber dan gambar, minta revisi bila perlu, lalu selesaikan review bahasa dan approval yang diwajibkan.
6. **Preview the website** — setelah artikel disetujui, siapkan build di Build and deploy, lalu preview atau unduh ZIP. Cloudflare dan verifikasi domain diperlukan saat ingin mempublikasikan; approval build dapat langsung mengantrekan deployment jika Cloudflare sudah terhubung.

Panduan mengikuti status queued, running, failed dan ready dari server; hasil dari situs atau domain lama tidak menyelesaikan langkah situs baru. Koneksi yang gagal tetap menunjukkan alasannya. Editor dan viewer mendapatkan petunjuk meminta admin untuk konfigurasi OpenAI. Office tetap tersedia dalam bagian yang dapat dibuka, sedangkan statistik, pipeline dan aktivitas muncul setelah ada pekerjaan nyata. Pengaturan tambahan dijelaskan dalam **What do I need now, and what can wait?**. Model dan agen awal sudah dikonfigurasi; pengguna tidak perlu menambahkan agen untuk memulai.

## Menyalakan agen sungguhan

Agen menggunakan **OpenAI Responses API**. Buka **Integrations > OpenAI API > Connect**, masukkan API key dari [OpenAI Platform](https://platform.openai.com/api-keys), lalu simpan dan tes koneksinya. Kunci disimpan terenkripsi di server dan tidak dikirim kembali ke browser. Alternatif untuk proses server: variabel `OPENAI_API_KEY`. Kunci yang tersimpan di Integrations diutamakan.

Tanpa runtime yang siap, riset, artikel, dan workflow ditolak dengan petunjuk koneksi; tidak ada hasil tiruan atau perpindahan provider otomatis. Claude Code dan Gemini sudah tidak menjadi pilihan. Dalam mode API, model yang dipilih di **Models and skills** benar-benar dikirim ke API untuk job berikutnya:

| Model | Penggunaan bawaan |
|---|---|
| GPT-6 Luna (`gpt-6-luna`) | Riset keyword sederhana |
| GPT-6.1 Sol (`gpt-6.1-sol`) | Artikel dan Site Builder (foto serta identitas situs) |
| GPT-6 Astra (`gpt-6-astra`) | Opsional, dipilih manual untuk pekerjaan paling menuntut |

Request menggunakan `store: false`, urutan konteks skill stabil untuk membantu prompt caching, serta reasoning `low` (keyword/foto) atau `medium` (artikel/identitas). Artikel diberi web search dengan paling banyak 8 panggilan alat; keyword, foto, dan identitas tidak diberi alat web atau akses shell. Pratinjau gambar yang sudah diperiksa server dikirim sebagai input gambar. Penugasan 14 skill bawaan di layar berlaku pada panggilan AI berikutnya untuk Keyword, Content Writer, dan Site Builder. Panduan wajib tugas selalu ditambahkan: Keyword (keyword-research, google-seo), Writer (article-writing, google-seo), Site Builder (material-3-web, web-performance, images-and-alt-text). Agen berbasis kode dan agen Planned menyimpan penugasan sebagai rencana; entri katalog tambahan belum memuat instruksi. Riwayat versi UI memulihkan metadata katalog, bukan berkas SKILL.md.

Biaya dihitung dari penggunaan input/output dan cache yang dilaporkan API, ditambah panggilan web search. Nilainya **estimasi** berdasarkan tarif standar saat pembaruan ini, bukan tagihan final. Anggaran harian, antrean satu per satu, timeout dan pembatalan tetap berlaku. Harga perlu diperbarui jika tarif OpenAI berubah. Referensi: [Responses API](https://developers.openai.com/api/docs/guides/text), [model](https://developers.openai.com/api/docs/models/gpt-6.1-sol), dan [tarif](https://developers.openai.com/api/docs/pricing).

Saat startup, konfigurasi model lama disesuaikan ke OpenAI dan kredensial Claude/Gemini dihapus. Akun, situs, isi artikel, dan buku biaya historis dipertahankan. Tidak ada backup yang dibuat oleh penyesuaian ini.

### Codex lokal untuk pilot pribadi

`MERIDIAN_ENGINE=codex-local` memilih Codex secara eksplisit; `./start-codex.sh` menyetel variabel tersebut. Bawaan tetap API. Ini adaptor CLI pribadi pada komputer pemilik, bukan layanan autentikasi ChatGPT untuk banyak pengguna. Referensi: [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode).

Setiap panggilan memakai `codex exec --json --ephemeral --ignore-user-config` dalam folder kerja sementara kosong. Shell, eksekusi perintah, aplikasi, MCP dan subagent dinonaktifkan; web hanya aktif untuk tugas yang memang meminta riset web. Skill dan pratinjau gambar yang divalidasi diberikan secara eksplisit. Login tetap milik CLI dan variabel kredensial layanan tidak diwariskan. Pembatalan dan timeout menghentikan kelompok proses; folder kerja dibersihkan. Pemeriksaan Ready memastikan CLI/login tersedia, bukan menjamin kuota atau akses model; kegagalan inference tetap ditampilkan.

Model runtime ditampilkan terpisah dari konfigurasi API per agen. Bawaan lokal `gpt-6.1-sol`, dapat diubah saat startup dengan `MERIDIAN_CODEX_MODEL`. Token dilaporkan CLI; harga API tidak diterapkan pada token Codex. Kolom biaya nol berarti tidak ada estimasi pengeluaran API, **bukan** langganan gratis. Anggaran USD hanya membatasi biaya layanan yang dapat dihitung; tidak mengukur sisa kuota ChatGPT. Antrean, timeout, persetujuan artikel/build, serta izin pengguna tetap berlaku.

Website statis dapat diunduh dan diunggah melalui dashboard Cloudflare Pages tanpa memasukkan token Cloudflare ke Meridian. Deployment manual itu berada di luar runner deployment Meridian dan tidak otomatis mengisi status Live di dashboard.

### Skill Site Builder dan hasil website

`shared/agent-skills.ts` memetakan ID skill bawaan ke direktori yang diizinkan. `server/agent-skills.ts` membaca penugasan tersimpan pada setiap panggilan AI; `server/skill-files.ts` membaca SKILL.md dan referensi Markdown/CSS terkini tanpa cache permanen. Nama katalog tidak menjadi path, symlink keluar folder ditolak, dan arsip sumber tidak dikirim. Referensi Gemini dan harga lama milik skill orchestration tidak dimuat dalam runtime OpenAI ini. Skill tidak memberi izin alat tambahan atau melewati persetujuan publikasi.

Site Builder meminta AI memilih identitas dan foto. Layout dirender oleh `server/sitebuild.ts`, bukan oleh jawaban identitas AI. Generator memakai `skills/material-3-web/references/tokens.css` secara langsung, ditimpa skema HCT terang/gelap, font dan tinggi baris bahasa dari `server/theme.ts`. Token ukuran huruf, sudut, motion dan state berasal dari lapisan tersebut; navigasi/daftar isi mempunyai target 48px. Perubahan template diterapkan pada **build baru**, bukan mengubah website yang sudah terbit. `checkSite` menolak token yang tidak terdefinisi, uppercase UI dan tidak adanya reduced motion, selain pemeriksaan struktur berkas/SEO sebelumnya. Pemeriksaan ini tidak membuktikan Core Web Vitals lapangan.

## Teknologi

| Bagian | Teknologi |
|---|---|
| Antarmuka (`app/`) | React 19, TypeScript 7, Vite 8, Tailwind CSS 4, TanStack Router, TanStack Query, Zustand |
| Server (`server/`) | Node.js 24, TypeScript dijalankan langsung oleh Node, tanpa paket npm |
| Database | SQLite bawaan Node (`data/meridian.db`) |
| Agen | OpenAI Responses API, Codex CLI lokal, atau Gemma localhost/Ollama yang dipilih secara eksplisit |
| Uji | Vitest (aturan, akun, sinkronisasi workspace, artikel, dan setiap layar) dan test runner bawaan Node untuk server (akun, sesi, 2-step, undangan, peran, workspace, job; dengan HTTP OpenAI tiruan) |

Desain (Material Design 3 Expressive, tema terang dan gelap) dibawa dari prototipe; kodenya ditulis ulang.

## Data: kosong secara bawaan, semuanya di server

Meridian mulai dalam keadaan kosong: tidak ada situs, artikel, deploy, angka analitik, atau aktivitas agen yang dikarang. Yang ada sejak awal hanya konfigurasi: 11 peran agen, skill, dan daftar integrasi.

| Bagian | Status |
|---|---|
| Research and SEO, tab Keywords: New research request | Sungguhan. Disimpan di database server, dikerjakan agen Keyword lewat OpenAI Responses API |
| Hasil riset keyword: Write article, lalu Article review | Sungguhan. Agen Content Writer menulis artikel lewat OpenAI Responses API, lalu manusia memutuskan: Approve, Request revision, atau Reject |
| Situs, agen, skill, jadwal, pengaturan, mode review, preferensi notifikasi | Tersimpan di database server dan tersinkron ke semua browser yang terbuka |
| Audit log | Ditulis server, dengan nama orang dari sesinya. Tidak bisa diubah atau dihapus lewat API |
| Run history | Langkah tiap job dengan waktu sungguhan dari server |
| Integrations: kunci API dan Test connection | Sungguhan. Disimpan terenkripsi di server, langsung dites ke layanan aslinya (lihat di bawah) |
| Build and deploy: cek akses per negara | Sungguhan, lewat jaringan probe Globalping dari dalam negara target. Situs berstatus live dicek ulang tiap 6 jam |
| Sites: verifikasi kepemilikan domain | Sungguhan, lewat rekaman DNS TXT `_meridian.<domain>` |
| Reports: Send now dan pengiriman terjadwal | Sungguhan, lewat email (SMTP) dengan lampiran CSV |
| Settings: peringatan Email, Slack, Telegram | Sungguhan, dengan jam tenang |
| Analytics, tab Search Console | Setelah Search Console disambungkan lewat Google: total per situs, grafik klik harian, halaman dan kueri teratas 28 hari terakhir (diambil sekali sehari, disimpan 16 bulan) |
| Analytics, tab GA4 | Setelah Google Analytics 4 disambungkan: properti dicocokkan ke situs lewat domain (atau dipilih sendiri di tab itu), lalu users, sessions, dan engaged sessions per hari dan per halaman |
| Analytics, tab Rank | Posisi kata kunci yang dilacak (kata kunci artikel yang sudah di-approve, dan kata kunci riset yang ditandai Track) dari data Search Console: posisi sekarang, perubahan 7 dan 28 hari, halaman terbaik. Meridian tidak pernah mengirim kueri ke Google untuk mengecek peringkat |
| Keywords: volume pencarian | Setelah agen Keyword selesai, server mengambil volume melalui Google Ads jika tersambung, atau DataForSEO. Sumber, waktu, negara dan bahasa pengambilan disimpan. Tanpa keduanya kolom Volume tidak ditampilkan |
| Article review: foto | Sungguhan. Site Builder memilih foto berlisensi terbuka dari Wikimedia Commons, lengkap dengan alt text, keterangan, dan kredit |
| Build and deploy: website | Sungguhan. Artikel yang sudah di-approve dirakit menjadi situs statis, bisa di-preview dan diunduh sebagai ZIP, lalu di-approve dan dideploy ke Cloudflare Pages |
| Workspace | Agen bergerak sesuai pekerjaan nyata: langkah yang sedang dikerjakan, dokumen yang berpindah antar-agen, dan tanda selesai |
| Eksperimen | Kosong sampai sumber datanya dibangun |

**Office di tab sendiri dan layar penuh.** Di Workspace, tampilan Office punya tombol **Open in new tab** (membuka `/office`: hanya kantor agen, ringkasan langsung, dan 3 aktivitas terbaru, tanpa menu samping) dan **Full screen**. Di halaman `/office`, tombol **Full screen** atau tombol **F** membuat layar penuh, cocok untuk TV di dinding: setelah 3 detik tanpa gerakan, header dan kursor disembunyikan, dan layar dijaga tetap menyala (Screen Wake Lock, bila browser mendukung). Esc keluar dari layar penuh. Batas waktu sign-out karena tidak aktif (Settings) tetap berlaku, paling lama 8 jam.

Hanya tema dan tampilan Workspace (Cards/Office) yang disimpan di browser. Data lama di browser dari versi sebelumnya dihapus otomatis.

**Mode demo telah dihapus.** Aplikasi menampilkan data server yang nyata. Preferensi demo lama dibersihkan otomatis saat halaman dimuat. Situs contoh, artikel, angka aktivitas, notifikasi, serta log simulasi tidak dimuat dalam build produksi. Fixture contoh hanya dipakai oleh pengujian terisolasi.

**Reset workspace** (Settings, khusus admin, ketik RESET untuk konfirmasi) mengembalikan situs, jadwal, pengaturan, perubahan agen, skill tambahan, dan audit log ke awal untuk semua orang. Akun, hasil riset, dan artikel tidak dihapus.

Volume pencarian berasal dari Google Ads langsung atau DataForSEO (lihat tabel di atas); keyword difficulty tidak ditampilkan karena tidak ada sumber datanya. Agen dilarang mengarang kedua angka itu. Tombol **Refresh volumes** di hasil riset mengambil ulang volumenya, dan kotak **Track** memasukkan kata kunci ke pelacakan peringkat. Di Build and deploy, setiap deploy mendapat "Rank" (rata-rata perubahan posisi kata kunci yang dilacak, 7 hari sesudah deploy dibanding 7 hari sebelumnya) begitu Search Console punya datanya.

## Tugas SEO spesialis

Di **Research and SEO > Research / SEO**, pilih situs, jenis tugas dan brief, lalu **Run this task**. Tugas tidak dimulai hanya karena halaman dibuka.

| Tugas | Agen | Prasyarat |
|---|---|---|
| Strategi editorial | Research | Profil situs dan OpenAI |
| SERP satu kueri | Research | Engine yang dipilih (Codex Local, Gemma localhost atau OpenAI) dan SerpApi/SearchAPI.io/DataForSEO; negara/bahasa situs dipakai eksplisit |
| Arsitektur situs | Architect | Profil situs dan OpenAI |
| Audit konten / refresh | SEO/GEO Optimizer | Artikel review atau approved |
| Usulan internal link | Internal Linker | Artikel review atau approved; anchor berasal dari paragraf yang sudah ada |
| Analisis kinerja | Analyst | Snapshot Search Console atau GA4 yang dapat digunakan |
| Rencana infografik + SVG | Graphic Designer | Artikel review atau approved |
| Digital PR | Research | Artikel review atau approved; hanya aset/pitch draft |

Antrean `seo-task` memakai batas antrean dan anggaran yang sama dengan job lainnya. Hasil, snapshot bukti, biaya dan status tersimpan di `seo_tasks`; data SERP tidak diambil dengan scraping Google. Hasil antrean dapat dipulihkan setelah restart. Office dan Runs mengikuti status nyata setiap spesialis.

**Hasil adalah draft.** Tombol **I have reviewed this draft** mencatat review; tidak menerapkan perubahan artikel atau mengirim outreach. Strategi yang ditinjau menjadi konteks penulisan artikel berikutnya untuk situs/domain itu. Usulan lain diterapkan melalui editor artikel/kategori, lalu review dan build kembali. Infografik memakai markup SVG tetap dengan teks yang di-escape, bukan XML dari model.

Audit publik opsional mengamati paling banyak 10 URL HTTPS pada domain situs, termasuk robots.txt dan sitemap.xml. DNS diverifikasi sebagai alamat publik dan koneksi dipin ke hasil tersebut; redirect tidak diikuti. Ini observasi HTTP/HTML terbatas, bukan full crawl, bukti indexing, pengukuran Core Web Vitals lapangan atau inspeksi URL Google. Data analitik berasal dari snapshot yang tersedia dan menyertakan batas cakupan/kesegarannya.

Belum ada integrasi GBP, Merchant Center, feed backlink, pengiriman outreach, konversi bisnis lengkap atau laporan AI Search khusus melalui API. Fitur industri tersebut dipilih berdasarkan kebutuhan situs; Meridian tidak menganggap semuanya sudah lengkap.

Skill dan bukti: lihat `docs/SKILL-SOURCES.md`. Jalankan `./.tools/node/bin/node scripts/check-skills.mjs` untuk memeriksa resolusi ID bukti.

## Dari artikel ke website

1. **Foto.** Setelah Content Writer selesai menulis, Site Builder otomatis mencari foto di Wikimedia Commons. Tombol "Find photos" di Article review juga bisa dipakai.
   - Hanya lisensi CC0, domain publik, CC BY, dan CC BY-SA yang dipakai.
   - Foto dengan hak personalitas, merek dagang, NC, ND, atau tanpa lisensi ditolak.
   - Site Builder melihat pratinjau setiap foto sebelum memilih, lalu menulis alt text dan keterangan dalam bahasa situs.
   - Foto disimpan di `data/media/` dalam lebar 960 dan 1280 px. Setiap foto bisa dihapus.
2. **Website.** Di Build and deploy, "Build website" merakit semua artikel yang sudah di-approve menjadi situs statis. Isinya:
   - beranda, halaman artikel, "Tentang kami", dan 404;
   - sitemap.xml (dengan entri gambar), robots.txt, favicon, dan data terstruktur BlogPosting, BreadcrumbList, dan WebSite;
   - tema Material 3 dari satu warna sumber, dengan mode gelap;
   - tanpa JavaScript dan tanpa font eksternal.

   Saat build pertama, Site Builder memilih nama situs, tagline, warna, dan label dalam bahasa situs. Pilihan itu dipakai lagi untuk build berikutnya. Setiap kredit foto memuat judul, pembuat, sumber, dan tautan lisensi.
3. **Preview dan approval.** "Preview" membuka situs persis seperti hasil akhirnya. "Download ZIP" memberi seluruh berkasnya, siap diunggah ke hosting statis mana pun. "Approve" atau "Reject" (dengan catatan) adalah keputusan manusia, dan tercatat di audit log.
4. **Deploy.** Bila Cloudflare terhubung, versi yang di-approve langsung diunggah ke Cloudflare Pages lewat Direct Upload, dengan hash BLAKE3 persis seperti wrangler. Syaratnya: token dengan izin "Account > Cloudflare Pages > Edit" dan Account ID. Versi lama bisa dideploy ulang sebagai rollback.
5. **Domain sendiri.** Setelah deploy pertama berhasil, Meridian memasang domain situs ke proyek Pages itu dan menampilkan langkah "Domain" di kartu Website: Not attached, Waiting for DNS, Issuing certificate, lalu Live on https://domain.
   - Bila zone domain ada di akun Cloudflare yang sama dan token punya izin "Zone > Zone > Read" dan "Zone > DNS > Edit", Meridian sendiri membuat rekaman CNAME (proxied) ke `<proyek>.pages.dev`.
   - Bila DNS dikelola di tempat lain (atau token tidak boleh mengubah DNS), kartu menampilkan rekaman persis yang harus Anda tambahkan, lalu tekan "Check again".
   - Meridian tidak pernah menimpa atau menghapus rekaman DNS yang bukan buatannya: rekaman lain pada nama yang sama dilaporkan, lalu Meridian berhenti sampai Anda memperbaikinya.
   - Validasi dan sertifikat dicek di latar belakang sampai 24 jam, dan pengecekan itu berlanjut setelah server dinyalakan ulang.
   - Begitu Cloudflare menyatakan domain aktif dan situs menjawab lewat HTTPS dari komputer ini, status situs menjadi Live, cek akses pertama dari negara target dijalankan, dan cek ulang tiap 6 jam mulai berlaku. Selama baru ada di `*.pages.dev`, situs tetap "Being set up" (alamat pages.dev sudah bisa dibuka).
   - Rollback dan deploy ulang tidak mengubah domain. Menghapus situs dari Meridian tidak menghapus proyek Pages, domain, atau rekaman DNS di Cloudflare.

Semua pekerjaan ini berjalan satu per satu di antrean yang sama dengan riset dan penulisan. Setiap pekerjaan terlihat di Workspace (tampilan Office): agen pindah ke ruang kerja, menampilkan langkahnya, menyerahkan dokumen ke agen berikutnya, lalu menampilkan tanda selesai.

## Workflow dan jadwal

Tab Workflows di Build and deploy menjalankan urutan tetap untuk satu situs. **Weekly content**: riset keyword (topik situs, atau topik jadwalnya), lalu artikel untuk N keyword terbaik yang belum punya artikel (1 sampai 5, bawaan 2; menurut volume pencarian bila ada, selain itu menurut urutan agen Keyword), menunggu review Anda (approve atau reject mengakhiri bagian artikel itu), build website begitu semua artikel diputuskan dan minimal satu di-approve, menunggu approval build, lalu deploy bila Cloudflare terhubung.

- Mesinnya adalah kode biasa (`server/workflows.ts`), bukan model: Orchestrator tidak memanggil CLI dan tidak memakan biaya. Setiap pekerjaan yang diantrekannya sama dengan yang Anda mulai sendiri: lewat antrean yang sama, tercatat di buku biaya, dan berhenti di anggaran harian.
- Setiap run menampilkan langkahnya, sejak kapan, dan apa yang ditunggunya (agen, Anda, anggaran, atau antrean), dengan tautan ke artikel atau build yang menunggu. Langkah yang gagal menggagalkan run beserta alasannya. Anggaran harian yang habis menahan run ("Waiting for budget") sampai tengah malam atau sampai anggaran dinaikkan. "Cancel" menarik pekerjaan antrean yang belum mulai; pekerjaan yang sedang berjalan diselesaikan.
- **Jadwal**: tiap minggu pada hari dan jam tertentu, tiap 2 minggu, atau sebulan sekali (hari itu yang pertama dalam bulan). Jam mengikuti zona waktu negara situs (tabel kecil di `server/workflow-time.ts`; negara yang tidak ada di tabel memakai zona komputer ini). Penjadwal melihat jadwal tiap menit selama Meridian hidup; slot yang sudah ditangani dicatat lebih dulu, jadi restart tidak pernah memulai run dua kali. Run yang terlambat lebih dari 6 jam dilewati dan jadwalnya mengatakan itu. Satu situs tidak pernah punya dua run sekaligus. "Run now" memulainya saat itu juga.
- Cek akses domain bukan jadwal: server mengecek ulang situs live tiap 6 jam, dan tab ini menampilkannya sebagai baris baca-saja.

## Integrasi

Semua diisi di **Integrations** (khusus admin). Tombol **Save and test** menyimpan nilai terenkripsi (AES-256-GCM) dan langsung mengetesnya ke layanan asli. Hanya 4 karakter terakhir atau nama akun yang pernah ditampilkan lagi.

| Layanan | Yang diisi | Test connection |
|---|---|---|
| OpenAI API | API key | Mendaftar model yang bisa dipakai kunci itu |
| DataForSEO | API login dan API password | Menampilkan saldo |
| SerpApi | API key | Account API membaca sisa kuota tanpa memakai kredit pencarian |
| SearchAPI.io | API key | Account API membaca kuota; tidak menjalankan pencarian |
| Cloudflare | API token (Account > Cloudflare Pages > Edit; tambahkan Zone > Zone > Read dan Zone > DNS > Edit bila Meridian yang harus membuat rekaman DNS domain), Account ID (wajib untuk deploy) | Memeriksa token, akses ke Pages, dan menghitung zone |
| Multi-country probes (Globalping) | Token opsional. Tanpa token: 250 tes per jam | Menampilkan sisa kuota |
| Slack | Incoming webhook URL | Mengirim pesan tes ke channel |
| Telegram | Bot token dan chat ID | Mengirim pesan tes ke chat |
| Email (SMTP) | Server, port (587 STARTTLS atau 465 TLS), user, password, alamat pengirim | Mengirim email tes ke Anda |
| Google sign-in | OAuth client ID dan secret dari Google Cloud | Dipakai untuk Google Ads, Search Console dan GA4 |
| Google Ads | Customer ID, Manager Customer ID opsional, OAuth Google | Memverifikasi akses akun; tidak menjalankan pencarian keyword |
| Google Search Console, Google Analytics 4 | Connect with Google (hanya baca) | Menghitung properti yang bisa dibaca |

**Google:** di Google Cloud Console aktifkan Search Console API, Google Analytics Admin API, dan Google Analytics Data API. Lalu buat OAuth client jenis "Web application" dengan Authorized redirect URI `http://localhost:4310/api/oauth/google/callback`.

**Kunci enkripsi:** `data/secret.key` dibuat otomatis saat rahasia pertama disimpan. Simpan berkas ini bersama setiap backup folder `data/`. Tanpa berkas itu kunci yang tersimpan tidak bisa dibaca, dan secret 2-step verification juga ikut terenkripsi dengannya.

**Peringatan:** di Settings > Notifications pilih saluran tiap peringatan, misalnya artikel siap direview, job gagal, domain terblokir, atau biaya melewati 80% anggaran harian. Email peringatan dikirim ke semua admin dan editor. Peringatan review juga dikirim ke native reviewer situs itu. Selama jam tenang, peringatan ditahan lalu dikirim bersama. Daftar "Recently sent" menunjukkan hasil tiap pengiriman.

## Artikel

Di hasil riset keyword (tab Keywords, "View result"), setiap keyword punya tombol "Write article". Setelah dikonfirmasi, agen Content Writer menulis satu artikel dalam bahasa situs untuk pembaca di negaranya, mengikuti skill `article-writing` dan `google-seo`. Setiap angka atau klaim harus berasal dari halaman yang benar-benar dibuka agen dan dicantumkan sebagai sumber; agen dilarang mengarang pengalaman, pengujian, penulis, ulasan, kutipan, atau klaim kesehatan.

Di Article review tampil artikel lengkap (asli dan terjemahan Inggris berdampingan), title tag, meta description, slug, sumber, catatan agen untuk reviewer, pemeriksaan otomatis (dihitung server, bukan model), dan riwayat keputusan. Approve berarti artikel disetujui, belum terbit: artikel perlu dimasukkan ke build website, lalu mengikuti approval build dan deployment di Build and deploy. Cloudflare Pages sudah tersambung lewat Direct Upload bila integrasinya dikonfigurasi. Request revision mengirim artikel kembali ke agen bersama catatan Anda.

Satu artikel bisa makan beberapa menit (batas 15 menit) dan memakai kuota OpenAI API Anda. Semua job agen, riset keyword maupun artikel, mengantre satu per satu, yang paling lama lebih dulu. Di lembar detail agen Keyword dan Content Writer, bagian System prompt menampilkan templat prompt yang benar-benar dipakai server.

**Menyunting sebelum disetujui.** Admin dan editor bisa memperbaiki artikel yang menunggu review tanpa meminta revisi ke agen: tombol "Edit" di Article review mengubah judul, title tag, meta description, slug, dan isi (paragraf, heading, daftar, tabel; blok bisa ditambah, dihapus, dipindah) menjadi kolom yang bisa diketik di tempatnya. Simpan dengan "Save changes" atau Ctrl/Cmd+S, batal dengan Cancel atau Escape; perubahan yang belum disimpan tidak pernah dibuang tanpa bertanya. Suntingan hanya dalam bahasa situs: terjemahan Inggris di samping bagian yang diubah tetap ada dan ditandai "translation not updated". Saat disimpan, server menghitung ulang pemeriksaan otomatis, mencatat "edited" di riwayat, memindahkan foto mengikuti bloknya, dan menghapus language review jika judul atau isi berubah. Jika orang lain sudah mengubah artikel itu lebih dulu, simpan ditolak dan tidak ada yang ditimpa.

**Pemeriksaan otomatis.** Server memeriksa sumber, title tag, meta description, keyword, judul/slug ganda, tautan kontekstual dan klaim pengalaman pengujian. Jumlah karakter dan kata bersifat informatif: bukan batas peringkat Google. Kehadiran sumber bukan bukti kebenaran setiap klaim. Kebijakan Meridian menghalangi approval untuk artikel tanpa sumber, tanpa title tag atau dengan slug ganda. Reviewer tetap memeriksa fakta dan sumber; topik sensitif memerlukan peninjauan ahli yang sesuai.

**Banyak sekaligus.** Di hasil riset keyword, centang beberapa keyword lalu "Write selected" (maksimal 10 per kirim; batas antrean dan anggaran harian tetap berlaku, dan tiap keyword mendapat hasilnya sendiri). Di Article review, centang beberapa artikel lalu "Approve selected": yang belum lolos (pemeriksaan gagal, atau language review belum ada saat diwajibkan) dilewati dan disebutkan alasannya.

**Tautan internal dan kategori.** Paragraf dan butir daftar bisa memuat tautan sebagai struktur (rentang teks dan tujuan), tidak pernah HTML: ke artikel lain di situs yang sama (berdasarkan id; alamatnya ditentukan saat build) atau ke alamat http(s). Content Writer diberi daftar artikel situs yang sudah disetujui atau sedang direview dan diminta menautkan yang relevan dalam konteks (2–5 bila memang membantu, tidak dipaksakan) serta mengusulkan satu kategori. Server memvalidasi semuanya (`article-content.ts`): kata jangkar harus ada di teks, tidak tumpang-tindih, tujuan harus artikel situs itu atau sumber yang tercantum, sekali per artikel tujuan, maksimal 8 tautan; yang tidak lolos dibuang dan dicatat untuk reviewer. Di editor, pilih kata lalu tekan tombol tautan (atau Ctrl/Cmd+K) untuk memilih artikel atau mengetik alamat; tautan tiap teks tercantum di bawahnya dengan tombol hapus. Kategori tersimpan di artikel (bawaan: klaster riset keyword), bisa diubah di editor, dan di tab Architecture kategori bisa diganti nama atau digabung. Pemeriksaan "Links in the text" memberi peringatan untuk jangkar generik ("click here", "read more", "di sini"). Website hasil build punya halaman kategori (`/<slug-kategori>/`), breadcrumb tiga tingkat dengan `BreadcrumbList` yang sama, blok artikel terkait (kategori yang sama dulu), kategori di navigasi dan beranda bila ada minimal dua, dan sitemap yang memuat halaman kategori; tautan ke artikel yang belum disetujui ditulis sebagai teks biasa. Tab Internal links menggambar graf tautan nyata dan daftar artikel tanpa tautan masuk (`GET /api/sites/:id/links`, dihitung deterministik oleh `links.ts`).

**Setelah keputusan.** Artikel yang sudah disetujui bisa dikembalikan ke review ("Send back to review"): build website berikutnya tidak lagi memuatnya, tetapi build yang sudah live tidak berubah sampai build baru di-deploy. Artikel yang sudah diputuskan atau gagal bisa diarsipkan ("Archive"): hanya disembunyikan dari daftar (tampilkan lagi dengan "Show archived"), tidak ada yang dihapus, dan artikel approved yang diarsipkan tetap bagian dari website.

## Biaya dan anggaran harian

Setiap kali agen memanggil OpenAI, server mencatat satu baris di buku besar biaya (tabel `job_runs`): jenis job, situs, agen, model, token, biaya, dan hasilnya (`ok`, `failed`, `timeout`, `cancelled`). Run yang gagal tetap dihitung bila API melaporkan pemakaiannya, dan revisi atau percobaan ulang menambah baris baru, tidak menimpa yang lama. Biaya lama yang tersimpan di tiap job disalin ke buku besar satu kali saat server pertama dijalankan dengan versi ini.

Semua angka biaya berasal dari jumlah buku besar itu: Analytics (biaya hari ini terhadap anggaran per situs, token per agen, token per situs 28 hari), kolom "Spend today" di Sites, "Tokens today" di Workspace, peringatan anggaran, dan laporan mingguan. "Hari ini" mengikuti jam komputer ini, mulai tengah malam.

"Daily budget per site (USD)" di Settings memeriksa biaya tercatat sebelum job dimulai. Panggilan yang sudah berjalan dapat melampaui sisa anggaran; angka ini bukan batas tagihan yang dijamin provider. Saat biaya sebuah situs hari itu mencapai anggaran, job agen baru untuk situs itu (riset, artikel, revisi, coba lagi, cari foto, build pertama) ditolak dengan pesan yang menjelaskan sebabnya, dan job yang sudah mengantre ditahan dengan status "Waiting for budget", tidak digagalkan. Job itu berjalan lagi setelah tengah malam atau begitu anggaran dinaikkan. Situs lain tidak terpengaruh. Peringatan dikirim pada 80% dan sekali lagi saat situs dihentikan pada 100%.

## Backup, pemulihan, layanan

**Backup.** Satu backup adalah satu berkas ZIP di `data/backups/meridian-TTTTBBHH-JJMMDD.zip`. Isinya salinan database yang utuh (dibuat SQLite sendiri, jadi aman walau Meridian sedang berjalan), `secret.key`, `media/` (foto), dan `sites/` (website hasil build). Folder kerja agen, log, dan backup lama tidak ikut.

- Otomatis setiap malam pukul 03:00 selama Meridian hidup jika **Automatic nightly backup** di Settings > System aktif. Pengaturan ini tersimpan di database dan tetap berlaku setelah restart. Menonaktifkannya tidak menghentikan pemeliharaan database dan pembersihan folder kerja. Kalau saat jadwal Meridian mati, backup dibuat sekitar 10 menit setelah dinyalakan lagi.
- Manual: tombol **Back up now** di Settings > System (khusus admin, di situ juga ada daftar backup dan tautan Download), atau `./backup.sh` dari terminal. `./backup.sh list` menampilkan daftarnya.
- Yang disimpan: satu backup per hari untuk 7 hari terakhir, lalu satu per minggu untuk 4 minggu sebelumnya. Sisanya dihapus otomatis.
- Backup memuat hash password dan kunci enkripsi. Berkasnya hanya bisa dibaca akun macOS Anda (folder 0700, berkas 0600). Simpan salinan hasil unduhan di tempat yang hanya Anda yang bisa membukanya, dan sebaiknya di luar komputer ini.

**Pemulihan.** Hentikan Meridian dulu, lalu:

```bash
./backup.sh restore meridian-20261003-030000.zip   # nama di data/backups, atau path ke berkas ZIP
./start.sh
```

Perintah ini ditolak selama server masih berjalan. Arsip diperiksa dulu (isi dan keutuhan database), baru folder `data/` diganti. Data lama tidak dihapus: ia dipindah ke `data.before-restore-<waktu>` di sebelah `data/`, dan boleh Anda hapus sendiri setelah yakin. Daftar backup ikut pindah ke folder `data/` yang baru.

**Log.** `data/logs/meridian.log` berisi satu baris JSON per kejadian: server hidup dan mati beserta versinya, setiap permintaan API (metode, path, status, lama, id pengguna), awal dan akhir setiap job (jenis, situs, lama, token, biaya, hasil), backup, dan pemeliharaan malam. Isi permintaan, password, cookie, prompt, dan teks artikel tidak pernah ditulis; token di dalam path disamarkan. Pada 5 MB berkas diputar menjadi `meridian.log.1` sampai `.5`.

**Pemeliharaan malam** (bersama backup pukul 03:00): menghapus folder kerja job di `data/workspaces/` yang tidak berubah selama 7 hari dan berkas `*.tmp` sisa proses yang terputus, merapikan database (`PRAGMA optimize`, checkpoint WAL), dan menerapkan rotasi backup.

**Layanan macOS.** Agar Meridian hidup sendiri saat login dan dinyalakan lagi kalau berhenti:

```bash
./service.sh install     # menulis ~/Library/LaunchAgents/com.meridian.server.plist lalu menjalankannya
./service.sh status
./service.sh uninstall
./service.sh print       # hanya menampilkan isi berkas layanan, tanpa memasang apa pun
```

Jalankan `./start.sh` sekali lebih dulu (untuk build antarmuka), hentikan, baru pasang layanan. Selama layanan terpasang jangan menjalankan `./start.sh`: hanya satu server yang boleh memakai folder `data/` dan port yang sama. Keluaran layanan ada di `data/logs/service.log`. Setelah memperbarui kode antarmuka, jalankan `npm run build` di `app/`; setelah memperbarui kode server, `./service.sh install` lagi untuk memulai ulang.

## Navigasi visual dan perjalanan pekerjaan

- Workspace menampilkan **Work journeys**: workflow yang sedang berjalan lebih dulu, atau artikel/permintaan yang tersedia bila belum ada workflow.
- Di Keywords, Article review, Sites, dan Build and deploy, pilih stasiun visual lalu klik nama record untuk membuka **Work journey**. Dialog ini mengikuti `requestId`, ID artikel di build, serta referensi workflow; kesamaan judul atau domain tidak dianggap bukti hubungan.
- Dari detail perjalanan, buka hasil riset, artikel yang tepat, preview/ZIP build, serta tindakan approval dan deployment yang memang tersedia untuk peran Anda. Situs menampilkan aktivitas situs, bukan satu rangkaian yang diasumsikan saling terkait.
- Angka mengikuti filter situs dan record yang telah dimuat. Data contoh diberi label Demo. Animasi menunjukkan pekerjaan aktif; tombol Pause visual motion hanya menghentikan gerak visual, bukan job atau sinkronisasi. Office mandiri juga memiliki tombol ini.
- **Quality checkpoints** menampilkan pemeriksaan otomatis, status tinjauan bahasa, dan jumlah sumber yang dimuat. Pemeriksaan ini tidak menggantikan verifikasi sumber dan pembacaan manusia, serta tidak menjamin peringkat pencarian.
- Models and skills membedakan **Configured model** dari **Execution engine**. Sembilan agen AI menggunakan model OpenAI yang dipilih; Orchestrator dan Deploy & Monitor berjalan sebagai kode. Semua 11 peran bawaan memiliki runner.
- Halaman dashboard dimuat per route. Saat membuka modul pertama kali, indikator loading ditampilkan; kegagalan render tetap ditangani batas error route.

## Pengembangan

```bash
./dev.sh
```

Menjalankan API di port 4310 dan antarmuka dengan muat ulang otomatis di http://localhost:5173.

Di dalam `app/`: `npm run typecheck`, `npm test`, `npm run build`. Uji server, dari folder proyek: `npm run test:server`. Runner uji selalu menggunakan direktori sementara untuk `MERIDIAN_DATA`, termasuk jika shell memiliki variabel data produksi. Jangan menjalankan modul server langsung dari skrip uji ad-hoc tanpa isolasi ini. Panduan struktur kode ada di `app/PORTING.md`.

## Susunan proyek

```
start.sh, dev.sh             menjalankan dan mengembangkan aplikasi
app/                         antarmuka React
  src/store/                 data, aturan, simulasi, sambungan ke server
  src/views/                 11 layar di menu (Workflows, Run history, Audit log, Site architecture, Internal links, Experiments, Rank, dan Reports kini menjadi tab)
  src/components/, shell/    komponen bersama dan kerangka halaman
  src/styles/                token desain dan CSS
server/                      API, akun dan sesi, workspace, antrean semua 11 peran, pemeriksaan artikel, database, uji
skills/                      14 skill agen
data/                        database (akun, workspace, riset, artikel) dan folder kerja agen (dibuat otomatis)
archive/                     prototipe lama, sumber skill beserta bukti, hasil uji skill, demo
.tools/node/                 Node.js 24 khusus proyek ini
```

## Batas mode lokal

- Agen memakai Responses API, Codex lokal atau Gemma localhost sesuai pilihan Integrations (atau mode startup sebelum pilihan disimpan). API tetap memerlukan API key; mode Codex memerlukan login ChatGPT, akses model dan kuota yang tersedia. Lihat `docs/VALIDATION.md` untuk membedakan uji otomatis dan bukti pilot nyata.
- Laporan terjadwal dan cek akses otomatis hanya berjalan selama Meridian hidup. Laporan yang terlambat lebih dari 12 jam dilewati.
- Deploy ke Cloudflare Pages sudah diuji dengan tiruan Cloudflare yang memeriksa hash setiap berkas, tetapi belum dengan akun Cloudflare sungguhan. Uji coba pertama sebaiknya dengan domain percobaan. Hal yang sama berlaku untuk pemasangan domain sendiri (custom domain, zone, dan rekaman DNS): bentuk API-nya mengikuti dokumentasi Cloudflare, tetapi baru diuji dengan tiruan.
- Folder build disimpan maksimal 10 versi per situs. Versi yang lebih lama tetap tercatat, tetapi preview dan ZIP-nya tidak tersedia lagi.
- Memakai kuota API, ChatGPT/Codex atau hardware Gemma lokal sesuai runtime; layanan data lain tetap dapat memiliki biaya sendiri.
- Hanya berjalan selama `./start.sh` hidup, dan hanya bisa dibuka dari komputer ini (http://localhost, tanpa HTTPS).
- Agen Keyword menerima teks skill dari server. Ia tidak boleh menjalankan perintah, menulis berkas, atau membuka web.
- Agen Content Writer menerima teks skill. OpenAI dan Codex dapat memakai pencarian web; Gemma dapat membaca URL sumber HTTPS publik melalui tool terbatas, tanpa pencarian web. Isi web diperlakukan sebagai data, bukan perintah. Ia tidak boleh menjalankan perintah, menulis berkas, atau menjalankan agen lain.

## Variabel lingkungan

| Nama | Guna |
|---|---|
| `PORT` | Port server (bawaan 4310) |
| `OPENAI_API_KEY` | Kunci OpenAI API untuk server, bila tidak disimpan di Integrations |
| `MERIDIAN_ENGINE` | `openai-api` (bawaan), `codex-local`, atau `gemma-local`; pilihan UI yang tersimpan diutamakan |
| `MERIDIAN_OLLAMA_URL` | Endpoint Gemma HTTP loopback, bawaan `http://127.0.0.1:11434` |
| `MERIDIAN_GEMMA_MODEL` | Tag Gemma lokal, bawaan `gemma4:31b` |
| `MERIDIAN_GEMMA_CONTEXT` | Context size Gemma, bawaan 32768 token |
| `MERIDIAN_CODEX_BIN` | Path CLI resmi bila tidak ditemukan pada bundel aplikasi Mac atau PATH |
| `MERIDIAN_CODEX_MODEL` | Model runtime Codex lokal, bawaan `gpt-6.1-sol` |
| `MERIDIAN_DATA` | Folder data lain (bawaan `data/`) |
| `MERIDIAN_SECRET_KEY` | Kunci enkripsi (32 byte, base64) sebagai pengganti `data/secret.key` |
| `MERIDIAN_DNS_SERVERS` | Resolver DNS publik untuk verifikasi dan cek akses (bawaan `1.1.1.1,8.8.8.8`) |
| `MERIDIAN_LOG_LEVEL` | Tingkat terendah yang ditulis ke `data/logs/meridian.log`: `debug`, `info` (bawaan), `warn`, atau `error` |

### Konsistensi Office antartab

Office di Workspace dan `/office` memakai komponen yang sama dan mengikuti data server. Muat ulang semua tab setelah memperbarui aplikasi agar mode demo lama di memori ikut dibersihkan.

### SerpApi untuk riset SERP

Di **Integrations → SerpApi → Connect**, simpan API key dari akun SerpApi. Key disimpan terenkripsi dan tidak dikembalikan ke browser. **Save and test** memakai Account API; tidak menjalankan pencarian Google. Di **Research and SEO**, pilih **SERP research** lalu provider. **Automatic** memilih SerpApi bila tersambung, lalu SearchAPI.io, lalu DataForSEO bila layanan sebelumnya tidak tersedia. Pilihan ditetapkan saat masuk antrean; galat/kuota habis tidak memicu pencarian ulang lewat provider lain.

SerpApi mengambil satu halaman hasil Google dengan negara, bahasa, dan perangkat desktop yang eksplisit. Snapshot menyimpan maksimal 10 hasil organik serta fitur terkait yang didukung, bukan seluruh SERP atau isi lengkap halaman kompetitor. Posisi SerpApi adalah urutan organik, bukan posisi absolut semua fitur. Bukti, provider dan langkah kerja tersedia di hasil riset/Activity; snapshot yang sudah disimpan digunakan kembali saat pekerjaan dipulihkan setelah restart. SerpApi tidak memberi volume keyword atau biaya dolar per permintaan; Meridian tidak mengarang nilainya. Volume memakai Google Ads langsung atau DataForSEO. Koneksi dan pencarian nyata memerlukan key dengan kuota tersedia; tes otomatis memakai layanan tiruan terisolasi.


### Google Ads untuk volume keyword

1. Pada Google Cloud project pemilik OAuth client, aktifkan **Google Ads API** dan ajukan akses produksi serta penggunaan **keyword planning** yang sesuai melalui [Google Ads API Overview](https://console.cloud.google.com/apis/api/googleads.googleapis.com/overview). Akun uji atau akses Test tidak memberikan metrik keyword produksi. Ikuti persyaratan akun/proyek Google; Meridian tidak membuat kampanye atau mengubah anggaran iklan.
2. Buat OAuth client bertipe **Web application**. Daftarkan redirect URI yang ditampilkan pada **Integrations → Google sign-in** (bawaan `http://localhost:4310/api/oauth/google/callback`), lalu simpan client ID dan secret. Secret dan token OAuth tetap terenkripsi di server.
3. Pada **Integrations → Google Ads → Set up account**, simpan Customer ID akun klien. Isi Manager Customer ID hanya untuk akses melalui akun pengelola; kedua ID boleh memakai tanda hubung. Klik **Connect with Google** dan beri izin akun yang memiliki akses. Scope OAuth Google Ads mencakup akses Ads; implementasi Meridian hanya membaca akun, konstanta target dan metrik, tanpa endpoint mutasi kampanye. **Disconnect** menghapus konfigurasi dan token lokal Meridian; pencabutan izin Google global dikelola di akun Google.
4. Riset Keyword baru mengambil volume otomatis melalui Google Ads bila konektornya siap; DataForSEO dipakai bila hanya layanan itu yang siap. Hasil riset memiliki pilihan **Keyword volume source** dan **Refresh volumes**. Pilihan eksplisit tidak berpindah provider ketika ada galat atau kuota habis.

Adapter memakai REST **v25**, `GenerateKeywordHistoricalMetrics`, batch maksimum 1.000 keyword, network `GOOGLE_SEARCH`, serta konstanta negara/bahasa yang dicari dari Google. Target yang tidak dapat dikenali ditolak, tanpa fallback global/English. Uji koneksi memverifikasi akun klien produksi yang aktif; izin keyword-planning diuji saat volume diminta, sehingga status Connected bukan bukti bahwa semua metode API telah berhasil.

Angka adalah estimasi rata-rata pencarian bulanan (periode bawaan Google: 12 bulan), bukan traffic atau keyword difficulty. Competition adalah kompetisi pengiklan. Keyword dengan `closeVariants` memiliki metrik kelompok yang sama, ditandai **shared group**; jangan menjumlahkannya sebagai permintaan terpisah. Data yang tidak diberikan Google tetap kosong, bukan nol; galat refresh mempertahankan angka dan waktu pengambilan sebelumnya.

Google [menghentikan developer token pada 9 September 2026](https://developers.google.com/google-ads/api/docs/api-policy/developer-token); akses mengikuti Cloud project pemilik OAuth client. Konektor ini tidak meminta atau mengirim developer token lama. Dokumentasi lama tentang API Center dapat berbeda dari persyaratan terbaru tersebut.

Tes konektor: `node --test server/google-ads.test.ts` dan tes UI terkait. Tes otomatis memakai server serta provider terisolasi, bukan akun Google Ads nyata. Tanpa OAuth dan Customer ID milik pengguna, koneksi produksi dan ketersediaan volume nyata belum terverifikasi.

### SearchAPI.io untuk riset SERP

**SearchAPI.io** dan **SerpApi.com** adalah layanan berbeda; API key tidak bisa dipertukarkan. Di **Integrations → SearchAPI.io → Connect**, simpan key dari dashboard SearchAPI.io. Key terenkripsi dan hanya ekornya tampil. **Save and test** membaca kuota melalui [Account API](https://www.searchapi.io/docs/account-api), bukan menjalankan pencarian. Riset menggunakan [Google Search API](https://www.searchapi.io/docs/google) dengan negara/bahasa situs dan perangkat desktop. Pilih SearchAPI.io pada **Research and SEO → SERP research**. Automatic memilih SerpApi, kemudian SearchAPI.io, kemudian DataForSEO yang tersambung dan tidak berstatus bad. Provider ditetapkan saat antrean dibuat; kegagalan tidak memicu perpindahan otomatis.

Snapshot dibatasi ke 10 hasil organik dan fitur terkait yang didukung; bukan audit seluruh halaman kompetitor. Meridian menyimpan bukti, nama provider dan langkah kerja sebenarnya untuk Office/Activity. Volume keyword tetap membutuhkan Google Ads atau DataForSEO. Biaya dolar tidak dikarang dari kredit pencarian. Gemma localhost, Codex Local dan konektor lain tetap tersedia. Pengujian otomatis memakai provider terisolasi, bukan key atau kuota akun pengguna.
