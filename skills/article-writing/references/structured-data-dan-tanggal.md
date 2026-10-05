# Structured data dan tanggal

Rujukan untuk SKILL.md; berlaku untuk tanggal artikel dan markup Article.

## Tanggal terbit dan pembaruan

Bagian ini membahas tanggal yang tampil pada artikel.

- Tambahkan tanggal yang terlihat pengguna pada halaman dan tampilkan secara menonjol. [E82]
- Beri label tanggal secara tepat dengan teks seperti "Publish" atau "Last updated". [E83]
- Tentukan tanggal dengan structured data: Google menyarankan subtipe CreativeWork (seperti Article, BlogPosting, atau VideoObject) dengan field datePublished dan/atau dateModified. [E84]
- Tanggal wajib, waktu tidak; namun Google menyarankan menyertakan waktu dan zona waktu dalam markup untuk presisi tambahan. [E85]
- Bila menentukan zona waktu, berikan zona waktu yang benar dengan memperhitungkan daylight saving time bila sesuai. [E86]
- Pastikan tanggal (dan waktu serta zona waktu opsional) pada tampilan yang terlihat pengguna cocok dengan nilai di structured data. [E87]
- Jangan menentukan tanggal di masa depan, atau tanggal aksi yang dijelaskan di halaman. [E88]
- Tanggal harus menggambarkan tanggal terbit atau pembaruan halaman, bukan cerita atau peristiwa yang dijelaskan di dalamnya. [E89]
- Minimalkan keberadaan tanggal lain di halaman: bila sudah mengikuti praktik terbaik dan menemukan tanggal yang salah terpilih, pertimbangkan menghapus sebagian atau semua tanggal lain yang muncul di halaman. [E90]

## Structured data Article

Bagian ini membahas markup Article.

- Objek Article harus berbasis salah satu tipe schema.org: Article, NewsArticle, atau BlogPosting. [E91]
- datePublished adalah tanggal dan waktu artikel pertama kali terbit dalam format ISO 8601; Google menyarankan menyertakan zona waktu, kalau tidak Google memakai zona waktu Googlebot. [E92]
- Cantumkan semua penulis yang ditampilkan sebagai penulis di halaman ke dalam markup. [E93]
- Jangan menggabungkan beberapa penulis dalam satu field author. [E94]
- Gunakan properti type dan url (atau sameAs) dengan URL valid untuk membantu Google memahami siapa penulisnya; Google sangat menyarankannya. [E95]
- Pada properti author.name, tulis hanya nama penulis dan jangan menambahkan informasi lain. [E96]
- Gunakan tipe Person untuk orang dan Organization untuk organisasi; jangan memakai tipe Thing dan jangan salah tipe. [E97]
- Untuk artikel multi-bagian, rel=canonical harus menunjuk ke tiap halaman individual atau halaman "view-all", bukan ke halaman 1 dari seri. [E98]

