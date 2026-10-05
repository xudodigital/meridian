# Optimasi CLS: detail

Detail teknik pencegahan layout shift dari web.dev. Berlaku bersama SKILL.md.

## Diagnosis CLS

Cara membedakan CLS saat load dan CLS setelah load.

- Tool lab seperti Lighthouse biasanya hanya memuat halaman dasar sehingga mungkin tidak menampilkan CLS penuh sebuah halaman. [E178]
- Layout shift yang terjadi dalam 500 milidetik setelah interaksi pengguna dikecualikan dari skor CLS karena dianggap diharapkan. [E179]
- Konten lazy-loaded yang termuat saat pengguna scroll dan menggeser halaman dapat dihitung sebagai CLS. [E180]
- CLS sering terjadi saat pengguna scroll ketika konten lazy-loaded termuat tanpa ruang yang dicadangkan. [E181]
- Konten yang bergeser saat pointer diarahkan ke atasnya (hover) juga penyebab umum CLS setelah load. [E182]
- Pergeseran apa pun pada kedua interaksi itu (scroll dan hover) dihitung tidak terduga, bahkan jika terjadi dalam 500 milidetik. [E183]
- Perbedaan antara CLS CrUX dan Lighthouse sering menandakan CLS setelah load. [E184]
- Di Lighthouse, audit CLS menunjukkan gambar tanpa width dan height serta elemen yang bergeser saat load. [E185]

## Gambar dan video

Bagian ini membahas ruang untuk media.

- Selalu sertakan atribut width dan height pada elemen gambar dan video. [E186]
- Alternatifnya, cadangkan ruang dengan CSS aspect-ratio atau yang serupa. [E187]
- Browser modern menghitung aspect ratio default dari atribut width dan height sebelum gambar dimuat, sehingga atribut tersebut mencegah layout shift. [E188]
- Untuk gambar dalam container, ubah ukuran dengan CSS lebar container dan height: auto agar tidak memakai tinggi tetap. [E189]
- Gambar tanpa dimensi tidak memiliki ruang yang dialokasikan sampai browser mulai mengunduhnya dan mengetahui ukurannya. [E190]
- Pada responsive images dengan srcset, setiap gambar harus memakai aspect ratio yang sama agar width dan height pada <img> bisa ditetapkan. [E191]
- Chrome, Firefox, dan Safari mendukung width dan height pada elemen <source> di dalam <picture>. [E192]

## Iklan, embed, dan konten yang dimuat belakangan

Ruang untuk konten dinamis.

- Iklan, embed, iframe, dan konten yang disuntikkan secara dinamis dapat membuat konten sesudahnya bergeser ke bawah dan menaikkan CLS. [E193]
- Cadangkan ruang untuk konten yang dimuat belakangan di layout awal. [E194]
- Tambahkan aturan CSS min-height untuk mencadangkan ruang, atau pakai properti aspect-ratio untuk konten responsif seperti iklan. [E195]
- Untuk konten tanpa tinggi tetap seperti iklan, ukuran ruang yang tepat mungkin tidak bisa dicadangkan sehingga pergeseran tidak sepenuhnya hilang. [E196]
- Menetapkan ukuran awal ke ukuran terkecil yang akan dipakai dengan min-height mengurangi dampak pergeseran dibanding ukuran awal 0px. [E197]
- Hindari meruntuhkan ruang yang dicadangkan; tampilkan placeholder jika, misalnya, tidak ada iklan yang dikembalikan. [E198]
- Menghapus ruang yang disisihkan dapat menyebabkan CLS sebanyak menyisipkan konten. [E199]
- Konten yang disuntikkan dekat bagian atas viewport biasanya menyebabkan pergeseran lebih besar daripada yang di bagian bawah viewport. [E200]
- Jika ruang tidak bisa dicadangkan, letakkan konten yang disuntikkan lebih rendah pada halaman untuk mengurangi dampak CLS. [E201]
- Untuk banner dan form yang muncul tiba-tiba, cadangkan ruang di muka (misalnya placeholder atau skeleton UI). [E202]
- Alternatifnya, tempatkan elemen di luar alur dokumen dengan overlay bila masuk akal. [E203]
- Saat memuat konten tambahan, pengguna dapat memulai pemuatan sendiri (misalnya tombol "Load more" atau "Refresh") agar pergeseran tidak mengejutkan. [E204]
- Ganti konten lama dengan konten baru di dalam container berukuran tetap atau pakai carousel, dan nonaktifkan link serta kontrol sampai transisi selesai. [E205]
- Jika interaksi pengguna memicu request jaringan yang lama, sediakan ruang dan tampilkan loading indicator segera. [E206]

## Animasi dan web font

Properti CSS dan font yang memengaruhi layout shift.

- Properti top dan left menyebabkan layout shift saat dianimasikan, bahkan jika elemen berada di layer sendiri; hindari menganimasikan properti ini. [E207]
- Animasi transform (translate, scale, rotate, skew) dapat mengubah elemen tanpa memicu re-layout. [E208]
- Alih-alih mengubah height dan width, pakai transform: scale(). [E209]
- Untuk memindahkan elemen, hindari mengubah top, right, bottom, atau left dan pakai transform: translate(). [E210]
- Hormati pengaturan browser prefers-reduced-motion karena sebagian pengunjung dapat terganggu oleh animasi. [E211]
- Baik FOUT maupun FOIT dapat menyebabkan layout shift karena teks tetap ditata dengan font fallback. [E212]
- font-display: optional dapat menghindari re-layout karena web font hanya dipakai jika sudah tersedia saat layout awal. [E213]
- Tentukan font fallback yang sesuai, misalnya font-family: "Google Sans", sans-serif; bukan hanya nama web font. [E214]
- Perkecil perbedaan ukuran antara font fallback dan web font dengan size-adjust, ascent-override, descent-override, dan line-gap-override. [E215]
- Muat web font kritis sedini mungkin dengan <link rel=preload>. [E216]

## bfcache dan pengukuran

Teknik tambahan dan catatan pengukuran CLS.

- Memastikan halaman memenuhi syarat back/forward cache (bfcache) adalah teknik yang sangat efektif untuk menjaga CLS tetap rendah. [E217]
- Tetap usahakan menghindari pergeseran pada load awal, karena bfcache hanya mengurangi dampak pada navigasi back/forward. [E218]
- Untuk mengukur CLS di JavaScript, kelompokkan entri layout-shift ke dalam session dan hitung nilai session maksimum. [E219]
- CLS perlu dilaporkan setiap kali halaman masuk background, selain saat di-unload. [E220]
- Jika halaman dipulihkan dari back/forward cache, nilai CLS harus direset ke nol karena dialami sebagai kunjungan halaman yang berbeda. [E221]
