# Gambar kompleks dan SVG

## Gambar kompleks (grafik, bagan, infografik, diagram)

Rujukan ini memuat aturan W3C untuk gambar yang memuat banyak informasi serta aturan untuk SVG.

- Gambar kompleks memuat informasi substansial, lebih dari yang bisa disampaikan dalam satu frasa atau kalimat pendek. [E42]
- Gambar kompleks biasanya mencakup grafik dan bagan, termasuk flow chart dan bagan organisasi. [E43]
- Gambar kompleks memerlukan teks alternatif dua bagian: deskripsi singkat untuk mengidentifikasi gambar dan, bila sesuai, menunjukkan lokasi deskripsi panjang. [E44]
- Bagian kedua adalah deskripsi panjang, yaitu representasi tekstual dari informasi esensial yang disampaikan gambar. [E45]
- Deskripsi panjang memuat informasi rinci, termasuk skala, nilai, hubungan, dan tren yang direpresentasikan secara visual. [E46]
- Jika komposisi gambar penting, masukkan ke deskripsi panjang; misalnya urutan warna dan tinggi relatif kolom pada bagan batang mungkin relevan selain nilai dan tren. [E47]
- Jadikan deskripsi panjang tersedia untuk semua orang, misalnya dengan menampilkannya sebagai bagian dari konten utama. [E48]
- Rujuk dan ringkas gambar yang lebih kompleks dari teks yang menyertainya. [E49]
- Tautan teks diletakkan di sebelah gambar dan merujuk ke halaman terpisah atau bagian halaman yang sama yang memuat deskripsi panjang; teks tautan harus memperjelas tujuan dan mengaitkannya dengan gambar. [E104]
- Tautan teks ke deskripsi panjang didukung semua peramban dan teknologi bantu, dan deskripsi panjangnya tersedia bagi semua orang, termasuk mesin pencari dan program lain; kekurangannya, tautan tidak terkait secara semantik dengan gambar. [E50]
- Elemen HTML5 <figure> dan <figcaption> dapat dipakai untuk mengelompokkan gambar dan tautan secara semantik; role="group" pada figure menjaga kompatibilitas dengan peramban yang tidak mendukung semantik bawaan <figure>. [E51]
- Jika deskripsi panjang ada di halaman yang sama, lokasinya dapat dijelaskan lewat atribut alt gambar, dan informasi lokasi harus jelas dan akurat. [E52]
- Atribut aria-describedby dapat menautkan gambar ke deskripsi yang ada di mana saja pada halaman yang sama; nilainya adalah id elemen yang memuat deskripsi panjang. [E53]
- Elemen yang dirujuk aria-describedby diperlakukan sebagai satu paragraf teks yang berkelanjutan, sehingga pendekatan ini hanya cocok untuk deskripsi panjang berupa teks saja tanpa struktur. [E54][E55]

## SVG

Aturan berikut berlaku untuk grafik yang dibuat sebagai kode SVG.

- SVG dapat dirujuk di atribut src elemen <img> seperti format gambar lain (PNG, JPEG, GIF); dalam hal ini contoh-contoh tutorial W3C berlaku juga untuk SVG. [E56]
- Karena SVG berupa tag seperti HTML, kodenya dapat dipakai langsung di HTML5; berikan teks alternatif di elemen <title> dalam SVG dan rujuk title itu dari atribut aria-labelledby pada elemen <svg> untuk meningkatkan dukungan aksesibilitas. [E57]
- Google Search mendukung gambar pada atribut src elemen img dalam format BMP, GIF, JPEG, PNG, WebP, SVG, dan AVIF. [E58]
- Pedoman gaya Google: pakai SVG sebagai ganti PNG jika tersedia, karena SVG tetap tajam saat gambar diperbesar. [E59]
