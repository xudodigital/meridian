# Referensi: DataForSEO Google Ads Search Volume (Live)

## Parameter permintaan

Parameter berikut berlaku untuk POST /v3/keywords_data/google_ads/search_volume/live.

- Parameter keywords wajib diisi: maksimum 1000 kata kunci, 80 karakter per kata kunci, dan 10 kata per frasa. [E88]
- Kata kunci yang dikirim dikonversi ke huruf kecil. [E89]
- language_name dan language_code bersifat opsional; daftar bahasa yang tersedia dapat diterima lewat permintaan terpisah ke https://api.dataforseo.com/v3/keywords_data/google_ads/languages. [E90]
- search_partners bernilai default false, yaitu hasil dikembalikan untuk situs Google search. [E91]
- Jika search_partners diisi true, hasil mencakup jaringan milik, dioperasikan, dan sindikasi di Google dan situs mitra yang menjalankan Google search. [E92]
- date_from opsional dengan format yyyy-mm-dd dan nilai minimal 4 tahun dari tanggal sekarang. [E93]
- Secara default data dikembalikan untuk 12 bulan terakhir. [E94]
- date_to tidak boleh melebihi bulan lalu, karena Google Ads tidak mengembalikan data bulan berjalan. [E95]
- Data historis tersedia untuk 4 tahun. [E96]
- Gunakan sort_by untuk mengurutkan hasil menurun berdasarkan relevance, search_volume, competition_index, low_top_of_page_bid, atau high_top_of_page_bid. [E97]
- Gunakan tag (maksimum 255 karakter) untuk mengidentifikasi task dan mencocokkannya dengan hasil. [E98]

## Kolom hasil

Kolom berikut ada dalam array result.

- Kolom spell: jika kata kunci tampak salah eja, data dikembalikan untuk kata kunci dengan ejaan yang benar. [E99]
