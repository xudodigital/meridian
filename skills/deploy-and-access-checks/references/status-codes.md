# Kode status, galat DNS/jaringan, dan robots.txt

## Kode status lainnya

- 200 (success): Google meneruskan apa pun yang diterimanya ke tahap pemrosesan berikutnya (spesifik produk); untuk Google Search, sistem berikutnya adalah pipeline pengindeksan, dan sistem pengindeksan dapat mengindeks konten tetapi itu tidak dijamin. [E104]
- 201 dan 202: Google menunggu konten dalam waktu terbatas lalu meneruskan apa yang diterima; batas waktunya bergantung pada user agent. [E105]
- 204: Google tidak dapat menerima konten sehingga tidak dapat memprosesnya. [E106]
- Konten dari URL yang melakukan redirect diabaikan, dan konten URL target akhir yang diproses. [E107]
- 307 setara dengan 302 dan 308 setara dengan 301. [E108]
- 304: crawler Google memberi tahu sistem berikutnya bahwa konten sama seperti saat crawl terakhir. [E109]
- Semua error 4xx selain 429 diperlakukan sama: crawler memberi tahu sistem berikutnya bahwa konten tidak ada. [E110]
- Halaman 404 yang baru ditemukan tidak diproses, dan frekuensi crawl turun bertahap. [E111]
- Kode 429 diperlakukan crawler Google sebagai sinyal server kelebihan beban dan dianggap sebagai server error. [E112]
- 500: Google menurunkan laju crawl situs secara proporsional dengan jumlah URL yang mengembalikan server error. [E113]
- Untuk Google Search, pipeline pengindeksan menghapus dari indeks URL yang terus-menerus mengembalikan server error. [E114]
- Laporan Page indexing: HTTP 403 berarti agen pengguna memberi kredensial tetapi tidak diberi akses; Googlebot tidak pernah memberi kredensial, sehingga server mengembalikan error ini secara keliru dan halaman tidak akan diindeks. [E115]
- Laporan Page indexing: 401 berarti halaman diblokir bagi Googlebot oleh permintaan otorisasi. [E116]
- Redirect error yang dilaporkan Google mencakup rantai redirect terlalu panjang, loop redirect, URL redirect melebihi panjang maksimum, dan URL buruk atau kosong dalam rantai. [E117]

## Galat DNS dan jaringan di Crawl Stats

- Server error berarti Googlebot tidak dapat mengakses URL, permintaan kehabisan waktu, atau situs sibuk, sehingga Googlebot terpaksa meninggalkan permintaan. [E118]
- Server error dapat bersifat sementara, sehingga uji langsung dapat berhasil walau crawl Google gagal. [E119]
- Cek verdict host status di laporan Crawl Stats untuk melihat apakah Google melaporkan masalah ketersediaan yang dapat dikonfirmasi dan diperbaiki. [E120]
- Laporan Crawl Stats hanya tersedia untuk properti tingkat root; properti harus berupa properti Domain (misalnya example.com atau m.example.com) atau properti URL-prefix pada tingkat root (https://example.com, http://example.com, http://m.example.com). [E121]
- Host status dinilai dari kategori ketersediaan robots.txt, resolusi DNS, dan konektivitas host; status merah memungkinkan melihat detail ketiganya. [E122]
- Grafik DNS resolution menunjukkan saat server DNS tidak mengenali hostname atau tidak merespons saat crawling; jika ada error, periksa registrar dan pastikan server terhubung ke Internet. [E123]
- Grafik tiap kategori memiliki garis putus-putus merah; metrik di atas garis putus-putus untuk kategori itu dianggap masalah (contohnya, resolusi DNS gagal pada lebih dari 5% permintaan dalam sehari), dan status mencerminkan seberapa baru masalah terakhir. [E124]
- Grafik Server connectivity menunjukkan saat server tidak responsif atau tidak memberi respons penuh untuk sebuah URL saat crawl. [E125]
- Dalam total permintaan crawl, permintaan tidak berhasil yang dihitung mencakup: fetch yang tidak pernah dilakukan karena robots.txt kurang tersedia, fetch yang gagal karena masalah resolusi DNS, fetch yang gagal karena masalah konektivitas server, dan fetch yang ditinggalkan karena loop redirect. [E126]
- Kategori respons Crawl Stats: DNS unresponsive berarti server DNS tidak merespons permintaan untuk URL situs; DNS error berarti galat DNS lain yang tidak spesifik. [E127]
- Kategori Fetch error: halaman tidak dapat diambil karena nomor port buruk, alamat IP buruk, atau respons yang tidak dapat di-parse. [E128]
- Kategori Page could not be reached: permintaan tidak pernah sampai ke server, sehingga permintaan itu tidak muncul di log server. [E129]
- Kategori Page timeout berarti permintaan halaman kehabisan waktu; Redirect error berarti galat pengalihan seperti terlalu banyak redirect, redirect kosong, atau redirect melingkar. [E130]
- Server error 5XX menyebabkan peringatan ketersediaan dan perlu diperbaiki bila memungkinkan. [E131]
- Googlebot dapat terblokir oleh masalah tingkat sistem seperti konfigurasi DNS, firewall atau sistem proteksi DoS yang salah konfigurasi, atau konfigurasi CMS. [E132]
- Jika server merespons permintaan dengan lambat, atau tingkat server error naik, Googlebot memperlambat permintaannya agar tidak membebani server. [E133]
- Jangan mengembalikan 503 atau 429 lebih dari dua atau tiga hari, karena dapat membuat Google meng-crawl situs lebih jarang dalam jangka panjang. [E134]

## robots.txt sebagai syarat crawling

- Respons robots.txt yang dianggap berhasil mencakup HTTP 200 dengan file robots.txt (file dapat valid, tidak valid, atau kosong) dan HTTP 403/404/410 (file tidak ada). [E135]
- Respons robots.txt yang dianggap gagal: HTTP 429 dan 5XX (masalah koneksi). [E136]
- Jika respons robots.txt terakhir tidak berhasil atau lebih tua dari 24 jam, Google meminta robots.txt; bila permintaan itu tidak berhasil, dalam 12 jam pertama Google berhenti meng-crawl situs tetapi terus meminta robots.txt. [E137]
- Dari 12 jam hingga 30 hari, Google memakai robots.txt terakhir yang berhasil diambil sambil terus meminta robots.txt. [E138]
- Setelah 30 hari: bila beranda situs tersedia, Google bertindak seolah tidak ada robots.txt dan crawl tanpa batasan; bila beranda tidak tersedia, Google berhenti meng-crawl situs; dalam kedua kasus Google terus meminta robots.txt secara berkala. [E139]
