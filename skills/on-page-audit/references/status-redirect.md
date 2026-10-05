# Status HTTP dan redirect

Rujukan audit status HTTP dan redirect. Semua butir bersumber dari dokumentasi Google Search Central dan Crawling infrastructure.

## Status HTTP

- Jika server merespons dengan 2xx, konten yang diterima dapat dipertimbangkan untuk diindeks. [E146]
- Status 2xx dengan konten yang menyiratkan error (halaman kosong atau pesan error) ditampilkan Search Console sebagai soft 404. [E147]
- Secara default crawler Google mengikuti hingga 10 hop redirect; Googlebot umumnya mengikuti 10 hop untuk konten web umum, sedangkan Google Inspection Tools tidak mengikuti redirect. [E148] [E149]
- Konten dari URL yang mengalihkan diabaikan, dan konten URL tujuan akhir yang diproses. [E150]
- Status 301: Google mengikuti redirect dan memakainya sebagai sinyal kuat bahwa target redirect harus diproses. [E151]
- Status 302: secara default crawler mengikuti redirect dan memakainya sebagai sinyal lemah bahwa target redirect harus diproses. [E152]
- Status 307 setara dengan 302, dan status 308 setara dengan 301. [E153] [E154]
- Google tidak memakai konten dari URL berstatus 4xx; Google Search tidak mengindeks URL berstatus 4xx dan URL yang sudah terindeks lalu berstatus 4xx dihapus dari indeks. [E155]
- Status 429 diperlakukan sebagai sinyal server kelebihan beban dan dianggap sebagai server error. [E156]
- Error 5xx dan 429 membuat crawler Google memperlambat crawl sementara; URL yang sudah terindeks dipertahankan tetapi akhirnya dihapus, dan URL yang terus-menerus mengembalikan server error dihapus dari indeks oleh pipeline indexing. [E157] [E158]
- Setelah server kembali merespons 2xx, Google meningkatkan crawl rate situs secara bertahap. [E159]

## Redirect

- Redirect permanen menampilkan target redirect baru di hasil pencarian, sedangkan redirect sementara menampilkan halaman sumber. [E160]
- Untuk mengubah URL halaman sebagaimana tampil di hasil pencarian, Google menyarankan redirect permanen sisi server (server-side) sedapat mungkin; status 301 dan 308 berarti halaman pindah permanen. [E161] [E162]
- Metode redirect diurutkan menurut kemungkinan Google menafsirkannya dengan benar; redirect sisi server memiliki peluang tertinggi. [E163]
- Redirect permanen dipakai pipeline indexing sebagai sinyal bahwa target redirect harus menjadi canonical. [E164]
- Redirect sementara tidak dipakai sebagai sinyal canonical, tetapi halaman target mungkin tetap diindeks jika ada sinyal kanonikalisasi lain. [E165]
- Jika halaman dapat diakses lewat beberapa URL, pilih satu URL preferred (canonical) dan alihkan lalu lintas dari URL lain ke URL tersebut. [E166]
- Jika redirect sisi server tidak memungkinkan pada platform, meta refresh dapat menjadi alternatif. [E167]
- Google menafsirkan instant meta refresh sebagai redirect permanen dan delayed meta refresh sebagai redirect sementara. [E168] [E169]
- Setelah pindah domain, URL lama kemungkinan besar masih sesekali muncul meski URL baru sudah terindeks; ini normal. [E170]
