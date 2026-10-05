# Referensi: navigasi berfacet, paginasi, dan crawl budget


## Navigasi berfacet dan filter

Aturan untuk URL hasil filter dan pengurutan pada halaman daftar.

- Waspadai navigasi berfacet berbasis parameter URL karena dapat menghasilkan ruang URL tak terbatas. [E95]
- Bila URL facet tidak perlu berpotensi diindeks, cegah perayapannya. [E96]
- Bila URL facet perlu berpotensi diindeks, pastikan URL tersebut mengikuti praktik terbaik URL facet. [E97]
- Gunakan robots.txt untuk melarang perayapan URL facet; izinkan hanya halaman item individual dan satu halaman daftar khusus tanpa filter. [E98]
- Filter berbasis fragmen URL tidak berdampak pada perayapan (positif maupun negatif). [E99]
- Bila memakai rel="nofollow" pada tautan ke hasil filter, setiap anchor ke URL tertentu harus memilikinya agar efektif. [E100]
- Gunakan pemisah parameter standar '&' untuk URL facet yang perlu diindeks, karena koma, titik koma, dan kurung sulit dideteksi crawler sebagai pemisah. [E101]
- Bila filter ditaruh di path URL, jaga urutan logis filter selalu sama dan pastikan tidak ada filter duplikat. [E102]
- Kembalikan status HTTP 404 bila kombinasi filter tidak menghasilkan apa pun. [E103]
- Kembalikan 404 juga untuk filter duplikat, kombinasi filter yang tidak masuk akal, dan URL paginasi yang tidak ada. [E104]
- Jangan mengalihkan kombinasi filter kosong ke halaman error umum; sajikan 404 di URL tempat ditemukan. [E105]

## Paginasi dan pemuatan bertahap

Aturan untuk daftar yang dipecah menjadi banyak halaman.

- Pagination berarti pengguna memakai tautan seperti "next", "previous", dan nomor halaman untuk berpindah antarhalaman yang menampilkan satu halaman hasil sekali waktu. [E106]
- Pahami bahwa crawler Google tidak "mengklik" tombol dan umumnya tidak memicu fungsi JavaScript yang butuh aksi pengguna. [E107]
- Bila memakai JavaScript, pertimbangkan sitemap atau feed Google Merchant Center agar Google menemukan semua produk. [E108]
- Tautkan tiap halaman ke halaman berikutnya dengan <a href>; ini dapat membantu Googlebot menemukan halaman lanjutan. [E109]
- Beri tiap halaman URL unik, misalnya dengan parameter ?page=n, karena URL dalam urutan paginasi diperlakukan sebagai halaman terpisah. [E110]
- Jangan menjadikan halaman pertama sebagai kanonis untuk seluruh urutan; beri tiap halaman URL kanonisnya sendiri. [E111]
- Jangan memakai fragmen URL (teks setelah #) untuk nomor halaman, karena Googlebot mungkin tidak mengikuti tautan yang hanya beda di fragmen. [E112]
- Cegah pengindeksan variasi daftar yang sama (filter atau urutan lain) dengan meta robots noindex atau pola URL di robots.txt. [E113]

## Crawl budget

Aturan crawl budget.

- Jika situs tidak punya banyak halaman yang berubah cepat, atau halaman tampak dirayapi pada hari yang sama saat diterbitkan, panduan crawl budget tidak perlu dibaca; khusus untuk Google Search, menjaga sitemap tetap terkini dan memeriksa laporan Page Indexing secara berkala sudah memadai. [E114]
- Panduan crawl budget adalah panduan lanjutan yang ditujukan terutama untuk jenis situs berikut, salah satunya situs besar (1 juta+ halaman unik) dengan konten yang berubah cukup sering (seminggu sekali). [E115]
- Tanpa panduan dari Anda, Google mencoba merayapi semua atau sebagian besar URL yang diketahuinya; faktor inventaris ini yang paling dapat Anda kendalikan. [E116]
- Konsolidasikan konten duplikat agar perayapan fokus pada konten unik, bukan URL unik. [E117]
- Jika tidak bisa dikonsolidasikan, blokir halaman tidak penting dengan robots.txt, misalnya infinite scroll yang menduplikasi informasi atau versi urutan berbeda dari halaman yang sama. [E118]
- Kembalikan 404 atau 410 untuk halaman yang dihapus permanen. [E119]
- Hilangkan soft 404 karena tetap dirayapi dan memboroskan budget. [E120]

## Sumber

- g-pagination: https://developers.google.com/search/docs/specialty/ecommerce/pagination-and-incremental-page-loading (FETCHED: 2026-10-01)
- g-faceted: https://developers.google.com/crawling/docs/faceted-navigation (FETCHED: 2026-10-01)
- g-crawl-budget: https://developers.google.com/crawling/docs/crawl-budget (FETCHED: 2026-10-01)
