# Referensi: Search Console API dan laporan

## Paginasi dan batas data

Cara menarik data lengkap.

- Jalankan satu query per hari untuk data satu hari; query harian untuk satu hari data tidak seharusnya melebihi kuota harian. [E46][E47]
- Isi `rowLimit` antara 1 sampai 25,000 (default 1,000). [E48]
- Untuk paginasi, ulangi query yang sama dengan menaikkan `startRow` sebesar 25,000 sampai respons berisi 0 baris. [E49]
- Metode Search Analytics hanya membuka maksimum 50K baris data per hari per jenis pencarian (diurutkan menurut klik), di luar kuota pemakaian API. [E50]
- API tidak menjamin mengembalikan semua baris data, melainkan baris teratas. [E51]
- Hasil diurutkan menurut klik menurun; jika dikelompokkan menurut `date`, hasil diurutkan menurut tanggal naik (terlama dulu). Baris dengan klik sama berurutan acak. [E52]

## Kesegaran data dan hari tanpa data

Gunakan `dataState` dan metadata.

- Data biasanya tersedia setelah 2-3 hari; ketahui data terbaru dengan query sederhana dikelompokkan menurut tanggal untuk 10 hari terakhir. [E53]
- Jika `date` menjadi dimensi, hari tanpa data dihilangkan dari hasil; untuk mengetahui hari mana yang punya data, kirim query tanpa filter yang dikelompokkan menurut tanggal. [E54][E55]
- Tanpa `dataState` (atau dengan `final`), data yang dikembalikan hanya data final; `all` menyertakan data segar. [E56][E57]
- `hourly_all` memberi rincian per jam dan dipakai saat mengelompokkan menurut dimensi `HOUR`; data per jam mencakup data parsial. [E58]
- Saat meminta data terbaru (`all` atau `hourly_all`), sebagian baris dapat tidak lengkap karena data masih dikumpulkan. [E59]
- Gunakan `first_incomplete_date` di `metadata` untuk menandai awal data yang belum lengkap; kolom ini hanya terisi jika `dataState` adalah `all`, data dikelompokkan menurut tanggal, dan rentang berisi titik data tidak lengkap. [E60]
- Nilai setelah `first_incomplete_date` mungkin masih berubah secara berarti. [E61]
- Semua tanggal dan waktu dalam objek `metadata` memakai zona waktu America/Los_Angeles. [E62]

## Agregasi dan detail data

Pilih agregasi dan dimensi sesuai kebutuhan.

- Jika memfilter atau mengelompokkan menurut `page`, pilih `aggregationType` `auto`; Anda tidak dapat agregasi menurut properti. [E63][E64]
- Impresi, klik, posisi, dan CTR dihitung secara berbeda saat mengelompokkan menurut halaman dibanding menurut properti. [E65]
- Untuk angka yang akurat, hilangkan dimensi `page` dan `query`. [E66]
- Meminta dimensi `page` dan/atau `query` dapat membuat sebagian data hilang karena sistem membuang data agar hasil dihitung dalam waktu dan sumber daya yang wajar. [E67]
- Data `searchAppearance` tidak tersedia bersama dimensi lain: query pertama memakai `searchAppearance` sebagai satu-satunya dimensi untuk daftar tipe. [E68][E69]
- Query kedua memfilter satu tipe `searchAppearance` dan boleh menambah dimensi; jalankan sekali per tipe yang ingin dilihat. [E70]

## Perbedaan angka antar laporan

Hal yang menyebabkan total tidak sama.

- Grafik pada laporan Performance diagregasi menurut properti: dua hasil dari situs yang sama untuk satu query dihitung sebagai satu impresi pada total grafik. [E71]
- Tabel dikelompokkan menurut dimensi: Queries, Countries, Devices, atau Dates diagregasi menurut properti; Pages atau Search appearance diagregasi menurut halaman. [E72]
- Total grafik dapat berbeda dari total tabel, biasanya karena perbedaan agregasi (properti vs halaman). [E73]
- Pada beberapa konfigurasi laporan, nilai posisi dapat tampil sebagai tanda strip (-); itu berarti tidak ada posisi tercatat karena pengguna tidak pernah melihat properti Anda untuk query itu. [E74]