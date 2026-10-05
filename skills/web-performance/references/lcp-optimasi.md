# Optimasi LCP: detail

Detail teknik perbaikan LCP dari web.dev. Berlaku bersama SKILL.md.

## Diagnosis dan pembagian waktu LCP

Cara membaca masalah LCP sebelum mengubah template.

- Lihat apa yang dialami pengguna nyata, bukan hanya hasil alat lab seperti Lighthouse atau pengujian lokal. [E128]
- Home page cenderung dikunjungi pengguna baru sehingga sering dimuat tanpa cache dan menjadi halaman paling lambat di situs. [E129]
- TTFB yang tinggi dapat membuat target LCP 2,5 detik sulit dicapai, bahkan mustahil. [E130]
- Selisih besar antara TTFB dan FCP dapat berarti browser harus mengunduh banyak aset render-blocking. [E131]
- Selisih besar TTFB dan FCP juga bisa menjadi tanda situs yang sangat bergantung pada client-side rendering. [E132]
- Selisih besar antara FCP dan LCP menunjukkan resource LCP tidak langsung tersedia untuk diprioritaskan browser, misalnya teks atau gambar yang dikelola JavaScript dan bukan ada di HTML awal. [E133]
- Nilai LCP dapat dipecah menjadi empat subbagian yang tidak tumpang tindih dan tanpa celah, dan jumlahnya sama dengan total LCP. [E134]
- Optimalkan semua subbagian; optimasi satu bagian bisa hanya memindahkan waktu yang dihemat ke bagian lain tanpa memperbaiki LCP. [E135]
- Proporsi panduan: TTFB sekitar 40%, resource load delay di bawah 10%, resource load duration sekitar 40%, element render delay di bawah 10%. [E136]
- Proporsi tersebut adalah panduan, bukan aturan ketat. [E137]
- Dua subbagian yang bernama "delay" (resource load delay dan element render delay) sebaiknya sedekat mungkin dengan nol. [E138]

## Langkah 1: hilangkan resource load delay

Bagian ini membahas waktu mulai pemuatan resource LCP.

- Patokan: resource LCP sebaiknya mulai dimuat bersamaan dengan resource pertama yang dimuat halaman itu. [E139]
- Resource LCP harus dapat ditemukan dari sumber HTML. [E140]
- Jika elemen LCP adalah <img>, taruh atribut src atau srcset di markup HTML awal sehingga browser dapat menemukan resource LCP dengan memindai respons HTML. [E141]
- Resource LCP tidak dapat ditemukan dari pemindaian respons HTML jika <img> ditambahkan dinamis dengan JavaScript, di-lazy-load dengan library JavaScript yang menyembunyikan src atau srcset (data-src atau data-srcset), atau memerlukan CSS background image. [E142]
- Jika resource LCP hanya direferensikan dari file CSS atau JavaScript eksternal, preload resource itu dengan fetch priority tinggi. [E143]
- Contoh preload dengan prioritas tinggi untuk gambar LCP: <link rel="preload" fetchpriority="high" as="image" href="/path/to/hero-image.webp" type="image/webp">. [E144]
- Hindari loading="lazy" pada <img> yang menjadi LCP, karena gambar baru dimuat setelah layout memastikan gambar ada di viewport dan dapat mulai lebih lambat. [E145]
- Pasang fetchpriority="high" pada <img> yang kemungkinan besar menjadi elemen LCP. [E146]
- Memberi prioritas tinggi pada lebih dari satu atau dua gambar membuat pengaturan prioritas tidak membantu menurunkan LCP. [E147]
- Prioritas gambar yang tidak terlihat saat awal (misalnya slide carousel) dapat diturunkan dengan fetchpriority="low". [E148]
- Selalu periksa prioritas resource di DevTools dan uji perubahan dengan alat lab dan lapangan. [E149]

## Langkah 2: hilangkan element render delay

Bagian ini membahas penundaan render elemen LCP.

