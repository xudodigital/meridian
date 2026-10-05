# Referensi: kanonikalisasi dan sitemap


## Kanonikalisasi

Aturan memilih dan menandai URL kanonis.

- Pahami bahwa menyatakan preferensi kanonis adalah petunjuk (hint), bukan aturan; Google bisa memilih halaman lain sebagai kanonis. [E53]
- Redirect adalah sinyal kuat bahwa target redirect harus menjadi kanonis. [E54]
- Anotasi rel="canonical" adalah sinyal kuat bahwa URL yang ditentukan harus menjadi kanonis. [E55]
- Pencantuman di sitemap hanya sinyal lemah yang membantu URL di dalamnya menjadi kanonis. [E56]
- Penetapan URL kanonis tidak wajib; situs kemungkinan besar tetap baik tanpa preferensi kanonis. [E57]
- Jangan memakai robots.txt untuk kanonikalisasi; Google masih dapat mengindeks URL yang diblokir robots.txt tanpa kontennya. [E58]
- Jangan menetapkan URL kanonis berbeda untuk halaman yang sama lewat teknik yang berbeda (misalnya sitemap vs rel="canonical"). [E59]
- Sertakan rel="canonical" pada halaman kanonis itu sendiri (self-referential canonical). [E60]
- Jangan memakai noindex untuk mencegah pemilihan kanonis dalam satu situs, karena memblokir halaman sepenuhnya dari Search; anotasi rel="canonical" adalah solusi yang diutamakan. [E61]
- Bila memakai hreflang, tentukan halaman kanonis dalam bahasa yang sama, atau bahasa pengganti terbaik jika tidak ada. [E62]
- Saat menaut di dalam situs, tautkan ke URL kanonis, bukan URL duplikat. [E63]
- Pada client-side rendering, tetapkan URL kanonis di HTML sumber dan pastikan JavaScript tidak mengubah elemen canonical. [E64]
- Untuk rel="canonical" pilih salah satu: elemen link di HTML atau HTTP header; memakai keduanya sekaligus lebih rentan salah. [E65]
- Pasang elemen <link> dengan rel="canonical" di <head> halaman duplikat, menunjuk ke halaman kanonis. [E66]
- Gunakan URL absolut, bukan relatif, pada elemen rel="canonical". [E67]
- Jika dapat mengubah konfigurasi server, header HTTP respons link dengan atribut target rel="canonical" dapat dipakai sebagai ganti elemen HTML untuk menunjukkan URL kanonis dokumen, termasuk dokumen non-HTML seperti PDF. [E68]
- Metode HTTP header rel="canonical" hanya didukung untuk hasil web search. [E69]
- Jangan berharap anotasi rel="canonical" dengan atribut hreflang, lang, media, atau type dipakai untuk kanonikalisasi; gunakan anotasi alternate yang tepat. [E70]
- Pilih satu URL kanonis untuk tiap halaman dan kirimkan di sitemap; semua halaman yang tercantum di sitemap disarankan sebagai kanonis, dan Google yang memutuskan halaman mana (jika ada) yang duplikat berdasarkan kemiripan konten. [E71]
- Gunakan redirect untuk menyingkirkan halaman duplikat yang sudah ada. [E72]
- Bila halaman bisa dicapai lewat beberapa URL, pilih satu URL kanonis dan redirect lainnya ke sana. [E73]
- Google cenderung memilih HTTPS ketimbang HTTP sebagai kanonis, kecuali ada masalah atau sinyal yang bertentangan. [E74]
- Hindari sertifikat TLS/SSL buruk dan redirect HTTPS ke HTTP karena membuat Google sangat memilih HTTP. [E75]
- Jangan memasukkan versi HTTP halaman di sitemap atau anotasi hreflang sebagai ganti versi HTTPS. [E76]
- Untuk kanonikalisasi Google lebih menyukai URL yang menjadi bagian dari cluster hreflang. [E77]
- Untuk varian regional dengan bahasa yang sama, gunakan kanonikalisasi sekaligus hreflang. [E78]

## Sitemap

Aturan membuat dan mengirim sitemap untuk tiap situs negara.

- Jika halaman terhubung dengan baik, Google biasanya dapat menemukan sebagian besar situs. [E79]
- Anda mungkin memerlukan sitemap jika situs besar: umumnya pada situs besar lebih sulit memastikan setiap halaman ditautkan setidaknya oleh satu halaman lain. [E80]
- Batasi satu sitemap pada 50MB (tidak terkompresi) atau 50.000 URL, dan pecah menjadi beberapa sitemap jika lebih besar. [E81]
- Letakkan sitemap di root situs; kecuali dikirim lewat Search Console, sitemap hanya memengaruhi turunan dari direktori induknya. [E82]
- Masukkan URL yang ingin tampil di hasil pencarian Google. [E83]
- Bila konten sama bisa diakses lewat beberapa URL, masukkan URL pilihan saja ke sitemap. [E84]
- Jangan mengandalkan <priority> dan <changefreq>; Google mengabaikannya. [E85]
- Isi <lastmod> dengan akurat; Google memakainya bila konsisten dan dapat diverifikasi akurat. [E86]
- Pada sitemap teks, jangan letakkan apa pun selain URL di file. [E87]
- Untuk sitemap dengan lebih dari beberapa lusin URL, cara terbaik adalah membuat perangkat lunak situs yang menghasilkannya. [E88]
- Pahami bahwa mengirim sitemap hanyalah petunjuk (hint) dan tidak menjamin Google mengunduh atau memakainya untuk perayapan. [E89]
- Kirim sitemap lewat Sitemaps report di Search Console agar terlihat kapan Googlebot mengaksesnya dan error pemrosesan yang mungkin ada. [E90]
- Cantumkan lokasi sitemap di robots.txt dengan baris Sitemap: (boleh lebih dari satu). [E91]
- Untuk beberapa situs yang diverifikasi, Anda dapat membuat satu atau lebih sitemap berisi URL semua situs dan menyimpannya di satu lokasi. [E92]
- Pada lintas-kirim lewat robots.txt, isi tiap sitemap hanya dengan URL dari situs tersebut. [E93]
- Pada lintas-kirim lewat robots.txt, pastikan robots.txt tiap situs merujuk ke sitemap situs itu sendiri. [E94]

## Sumber

- g-sitemaps-overview: https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview (FETCHED: 2026-10-01)
- g-sitemaps-build: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap (FETCHED: 2026-10-01)
- g-canonical: https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls (FETCHED: 2026-10-01)
- g-canonical-what: https://developers.google.com/search/docs/crawling-indexing/canonicalization (FETCHED: 2026-10-01)
- g-starter-guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide (FETCHED: 2026-10-01)
