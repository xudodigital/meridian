# Performa gambar

## Kecepatan muat dan pergeseran tata letak

Rujukan ini memuat panduan web.dev dan Google tentang dampak gambar pada LCP dan CLS.

- Gambar sering menjadi penyumbang terbesar ukuran halaman, yang dapat membuat halaman lambat dan mahal dimuat. [E86]
- Terapkan teknik optimasi gambar dan gambar responsif terbaru untuk pengalaman yang cepat dan berkualitas tinggi. [E87]
- LCP mengukur waktu dari pengguna memulai pemuatan halaman sampai gambar atau blok teks terbesar dirender di viewport. [E88]
- Sumber daya LCP dapat ditemukan lewat HTML awal jika elemen LCP adalah <img> dan atribut src atau srcset-nya ada di markup HTML awal. [E89]
- Sumber daya LCP tidak dapat ditemukan dari HTML awal jika elemen LCP adalah <img> yang ditambahkan ke halaman secara dinamis memakai JavaScript. [E90]
- Sumber daya LCP tidak dapat ditemukan dari HTML awal jika di-lazy-load oleh pustaka JavaScript yang menyembunyikan atribut src atau srcset (sering sebagai data-src atau data-srcset). [E91]
- Jika sumber daya LCP hanya dirujuk dari berkas CSS atau JavaScript eksternal, preload dengan fetch priority tinggi. [E92]
- Menetapkan loading="lazy" pada elemen <img> dapat menunda gambar LCP. [E93]
- Gambar tidak dimuat dengan prioritas tertinggi secara awal oleh peramban karena bukan sumber daya yang memblokir render. [E94]
- Sebaiknya tetapkan fetchpriority="high" pada <img> yang kemungkinan menjadi elemen LCP, tetapi menetapkan prioritas tinggi pada lebih dari satu atau dua gambar membuat pengaturan prioritas tidak membantu menurunkan LCP. [E95]
- Prioritas gambar yang ada di awal respons dokumen tetapi tidak terlihat karena styling (misalnya slide carousel yang tidak terlihat saat awal) dapat diturunkan. [E96]
- Setelah mengubah prioritas sumber daya, selalu periksa prioritasnya di DevTools dan uji perubahan dengan alat lab dan lapangan. [E97]
- Sumber daya LCP halaman (jika ada) berupa gambar atau web font; web.dev merujuk panduan untuk mengurangi ukurannya: sajikan ukuran gambar optimal, pakai format gambar modern, dan kompres gambar. [E98]
- CDN gambar sangat membantu karena mengurangi jarak tempuh sumber daya dan umumnya juga mengurangi ukuran sumber daya dengan menerapkan otomatis rekomendasi pengurangan ukuran. [E99]
- Gambar tanpa dimensi adalah salah satu penyebab paling umum CLS yang buruk. [E100]
- Selalu sertakan atribut width dan height pada elemen gambar dan video; alternatifnya, sediakan ruang yang dibutuhkan dengan CSS aspect-ratio atau yang serupa. [E101]
- Dengan atribut width dan height pada elemen gambar, semua peramban akan menambahkan rasio aspek bawaan berdasarkan atribut tersebut. [E102]
- Untuk gambar responsif dengan srcset, setiap gambar harus memakai rasio aspek yang sama agar atribut width dan height pada <img> dapat ditetapkan. [E103]