- Rendering seluruh halaman dapat terblokir oleh stylesheet atau script sinkron di <head> yang masih dimuat. [E150]
- Elemen LCP dapat disembunyikan oleh kode lain, misalnya library A/B testing yang masih menentukan eksperimen pengguna. [E151]
- Cara terbaik agar stylesheet tidak memblokir render elemen LCP adalah memperkecil ukurannya sampai lebih kecil dari resource LCP. [E152]
- Meng-inline stylesheet hanya direkomendasikan jika stylesheet kecil, karena konten inline di HTML tidak bisa memanfaatkan cache pada pemuatan berikutnya. [E153]
- Hapus CSS yang tidak dipakai (atau tunda pemuatannya). [E154]
- Tunda CSS non-kritis dengan memisahkan stylesheet menjadi gaya yang dibutuhkan saat load awal dan gaya yang bisa dimuat belakangan. [E155]
- Minify dan kompres CSS kritis untuk memperkecil ukuran transfer. [E156]
- Hampir tidak pernah perlu menambahkan script sinkron (tanpa async atau defer) di <head>, dan hal itu hampir selalu berdampak negatif pada kinerja. [E157]
- Jika JavaScript harus berjalan sedini mungkin, inline script itu, dan hanya bila script sangat kecil. [E158]
- Server-side rendering (SSR) membuat resource gambar dapat ditemukan dari sumber HTML dan konten halaman tidak menunggu request JavaScript tambahan. [E159]
- Kekurangan utama SSR adalah butuh waktu pemrosesan server tambahan yang dapat memperlambat TTFB. [E160]
- Jika arsitektur memungkinkan prerendering (static site generation), umumnya itu pilihan yang lebih baik untuk kinerja. [E161]
- Semua browser merender gambar di main thread, sehingga apa pun yang memblokir main thread dapat menambah element render delay. [E162]

## Langkah 3 dan 4: resource load duration dan TTFB

Mempercepat transfer resource dan respons HTML.

- Resource LCP sebuah halaman (jika ada) berupa gambar atau web font. [E163]
- Dekatkan server ke pengguna; cara terbaik adalah memakai content delivery network (CDN). [E164]
- Image CDN membantu karena mengurangi jarak tempuh resource dan umumnya juga memperkecil ukuran resource. [E165]
- Memuat banyak resource sekaligus, terutama banyak resource ber-fetchpriority tinggi, dapat memperlambat pemuatan resource LCP. [E166]
- Sajikan resource dengan kebijakan cache-control yang efisien agar kunjungan berikutnya dilayani dari cache. [E167]
- Jika font-display diatur selain auto atau block, teks selalu terlihat saat load dan LCP tidak terblokir request jaringan tambahan. [E168]
- Data URL punya caveat: resource tidak bisa di-cache dan bisa memperpanjang render delay karena biaya decode tambahan. [E169]
- Tidak ada yang bisa terjadi di frontend sebelum backend mengirim byte pertama, sehingga mempercepat TTFB memperbaiki semua metrik load lain. [E170]
- Minimalkan jumlah redirect yang harus dilewati pengunjung. [E171]
- Parameter URL unik untuk analitik dapat membuat konten cache di CDN edge tidak terpakai, sehingga semua request harus kembali ke origin server. [E172]

## Mengukur LCP lewat JavaScript

Catatan teknis untuk pengukuran LCP.

- Untuk mengukur LCP di JavaScript, gunakan Largest Contentful Paint API. [E173]
- Untuk analisis, hanya laporkan PerformanceEntry yang paling baru dikirim. [E174]
- Library web-vitals menangani perbedaan antara metrik dan API LCP, kecuali kasus iframe. [E175]
- Bila elemen terpenting berbeda dari elemen terbesar, waktu render elemen lain dapat diukur dengan Element Timing API. [E176]
- Disarankan menyetel header Timing-Allow-Origin agar metrik lebih akurat. [E177]
