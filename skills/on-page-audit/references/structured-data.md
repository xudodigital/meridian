# Structured data: pedoman dan status fitur

Rujukan audit structured data pada halaman. Semua butir bersumber dari dokumentasi Google Search Central.

## Pedoman dan kelayakan

- Jangan buat halaman kosong hanya untuk menampung structured data, dan jangan menambahkan structured data tentang informasi yang tidak terlihat oleh pengguna, meskipun informasi itu akurat. [E89]
- Sertakan semua properti wajib agar objek memenuhi syarat tampil dengan tampilan yang ditingkatkan; item yang tidak memiliki properti wajib tidak memenuhi syarat untuk rich result. [E90] [E91]
- Lebih penting memberi lebih sedikit properti rekomendasi yang lengkap dan akurat daripada semua properti dengan data yang kurang lengkap, salah format, atau tidak akurat. [E92]
- Periksa structured data dengan Rich Results Test saat pengembangan dan dengan laporan Rich result status setelah deployment, karena halaman dapat rusak akibat masalah templating atau penyajian. [E93]
- Gunakan salah satu dari tiga format yang didukung (JSON-LD direkomendasikan, Microdata, RDFa); ketiganya sama baiknya bagi Google selama markup valid dan diterapkan sesuai dokumentasi fitur, dan Google menyarankan format yang paling mudah diterapkan dan dirawat, yang dalam kebanyakan kasus adalah JSON-LD. [E94] [E95] [E96]
- Masalah structured data dapat berujung manual action yang membuat halaman kehilangan kelayakan rich result, tanpa memengaruhi peringkat di pencarian web Google. [E97]
- Jangan blokir halaman ber-structured data dari Googlebot dengan robots.txt, noindex, atau kontrol akses lain. [E98]
- Berikan informasi terkini; rich result tidak ditampilkan untuk konten sensitif waktu yang sudah tidak relevan. [E99]
- Jangan menandai konten tidak relevan atau menyesatkan, seperti ulasan palsu atau konten yang tidak terkait fokus halaman. [E100]
- Structured data harus menjadi representasi yang benar dari konten halaman. [E101]
- Taruh structured data pada halaman yang dijelaskannya, kecuali dokumentasi menyatakan lain; untuk halaman duplikat, Google menyarankan structured data yang sama di semua duplikat, bukan hanya di halaman kanonis. [E102] [E103]
- Semua URL gambar di structured data harus dapat di-crawl dan diindeks. [E104]
- Sertakan tipe structured data utama yang mencerminkan fokus utama halaman; jika hanya ada Video, Google tidak cukup tahu untuk menampilkan halaman sebagai rich result resep. [E105] [E106]
- JavaScript dapat dipakai untuk membuat JSON-LD yang dibutuhkan dan menyuntikkannya ke halaman; uji implementasinya. [E107]
- Pada situs dengan versi seluler, pastikan versi seluler dan desktop memiliki structured data yang sama, dan URL di structured data pada versi seluler diperbarui ke URL seluler. [E108] [E109]

## Fitur yang tidak lagi tampil

- Fitur rich result FAQ tidak lagi tampil di Google Search sejak 7 Mei 2026. [E110] [E111]
- Rich result How-to tidak lagi tampil di hasil pencarian, baik desktop maupun seluler. [E112]
- Tipe structured data course info, estimated salary, learning video, special announcement, vehicle listing, dan practice problem tidak lagi tampil di Google Search. [E113] [E114] [E115]
- Structured data Dataset hanya dipakai oleh Dataset Search, bukan Google Search. [E116]
