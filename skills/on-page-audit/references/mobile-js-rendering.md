# Mobile-first indexing dan rendering JavaScript

Rujukan audit versi seluler dan rendering JavaScript. Semua butir bersumber dari dokumentasi Google Search Central.

## Mobile-first indexing

- Google memakai versi seluler konten situs, yang di-crawl dengan smartphone agent, untuk indexing dan ranking (mobile-first indexing). [E117]
- Gunakan robots meta tag yang sama di situs seluler dan desktop; robots meta tag berbeda di situs seluler (terutama noindex atau nofollow) dapat membuat Google gagal meng-crawl dan mengindeks halaman. [E118]
- Jangan lazy-load konten utama saat interaksi pengguna; Google tidak memuat konten yang memerlukan interaksi seperti swipe, klik, atau mengetik. [E119]
- Jangan blokir URL sumber daya seluler dengan aturan disallow jika ingin Google meng-crawlnya. [E120]
- Pastikan situs seluler memuat konten yang sama dengan desktop (indeks situs berasal dari situs seluler) dan memakai heading yang sama jelas dan bermakna seperti di desktop. [E121] [E122] [E123]
- Pastikan title dan meta description setara di kedua versi situs. [E124]
- Pakai alt text gambar yang sama di situs seluler seperti di desktop. [E125]
- Gunakan URL canonical dan alternate dengan benar pada situs URL terpisah: URL desktop selalu menjadi canonical dan versi seluler menjadi alternate. [E126]
- Pada URL terpisah, pastikan status halaman error sama di desktop dan seluler; halaman normal di desktop yang menjadi halaman error di seluler akan hilang dari indeks. [E127]
- Pada URL terpisah, jika URL desktop berbeda dialihkan ke satu URL seluler yang sama (misalnya beranda), semua halaman itu akan hilang dari indeks setelah domain diaktifkan untuk mobile-first indexing. [E128]
- Link hreflang pada URL terpisah harus menunjuk ke URL seluler untuk URL seluler dan ke URL desktop untuk URL desktop. [E129]
- Pada kebanyakan kasus, pakai aturan robots.txt yang sama untuk versi seluler dan desktop. [E130]
- Gunakan URL Inspection tool untuk memeriksa bahwa konten terlihat di halaman yang dirender (cara Google melihat halaman). [E131]

## Rendering JavaScript

- Google Search tidak merender JavaScript dari berkas yang diblokir atau pada halaman yang diblokir. [E132]
- Googlebot mengantre semua halaman berstatus HTTP 200 untuk dirender, kecuali robots meta tag atau header memberi tahu Google untuk tidak mengindeks halaman. [E133]
- Server-side rendering atau pre-rendering tetap ide yang bagus karena membuat situs lebih cepat bagi pengguna dan crawler, dan tidak semua bot dapat menjalankan JavaScript. [E134]
- <title> dan meta description dapat diatur atau diubah dengan JavaScript. [E135]
- Cara terbaik menetapkan URL canonical adalah lewat HTML; jika harus memakai JavaScript, selalu tetapkan nilai yang sama dengan HTML asli dan jangan mengubahnya menjadi URL lain. [E136]
- Gunakan kode status HTTP yang bermakna, misalnya 404 untuk halaman tidak ditemukan dan 401 untuk halaman di balik login. [E137]
- Pada single-page app dengan client-side rendering, hindari soft 404 dengan JavaScript redirect ke URL yang dijawab server dengan status 404. [E138]
- Alternatif menghindari soft 404 pada single-page app: tambahkan <meta name="robots" content="noindex"> ke halaman error menggunakan JavaScript. [E139]
- Google hanya dapat menemukan tautan berupa elemen HTML <a> dengan atribut href. [E140]
- Pada single-page app dengan client-side routing, pakai History API dan jangan memakai fragment untuk memuat konten halaman berbeda. [E141]
- Googlebot melakukan caching agresif dan WRS dapat mengabaikan header caching sehingga dapat memakai JavaScript atau CSS usang; content fingerprinting pada nama berkas menghindari masalah ini. [E142] [E143]
- Untuk web components, Google hanya melihat konten yang terlihat di HTML hasil render; periksa dengan Rich Results Test atau URL Inspection Tool. Konten yang tidak terlihat di HTML hasil render tidak dapat diindeks Google. [E144] [E145]
