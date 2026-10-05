# Referensi: investigasi penurunan traffic

## Langkah awal investigasi

Mulai dari data dan gejala.

- Pastikan juga memeriksa halaman Search Console Data Anomalies untuk melihat apakah ada yang berlaku untuk situs Anda; penurunan bisa terkait perubahan pemrosesan data atau kesalahan logging. [E75]
- Bagian-bagian dokumentasi mencakup penyebab utama yang perlu diselidiki saat menganalisis penurunan traffic. [E76]
- Lihat pola pada grafik utama laporan Performance; jika impresi dan klik sama-sama turun, periksa daftar penyebab paling umum. [E77]
- Jika impresi tetap tetapi klik turun, judul halaman dan snippet mungkin kurang baik, atau situs lain mungkin punya rich result yang lebih menarik. [E78]
- Ubah rentang tanggal ke 16 bulan untuk melihat penurunan dalam konteks dan memastikan itu bukan penurunan tahunan akibat perayaan atau tren. [E79]
- Untuk melampaui 16 bulan, tarik data dengan Search Analytics API atau bulk data exports dan simpan di sistem sendiri. [E80]
- Bandingkan periode penurunan dengan periode serupa (periode sebelumnya atau tahun ke tahun), lalu periksa semua tab untuk melihat apakah perubahan hanya terjadi pada query, URL, negara, perangkat, atau search appearance tertentu. [E81]
- Analisis jenis pencarian secara terpisah untuk mengetahui apakah penurunan terjadi di web Search, Google Images, tab Video, atau News. [E82]
- Cari pola pada halaman terdampak: apakah penurunan terjadi di seluruh situs, sekelompok halaman, atau satu halaman penting saja. [E83]
- Jika masalah di seluruh situs, periksa laporan Page indexing; jika hanya sekelompok halaman, gunakan URL Inspection tool pada beberapa halaman. [E84][E85]

## Penyebab: update algoritma dan posisi

Cara menilai penurunan posisi.

- Cek halaman daftar ranking updates Google untuk melihat apakah ada pembaruan yang relevan dengan situs. [E86]
- Jika dicurigai karena update algoritma, mungkin tidak ada yang salah secara mendasar pada konten. [E87]
- Tinjau halaman teratas di Search Console dan nilai peringkatnya: penurunan posisi kecil (misalnya 2 ke 4) atau besar (misalnya 4 ke 29). [E88]
- Pada penurunan posisi kecil, traffic dapat turun terasa tanpa perubahan besar pada impresi, dan fluktuasi kecil dapat terjadi kapan saja termasuk naik kembali tanpa tindakan. [E89][E90]
- Hindari perubahan radikal jika halaman sudah berkinerja baik. [E91]
- Penurunan posisi besar berarti jatuh dari hasil teratas untuk banyak istilah (misalnya dari 10 besar ke posisi 29). [E92]
- Untuk penurunan posisi besar, nilai ulang seluruh situs (bukan hanya halaman individual) agar helpful, reliable, dan people-first. [E93]
- Perubahan pada situs dapat memerlukan waktu: sebagian berdampak dalam beberapa hari, sebagian bisa berbulan-bulan. [E94]
- Secara umum, tunggu beberapa minggu sebelum menganalisis ulang di Search Console untuk melihat dampak perbaikan terhadap posisi. [E95]
- Jika melihat penurunan posisi yang dramatis dan menetap, nilai konten untuk memastikan helpful dan reliable. [E96]

## Penyebab: teknis, keamanan, spam, musiman, migrasi

Periksa laporan yang relevan.

- Masalah teknis dapat berupa seluruh situs (situs mati) atau per halaman (misalnya tag noindex yang salah tempat); yang per halaman bergantung pada crawl Google sehingga penurunan traffic lebih lambat. [E97]
- Periksa laporan Crawl stats dan Page indexing untuk melihat lonjakan masalah yang sesuai. [E98]
- Periksa laporan Security Issues untuk melihat apakah Google mendeteksi ancaman keamanan; peringatan Google kepada pengguna dapat menurunkan traffic Search. [E99][E100]
- Periksa laporan Manual Actions untuk melihat apakah ada tindakan manual terhadap situs. [E101]
- Untuk musiman, filter satu query teratas pada laporan Performance lalu periksa di Google Trends apakah penurunan hanya terjadi pada situs Anda atau di seluruh web. [E102]
- Jika URL halaman berubah, fluktuasi peringkat dapat terjadi saat Google merayapi dan mengindeks ulang; situs ukuran menengah umumnya butuh beberapa minggu, situs lebih besar bisa lebih lama. [E103]
- Jika ada query penting yang tidak muncul di traffic Anda, periksa apakah ada konten tentang topik itu dan pastikan dirayapi dan diindeks. [E104]

## Laporan Page indexing

Dipakai untuk memeriksa penurunan terkait indeks.

- Laporan Page indexing tidak dipakai untuk memeriksa status indeks halaman tertentu; pakai URL Inspection tool. [E105]
- Tujuannya mengindeks versi kanonis dari setiap halaman penting; halaman duplikat atau alternatif tidak seharusnya diindeks. [E106]
- Not indexed tidak selalu buruk; periksa alasan yang diberikan untuk setiap URL. [E107]
- Penurunan total halaman terindeks tanpa kenaikan error mungkin berarti akses diblokir lewat robots.txt, noindex, atau login; cari lonjakan URL non-indeks yang sesuai. [E108][E109]
- Lonjakan error dapat disebabkan perubahan template yang memasukkan error baru, atau sitemap berisi URL yang diblokir robots.txt, noindex, atau login. [E110]
- Untuk server error, periksa host status verdict di laporan Crawl Stats. [E111]
- Daftar URL contoh di laporan dibatasi 1,000 item dan tidak dijamin menampilkan semua URL pada suatu status. [E112]
- Pada umumnya hanya masalah dengan Source "Website" yang dapat Anda perbaiki. [E113]

## Tren industri

Konteks di luar situs sendiri.

- Jika ingin menelusuri lebih jauh, Anda dapat menggunakan Google Trends untuk memahami apakah penurunan merupakan tren yang lebih luas atau hanya terjadi pada situs Anda. [E114]