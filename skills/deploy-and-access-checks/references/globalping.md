# Globalping: API, batas, dan probe

## API dan batas penggunaan

- API Globalping bersifat publik, gratis, dan tidak memerlukan autentikasi, tetapi menerapkan batas laju. [E140]
- Pengukuran berjalan asinkron; keadaan terkini dapat diambil di URL yang dikembalikan pada header `Location`. [E141]
- Jika status pengukuran `in-progress`, tunggu 500 milidetik lalu minta status lagi; hitung 500 ms setelah respons diterima, bukan dengan interval tetap. [E142]
- Jika status apa pun selain `in-progress`, berhenti: pengukuran tidak lagi berjalan dan hasilnya final. [E143]
- Jangan meminta hasil satu pengukuran lebih sering daripada setiap 500 milidetik. [E144]
- Saat menerima respons 429, informasikan status batas laju berdasarkan header respons; opsi yang dapat disarankan adalah masuk atau memakai access token, mempelajari cara mendapat kredit tambahan, dan mengulang pengukuran dengan probe lebih sedikit. [E145]
- Untuk pengguna tanpa autentikasi, jumlah tes yang dapat dijalankan satu alamat IP dibatasi: 250 tes per jam dan 50 probe per pengukuran. [E146]
- Pengguna terdaftar (Registered users – Free) mendapat API key dengan batas lebih tinggi: 500 tes per jam dan 500 probe per pengukuran. [E147]
- Satu tes didefinisikan sebagai pengukuran berhasil dari satu probe; batas 10 tes berarti 10 pengukuran dengan limit probe 1 atau satu pengukuran dengan limit probe 10. [E148]
- Hasil pengukuran umumnya tersedia hingga enam bulan setelah dibuat. [E149]
- Permintaan GET pengukuran dibatasi 2 per detik per pengukuran per alamat IP. [E150]
- Saat meminta status pengukuran, terapkan caching sisi klien berbasis header ETag/If-None-Match. [E151]

## Probe dan hasilnya

- Probe tidak membuka ID unik untuk dipilih; pilih probe lewat lokasi atau ID pengukuran yang sudah ada. [E152]
- Saat meminta jumlah probe tertentu, API tidak menjamin jumlahnya persis sama. [E153]
- Probe yang berada di balik VPN atau teknik proxy lain diblokir dari jaringan Globalping karena akan melaporkan latensi dan routing yang salah. [E154]
- Endpoint GET /v1/probes mengembalikan daftar probe yang sedang online beserta metadata seperti lokasi dan tag. [E155]
- Jika Globalping dipakai memantau uptime endpoint lewat integrasi seperti Upptime, sumber memberi tip: saat menargetkan wilayah atau negara tertentu (misalnya Germany atau South America), tambahkan filter +datacenter-network (misalnya Germany+datacenter-network) agar probe berjalan dari infrastruktur yang stabil. [E156]
- Untuk menargetkan probe yang bukan bagian data center, gunakan tag eyeball-network. [E157]
