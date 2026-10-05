# Referensi: permintaan SERP API

## Parameter permintaan Live Google Organic SERP Advanced

Ringkasan parameter POST; semua dari dokumentasi endpoint tersebut.

- Kirim semua data POST dalam format JSON (encoding UTF-8). [E78]
- Tulis karakter % sebagai %25 dan karakter + sebagai %2B di field keyword. [E79]
- Gunakan location_name (mis. London,England,United Kingdom) sebagai alternatif location_code; wajib bila location_code dan location_coordinate tidak diisi. [E80]
- Gunakan location_coordinate dengan format "latitude,longitude,radius" bila perlu lokasi berbasis koordinat. [E81]
- Batasi location_coordinate: maksimum 7 digit desimal untuk latitude dan longitude, radius minimum 199 dan maksimum 199999. [E82]
- Gunakan language_name (mis. English) sebagai alternatif language_code; opsional bila language_code diisi. [E83]
- Pakai max_crawl_pages (maksimum 100) untuk membatasi jumlah halaman hasil pencarian yang di-crawl; biaya dikenakan per halaman yang di-crawl (10 hasil organic per halaman). [E84]
- Pakai stop_crawl_on_match (hingga 10 objek target) untuk menghentikan crawl; respons berisi hasil SERP sampai dan termasuk match_value yang ditentukan. [E85]
- Isi match_type (domain, with_subdomains, atau wildcard) bila stop_crawl_on_match diisi. [E86]
- Pakai remove_from_url (hingga 10 parameter) untuk menghapus parameter tertentu, misalnya srsltid, dari URL pada hasil. [E87]
- Pakai tag (maksimum 255 karakter) untuk menandai task dan mencocokkannya dengan hasil; nilainya muncul di objek data pada respons. [E88]
- Pakai calculate_rectangles untuk menghitung pixel rankings elemen SERP; parameter ini dikenai biaya tambahan $0.002. [E89]
- Atur browser_screen_width hanya bersama calculate_rectangles=true. [E90]
- Ingat bahwa hasil task berparameter target hanya memuat elemen SERP yang memiliki string url. [E91]
- Aktifkan stop_crawl_on_match terlebih dulu sebelum memakai target_search_mode. [E92]
- Ingat batas pengiriman SERP API: hingga 2000 panggilan POST dan GET per menit secara total, dengan tiap POST berisi paling banyak 100 task. [E93]
- Pakai pingback_url atau postback_url pada metode Standard bila ingin diberi tahu atau dikirimi hasil saat task selesai. [E94]
- Ketahui tiga fungsi SERP standar: Regular, Advanced, dan HTML. [E95]
- Ingat bahwa fungsi Advanced didukung di semua search engine SERP API dan memberi gambaran lengkap hasil pencarian. [E96]
- Ingat bahwa fungsi HTML memberikan halaman HTML SERP mentah untuk keyword, search engine, dan lokasi. [E97]
- Ingat bahwa Google News, Images, Search By Image, dan Jobs saat ini hanya tersedia untuk desktop. [E98]
- Ingat bahwa metode Standard punya dua prioritas, normal dan high, dengan harga berbeda. [E99]
