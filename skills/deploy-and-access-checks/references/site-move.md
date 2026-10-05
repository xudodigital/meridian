# Redirect dan pindah domain

## Redirect dan pindah domain

- Redirect permanen menampilkan target redirect di hasil pencarian; redirect sementara menampilkan halaman sumber. [E158]
- Kode 301 dan 308 berarti halaman pindah permanen ke lokasi baru, dan redirect permanen sisi server dianjurkan bila memungkinkan. [E159]
- Untuk mengalihkan pengguna ke halaman lain secara sementara, pakai redirect sementara; ini juga memastikan Google tidak terpengaruh oleh redirect, yang dapat membantu mempertahankan URL lama di hasil pencarian. [E160]
- Meta refresh instan (terpicu begitu halaman dimuat di browser) ditafsirkan Google Search sebagai redirect permanen, sedangkan meta refresh tertunda (terpicu setelah sejumlah detik yang ditetapkan pemilik situs) ditafsirkan sebagai redirect sementara. [E161]
- Setelah pindah domain, Google sangat mungkin sesekali masih menampilkan URL lama meski URL baru sudah terindeks; ini normal. [E162]
- Alur pindah situs: siapkan dan uji situs baru, siapkan pemetaan URL lama ke baru, mulai pindah dengan mengonfigurasi server untuk redirect, dan pantau lalu lintas di URL lama maupun baru. [E163]
- Ubah satu hal pada satu waktu; rencanakan perubahan situs berurutan, bukan sekaligus. [E164]
- Siapkan robots.txt situs baru agar aturannya mencerminkan bagian yang memang ingin diblokir dari crawling. [E165]
- Hapus blokir noindex atau robots.txt yang hanya diperlukan selama migrasi. [E166]
- Tidak masalah bila situs tidak punya robots.txt, tetapi kembalikan status 404 yang benar bila berkasnya tidak ada. [E167]
- Untuk perpindahan ke HTTPS, ambil dan konfigurasikan sertifikat TLS yang diperlukan di server. [E168]
- Konten lama yang tidak dipindahkan harus mengembalikan HTTP 404 atau 410 di situs baru. [E169]
- Verifikasi semua varian situs lama dan baru di Search Console, misalnya www dan non-www, serta HTTPS dan HTTP bila memakai URL HTTPS. [E170]
- Pastikan server memiliki sumber daya komputasi yang cukup: setelah migrasi, Google sementara meng-crawl situs baru lebih sering dari biasanya; pastikan situs baru berkapasitas memadai untuk menangani peningkatan lalu lintas dari Google. [E171]
- Hindari rantai redirect: arahkan langsung ke tujuan akhir; bila tidak memungkinkan, jaga rantai tetap pendek, idealnya tidak lebih dari 3 dan kurang dari 5. [E172]
- Uji redirect dengan URL Inspection Tool untuk URL individual, atau alat baris perintah atau skrip untuk banyak URL. [E173]
- Jika mengganti nama domain atau subdomain, kirim Change of Address di Search Console untuk situs lama; alat ini hanya diperlukan saat pindah dari satu domain atau subdomain ke yang lain, dan tidak diperlukan untuk perpindahan HTTP ke HTTPS, www ke non-www pada domain yang sama, atau path dalam domain yang sama. [E174]
- Pertahankan redirect selama mungkin, umumnya setidaknya 1 tahun. [E175]
- Pantau log akses dan error server: crawling oleh Googlebot, URL yang tak terduga mengembalikan status error HTTP, dan lalu lintas pengguna normal. [E176]
