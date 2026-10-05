# Google Images dan favicon

## Agar gambar ditemukan dan diindeks Google

Rujukan ini memuat panduan Google Search Central untuk gambar, structured data, dan favicon.

- Persyaratan teknis agar konten muncul di hasil pencarian Google berlaku juga untuk gambar. [E60]
- Gunakan elemen HTML <img> standar untuk menyematkan gambar karena membantu crawler menemukan dan memproses gambar. [E61]
- Google dapat menemukan gambar di atribut src elemen <img>, bahkan saat berada di dalam elemen lain seperti <picture>. [E62]
- Kirim image sitemap untuk memberi tahu Google URL gambar yang mungkin belum ditemukan. [E63]
- Pada image sitemap, elemen <image:loc> dapat berisi URL dari domain lain sehingga CDN dapat dipakai untuk menghosting gambar. [E64]
- Halaman web memakai elemen <picture> atau atribut srcset pada img untuk gambar responsif, tetapi beberapa peramban dan crawler tidak memahami atribut tersebut; selalu tentukan URL cadangan dengan atribut src. [E65]
- Saat memakai elemen <picture>, sediakan elemen img sebagai cadangan dengan atribut src. [E66]
- Anda dapat memengaruhi gambar yang dipilih Google dengan memberikan gambar pilihan lewat salah satu sumber metadata. [E67]
- Sumber metadata gambar pilihan: properti schema.org primaryImageOfPage (URL atau ImageObject); properti image (URL atau ImageObject) yang dilekatkan ke entitas utama lewat mainEntity atau mainEntityOfPage; atau meta tag og:image. [E105][E106][E107]
- Saat memilih gambar pilihan untuk markup schema.org atau meta tag og:image, pilih gambar yang relevan dan representatif untuk halaman. [E68]
- Hindari gambar generik (misalnya logo situs) atau gambar bertulisan pada markup schema.org atau meta tag og:image. [E69]
- Saat memilih gambar pilihan itu, hindari gambar dengan rasio aspek ekstrem (terlalu sempit atau terlalu lebar), dan gunakan resolusi tinggi jika memungkinkan. [E70]
- Jika memakai structured data, Google dapat menampilkan gambar di rich result tertentu, termasuk badge yang menonjol di Google Images. [E71]
- Ikuti pedoman umum structured data dan pedoman jenis spesifiknya; jika tidak, structured data mungkin tidak memenuhi syarat untuk tampil sebagai rich result di Google Images. [E72]
- Saat gambar ditetapkan sebagai properti structured data, gambar itu harus relevan dengan halamannya. [E73]
- Semua URL gambar di structured data harus dapat di-crawl dan diindeks; jika tidak, Google Search tidak dapat menemukan dan menampilkannya. [E74]
- Sebisa mungkin, letakkan gambar di dekat teks yang relevan dan pada halaman yang relevan dengan pokok bahasan gambar. [E75]
- Nama berkas dapat memberi Google petunjuk yang sangat ringan tentang pokok bahasan gambar; bila memungkinkan pakai nama berkas yang pendek tetapi deskriptif. [E76]
- Contoh Google: my-new-black-kitten.jpg lebih baik daripada IMG00023.JPG; hindari nama generik seperti image1.jpg, pic.gif, atau 1.jpg bila memungkinkan. [E77]
- Jika gambar dilokalkan, terjemahkan juga nama berkasnya, dengan memperhatikan pedoman URL encoding bila memakai karakter non-latin atau khusus. [E78]
- Jika satu gambar dirujuk di banyak halaman, rujuk dengan URL yang sama secara konsisten agar Google dapat menyimpan dan memakai ulang gambar tanpa memintanya berkali-kali. [E79]

## Favicon untuk hasil pencarian Google

Berikut persyaratan favicon situs yang dapat tampil di hasil Google Search.

- Tambahkan tag <link> di header beranda dengan sintaks <link rel="icon" href="/path/to/favicon.ico">. [E80]
- Google Search hanya mendukung satu favicon per situs, dan situs didefinisikan berdasarkan hostname. [E81]
- Favicon harus persegi (rasio 1:1) dengan ukuran minimal 8x8px; Google merekomendasikan favicon lebih besar dari 48x48px. [E82]
- Format berkas favicon yang didukung Google Search: BMP, GIF, ICO, PNG, JPEG, PPM, dan TIFF. [E83]
- URL favicon harus stabil; jangan sering mengubah URL-nya. [E84]
- Googlebot-Image harus dapat meng-crawl berkas favicon dan Googlebot harus dapat meng-crawl beranda; keduanya tidak boleh diblokir. [E85]
