# Penerapan dalam Meridian

Ini kontrak implementasi proyek, bukan tambahan klaim spesifikasi resmi M3.

Site Builder menggunakan OpenAI untuk identitas situs dan pemilihan foto. Layout HTML/CSS dibuat oleh `server/sitebuild.ts`; perubahan layout harus dilakukan dan diuji pada generator itu. Jangan mengaku membuat, merender, atau mengaudit layout hanya karena identitas JSON berhasil dibuat.

`references/tokens.css` adalah sumber lapisan token generator. `server/theme.ts` menimpa peran warna dengan dua skema HCT dari warna sumber identitas, serta mengganti typeface brand/plain dan pengali tinggi baris sesuai bahasa. Jangan mengembalikan warna komponen individual atau ukuran huruf baru dalam jawaban identitas. Pilih satu warna sumber, pasangan font yang tersedia dan label lokal dalam sentence case.

Generator harus mempertahankan HTML semantik, fokus keyboard terlihat, state hover/focus/pressed, target navigasi dan daftar isi minimal 48px, teks navigasi utuh, tautan isi bergaris bawah, serta reduced motion. Tidak ada script atau font eksternal; foto mempunyai dimensi intrinsik dan gambar utama tidak lazy-load.

Uji halaman beranda, artikel, kategori dan Tentang pada 360/600/840/1200/1600px. Periksa terang/gelap, teks panjang, bahasa bertanda tinggi dan RTL. `checkSite` memeriksa konsistensi token dan struktur berkas, tetapi bukan pengganti pemeriksaan browser, kontras atau pengukuran Core Web Vitals di lapangan. Preview lokal bukan penerbitan; deployment tetap memerlukan persetujuan manusia.
