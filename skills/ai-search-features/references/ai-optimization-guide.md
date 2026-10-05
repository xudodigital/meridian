# Panduan optimasi generative AI (Google)

Detail dari panduan Google "Optimizing your website for generative AI features on Google Search" (sumber g-ai-optimization-guide). Setiap baris memiliki tag bukti.

## Relevansi SEO dan cara kerja

Bagian ini merangkum cara panduan menjelaskan hubungan SEO dengan fitur generative AI di Google Search.

- Anggap praktik terbaik SEO tetap relevan untuk generative AI search; Google menyatakan fitur generative AI di Google Search berakar pada sistem ranking dan kualitas inti Search. [E102] [E103]
- Pahami Retrieval-augmented generation (RAG) (juga disebut grounding) sebagai teknik yang dipakai untuk meningkatkan kualitas, akurasi, dan kesegaran respons AI dengan mengandalkan sistem ranking inti Search untuk mengambil halaman web relevan dan terbaru dari indeks Search; sistem Google lalu meninjau informasi spesifik dari halaman yang diambil untuk menghasilkan respons yang lebih andal dan membantu, sambil menampilkan tautan yang menonjol dan dapat diklik ke halaman web relevan yang mendukung informasi dalam respons. [E104] [E105] [E106] [E107]
- Pahami query fan-out sebagai sekumpulan query terkait yang dihasilkan model dan dijalankan bersamaan untuk meminta informasi lebih banyak serta mengambil hasil pencarian relevan tambahan untuk menjawab query pengguna. [E108] [E109]

## Konten yang tetap penting

Prinsip konten dari panduan.

- Ketahui bahwa membuat konten yang dianggap orang unik, menarik, dan berguna kemungkinan akan memengaruhi kehadiran situs di generative AI search dalam jangka panjang lebih daripada saran lain mana pun di panduan. [E110] [E111]
- Ketahui bahwa sistem AI Google melihat berbagai sumber, sehingga memiliki sudut pandang unik yang menonjol dapat membantu; ulasan langsung (first-hand review) memberi perspektif unik berdasarkan pengalaman pribadi, sedangkan ringkasan konten yang sudah ada hanya mengulang informasi yang sudah tersedia di tempat lain; jangan sekadar mendaur ulang apa yang sudah dikatakan orang lain di internet atau yang mudah dihasilkan model generative AI. [E112] [E113] [E114]
- Pastikan Anda menulis konten non-komoditas yang dianggap pembaca membantu dan andal: konten komoditas sering berbasis pengetahuan umum, yang bisa berasal dari siapa saja, dan biasanya menambah sedikit wawasan unik bagi pembaca, sedangkan konten non-komoditas memberi pandangan unik dari ahli atau orang berpengalaman yang melampaui pengetahuan umum. [E115] [E116]
- Tulis konten untuk audiens manusia dan pastikan konten tertulis baik serta mudah diikuti; orang umumnya menyukai halaman web yang tertata dalam paragraf dan bagian, dengan heading yang memberi struktur yang jelas untuk menavigasi konten. [E117] [E118]
- Bila masuk akal, cari cara mendukung konten teks dengan gambar dan video relevan berkualitas tinggi di halaman; fitur generative AI search dapat menampilkan gambar dan video relevan, sehingga ada lebih banyak peluang bagi situs untuk tampil di luar tautan halaman web. [E119] [E120]
- Meski mungkin tergoda membuat konten terpisah untuk setiap kemungkinan variasi cara orang mencari (misalnya fan-out queries), melakukannya terutama untuk memanipulasi peringkat atau respons generative AI di Google Search melanggar spam policy scaled content abuse milik Google. [E121] [E122]
- Ketahui bahwa sistem AI Google telah makin maju dan meningkatkan kemampuan memahami relevansi halaman, bahkan bila tidak ada kecocokan persis antara query dan konten utama halaman. [E123]
- Bila memakai alat generative AI untuk membantu membuat konten, pastikan hasilnya memenuhi standar Search Essentials dan spam policies Google. [E124] [E125]
- Anda dapat menyederhanakan pendekatan dengan berfokus pada satu prinsip inti: fokus pada apa yang akan dinikmati pengunjung, dianggap membantu, dan membuat mereka puas setelah mengunjungi situs. [E126] [E127]

## Struktur teknis

Praktik teknis yang dibahas panduan.

