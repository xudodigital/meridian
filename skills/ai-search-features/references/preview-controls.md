# Kontrol pratinjau dan snippet

Detail untuk bagian 5 SKILL.md. Setiap baris memiliki tag bukti.

## Featured snippets

Aturan dari dokumentasi featured snippets dan snippet.

- Kenali featured snippet sebagai kotak khusus yang format hasil biasanya dibalik dengan menampilkan snippet deskriptif lebih dulu; ia juga dapat muncul dalam kelompok related questions ("People Also Ask"). [E59] [E60]
- Untuk memblokir semua snippet (termasuk featured snippets dan snippet biasa) pada sebuah halaman, tambahkan aturan nosnippet pada halaman itu. [E61]
- Teks yang ditandai atribut data-nosnippet tidak akan muncul di featured snippets maupun snippet biasa. [E62]
- Bila nosnippet dan data-nosnippet sama-sama ada di halaman, nosnippet diutamakan dan snippet tidak ditampilkan untuk halaman itu. [E63]
- Untuk hanya memblokir featured snippets sambil mempertahankan snippet pada hasil biasa, coba atur max-snippet ke panjang yang lebih rendah; featured snippet hanya muncul bila cukup teks dapat ditampilkan untuk membuatnya berguna. [E64]
- Pada umumnya, makin pendek pengaturan max-snippet, makin kecil kemungkinan halaman muncul sebagai featured snippet; teruskan menurunkan nilainya bila halaman masih tampil. [E65]
- Gunakan nosnippet bila butuh solusi yang dijamin; max-snippet yang rendah tidak menjamin Google berhenti menampilkan featured snippets. [E66]

## Snippet dan meta description

Cara snippet dibuat dan praktik meta description.

- Perlakukan snippet sebagai dibuat otomatis terutama dari isi halaman; Google kadang memakai meta description bila dinilai memberi deskripsi lebih akurat. [E67]
- Buat meta description unik untuk setiap halaman; deskripsi yang identik atau mirip di semua halaman tidak membantu. [E68]
- Untuk situs besar berbasis database, pembuatan deskripsi secara terprogram dapat tepat dan dianjurkan; deskripsi yang baik mudah dibaca manusia dan beragam. [E69]
- Hindari meta description berisi deretan panjang keyword: Google menyatakan deskripsi seperti itu kurang jelas bagi pengguna dan lebih kecil kemungkinannya tampil sebagai snippet. [E70]

## "Read more" deep links

Praktik agar deep link "Read more" lebih mungkin muncul.

- Pastikan konten langsung terlihat oleh manusia di halaman, tidak tersembunyi di balik bagian yang dapat diperluas atau antarmuka bertab. [E71]
- Hindari memakai JavaScript untuk mengatur posisi scroll pengguna saat halaman dimuat. [E72]
- Jika memakai panggilan history API atau mengubah window.location.hash saat halaman dimuat, jangan menghapus hash fragment dari URL karena itu merusak perilaku deep linking. [E73]

## Aturan robots meta dan X-Robots-Tag

Spesifikasi aturan yang dapat dibaca Google.

- Perhatikan bahwa pengaturan robots meta tag, data-nosnippet, dan X-Robots-Tag hanya dapat dibaca dan diikuti bila crawler diizinkan mengakses halaman yang memuatnya. [E74]
- Gunakan header respons X-Robots-Tag untuk memblokir indexing sumber daya non-HTML seperti file PDF, video, atau gambar. [E75]
- Pahami nosnippet sebagai tidak menampilkan snippet teks atau pratinjau video; thumbnail gambar statis (jika ada) mungkin tetap terlihat bila menghasilkan pengalaman pengguna yang lebih baik. [E76]
- Pakai max-snippet:0 bila ingin tidak ada snippet; nilainya setara nosnippet. [E77]

## data-nosnippet

Aturan teknis atribut data-nosnippet.

- Untuk menandai bagian teks halaman HTML agar tidak dipakai sebagai snippet, pasang atribut data-nosnippet pada tingkat elemen HTML, yaitu pada elemen span, div, dan section. [E78]
- Perlakukan data-nosnippet sebagai boolean attribute: nilai apa pun yang ditulis diabaikan. [E79]
- Jangan menambah atau menghapus atribut data-nosnippet pada node yang sudah ada melalui JavaScript, untuk menghindari ketidakpastian akibat rendering. [E80]
- Saat menambahkan elemen DOM lewat JavaScript, sertakan atribut data-nosnippet sejak elemen pertama kali ditambahkan ke DOM halaman bila diperlukan. [E81]

## Structured data dan kontrol pratinjau

Hubungan robots meta tag dengan structured data.

- Perlakukan batasan robots meta tag sebagai tidak memengaruhi penggunaan structured data, kecuali article.description dan nilai description pada structured data karya kreatif lain. [E82]
- Untuk mengelola penggunaan structured data, ubah tipe dan nilai structured data itu sendiri dengan menambah atau menghapus informasi; structured data tetap dapat dipakai untuk hasil pencarian meski berada di dalam elemen data-nosnippet. [E83] [E84]