- Agar layak tampil di fitur generative AI di Google Search, halaman harus terindeks dan layak tampil di Google Search dengan snippet; selain persyaratan teknis Search, situs harus termasuk dalam Search generative AI features di Search Console agar layak ditampilkan di fitur generative AI di Google Search. [E128] [E129] [E130]
- Untuk memaksimalkan visibilitas situs di fitur generative AI search, pastikan konten dapat di-crawl, karena model generative AI Google Search memakai konten yang dapat diakses publik dan dapat di-crawl untuk mempelajari pola dan memberi respons yang relevan dan grounded. [E131] [E132]
- Untuk HTML semantik, fokus pada keterbacaan bagi manusia dan jangan khawatir soal kode yang sempurna: HTML yang sempurna secara semantik tidak wajib (web pada umumnya bukan HTML valid, dan Google dapat memahaminya), tetapi umumnya ide yang baik untuk mencoba memakai HTML semantik bila memungkinkan, karena membantu jenis pengguna lain, seperti screen reader, mengurai dan menavigasi halaman web dengan lebih mudah. [E133] [E134] [E135]
- Jika memakai JavaScript, pastikan mengikuti praktik terbaik JavaScript SEO; Google dapat memproses konten dalam JavaScript selama tidak diblokir, tetapi mengerjakan SEO pada situs yang memakai framework JavaScript umumnya lebih kompleks daripada pada jenis situs lain. [E136] [E137]
- Berikan page experience yang baik bagi orang yang tiba di situs Anda: ini mencakup memastikan situs tampil baik di semua perangkat, mengurangi latensi, dan memudahkan orang membedakan konten utama dari elemen lain di halaman. [E138] [E139]
- Bila ada waktu, coba kurangi konten duplikat: memiliki konten duplikat dapat menjadi pengalaman pengguna yang buruk dan mesin pencari mungkin membuang sumber daya crawling pada URL yang bahkan tidak Anda pedulikan. [E140] [E141]
- Bila sesuai, respons generative AI dapat memuat daftar produk, informasi produk, dan informasi tentang bisnis lokal; memakai produk seperti Merchant Center (misalnya feed Merchant Center) dan Google Business Profiles dapat membantu produk dan layanan Anda terlihat di respons AI maupun hasil Google Search lainnya. [E142] [E143]

## Mitos: yang tidak perlu dilakukan

Daftar hal yang dibahas panduan di bagian mythbusting.

- Meski istilah seperti Answer Engine Optimization (AEO) atau Generative Engine Optimization (GEO) umum di internet, banyak "hack" yang disarankan tidak efektif atau tidak didukung cara kerja Google Search yang sebenarnya. [E144] [E145]
- File LLMS.txt dan markup "khusus" lainnya: tidak perlu membuat file machine readable baru, file AI text, markup, atau Markdown agar tampil di Google Search (termasuk kemampuan generative AI-nya), karena Google Search sendiri tidak memakainya. [E146] [E147]
- Ketahui bahwa Google mungkin menemukan, meng-crawl, dan mengindeks banyak jenis file selain HTML di sebuah situs; ini tidak berarti file tersebut diperlakukan secara khusus. [E148] [E149]
- Tidak ada keharusan memecah konten menjadi potongan kecil ("chunking") agar AI lebih memahaminya; namun terkadang halaman yang lebih pendek (atau lebih panjang) dapat berhasil tergantung audiens dan topik; tidak ada panjang halaman yang ideal, dan pada akhirnya buat halaman untuk audiens, bukan hanya untuk generative AI search. [E150] [E151] [E152] [E153]
- Tidak perlu menulis dengan cara khusus hanya untuk generative AI search: sistem AI dapat memahami sinonim dan makna umum dari apa yang dicari seseorang, untuk menghubungkannya dengan konten yang mungkin tidak memakai kata yang persis sama, sehingga Anda tidak perlu khawatir kekurangan keyword "long-tail" atau belum menangkap setiap variasi cara orang mencari konten seperti milik Anda. [E154] [E155] [E156] [E157]
- Mengejar "mentions" yang tidak autentik di web tidak sebermanfaat yang tampak; sistem ranking inti Google berfokus pada konten berkualitas tinggi sementara sistem lain memblokir spam, dan fitur generative AI bergantung pada keduanya. [E158] [E159]
- Structured data tidak wajib untuk generative AI search, dan tidak ada markup schema.org khusus yang perlu ditambahkan; namun tetap ide yang baik untuk terus memakainya sebagai bagian dari strategi SEO secara keseluruhan, karena membantu kelayakan rich results di Google Search. [E160] [E161] [E162]

## Pengukuran

Cara panduan menyatakan kinerja di fitur generative AI diukur.

- Untuk mengukur kinerja konten di fitur generative AI di Google Search dan Discover, gunakan Generative AI performance report di Search Console; laporan ini dapat membantu memberi gambaran bagaimana orang menemukan konten Anda melalui fitur generative AI di Google Search. [E163] [E164] [E165]

## Pengalaman agentic dan langkah berikutnya

Bagian opsional serta ringkasan penutup panduan.

- Ketahui bahwa AI agents adalah sistem otonom yang dapat melakukan tugas atas nama orang, seperti memesan reservasi atau membandingkan spesifikasi produk; browser agents mungkin mengakses situs Anda untuk mengumpulkan data yang dibutuhkan untuk menyelesaikan tugas tersebut, misalnya dengan menganalisis tampilan visual (seperti screenshot), memeriksa struktur DOM, dan menafsirkan accessibility tree. [E166] [E167] [E168]
- Bila ini relevan bagi bisnis Anda dan ada waktu ekstra, lihat agentic experiences yang tersedia dan tinjau panduan agent-friendly website best practices, yang memberi gambaran bagaimana situs umumnya dapat bersiap untuk browser agents saat ini. [E169] [E170]
- Ketahui bahwa protokol seperti Universal Commerce Protocol (UCP) sedang muncul dan akan memungkinkan Search agents melakukan lebih banyak hal. [E171]
- Anda tidak perlu menyelesaikan semua isi panduan agar berhasil di Google Search; banyak konten berhasil di Google Search (termasuk pengalaman generative AI) tanpa SEO yang kentara sama sekali. [E172] [E173]
- Terus prioritaskan praktik dasar SEO seperti membangun struktur teknis yang jelas dan membuat konten unik yang bernilai; Google menyatakan itu fondasi visibilitas di pengalaman generative AI search (dan Google Search secara keseluruhan). [E174]
