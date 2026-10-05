# Referensi: GA4 Data API

## Metode dan permintaan

Pilih metode dan susun permintaan.

- Gunakan `runReport` sebagai metode yang direkomendasikan untuk query laporan sederhana. [E115]
- Gunakan `batchRunReports` untuk membuat beberapa laporan dalam satu panggilan API. [E116]
- Gunakan `getMetadata` untuk menjelajahi dimensi dan metrik; responsnya juga memuat dimensi dan metrik kustom properti tersebut. [E117][E118]
- Kirim `POST` ke `https://analyticsdata.googleapis.com/v1beta/properties/GA_PROPERTY_ID:runReport`. [E119]
- Mulailah dengan `dateRanges`, minimal satu `dimensions`, dan minimal satu `metrics`; minimal satu metrik wajib ada. [E120][E121]
- Rentang tanggal dapat ditulis relatif, misalnya `"startDate": "7daysAgo", "endDate": "yesterday"`. [E122]
- Satu permintaan dapat memuat beberapa `dateRanges` (misalnya untuk membandingkan dua periode). [E123]
- Dimensi bersifat opsional pada `runReport` dan maksimal sembilan per permintaan. [E124]
- Filter dimensi lewat `FilterExpression` pada bidang `dimensionFilter`. [E125]
- Secara default laporan hanya berisi 10,000 baris pertama; tambahkan `"limit": 250000` untuk sampai 250,000 baris. [E126]
- Untuk laporan lebih dari 250,000 baris, kirim serangkaian permintaan dan lakukan paginasi. [E127]

## Dimensi dan metrik yang relevan

Definisi dari skema API.

- Dimensi `date` berformat YYYYMMDD. [E128]
- Dimensi `country` adalah negara asal aktivitas pengguna. [E129]
- Dimensi `landingPage` adalah path halaman pada pageview pertama dalam sesi. [E130]
- Dimensi `pagePath` adalah bagian URL antara hostname dan query string. [E131]
- Dimensi `sessionSource` dan `sessionMedium` adalah source dan medium yang memulai sesi; `sessionSourceMedium` menggabungkan keduanya. [E132][E133]
- Dimensi `sessionDefaultChannelGroup` didasarkan terutama pada source dan medium, dengan nilai antara lain Direct, Organic Search, Paid Social, Organic Social, Email, Affiliates, Referral, Paid Search, Video, dan Display. [E134]
- Metrik `sessions` menghitung sesi yang dimulai di situs atau aplikasi (event `session_start`). [E135]
- Metrik `activeUsers` adalah jumlah pengguna unik yang mengunjungi situs atau aplikasi; `totalUsers` adalah pengguna unik yang mencatat minimal satu event. [E136][E137]
- Sesi terlibat (`engagedSessions`) adalah sesi yang berlangsung lebih dari 10 detik, atau punya key event, atau punya 2 atau lebih screen view. [E138]
- `engagementRate` dikembalikan sebagai pecahan (0.7239 berarti 72.39%), bukan persen. [E139]
- `bounceRate` adalah persentase sesi yang tidak terlibat, dikembalikan sebagai pecahan. [E140]
- `screenPageViews` menghitung tampilan layar atau halaman, termasuk tampilan berulang pada satu halaman. [E141]
- `keyEvents` adalah jumlah key event; menandai event sebagai key event hanya memengaruhi laporan sejak waktu pembuatan dan tidak mengubah data historis. [E142]
- Metrik `organicGoogleSearchClicks` dan `organicGoogleSearchImpressions` berasal dari Search Console dan membutuhkan tautan Search Console yang aktif. [E143][E144]
- `organicGoogleSearchAveragePosition` dari Search Console juga membutuhkan tautan Search Console yang aktif. [E145][E146]

## Kuota Data API

Batas untuk properti Standard.

- Semua permintaan memerlukan project Google Cloud dan tunduk pada kuota; kuota terpakai baik dengan OAuth 2.0 maupun hanya API key. [E147][E148]
- Metode Core (`runReport`, `runPivotReport`, `batchRunReports`, `batchRunPivotReports`, `runAccessReport`, `getMetadata`, `checkCompatibility`, `createAudienceExports`) membebani kuota Core; `runRealtimeReport` membebani kuota Realtime. [E149]
- Batas Core properti Standard: 200,000 token per properti per hari dan 40,000 token per properti per jam. [E150][E151]
- Batas Core properti Standard: 14,000 token per project per properti per jam. [E152]
- Batas Core properti Standard: 10 permintaan bersamaan (concurrent) per properti. [E153]
- Kurangi concurrency dengan menunggu permintaan sebelumnya selesai sebelum mengirim yang berikutnya. [E154]
- Batas Core properti Standard: 10 server error per project per properti per jam; server error adalah kode 500 dan 503. [E155][E156]
- Jika kuota Server Errors habis untuk pasangan project dan properti, semua permintaan dari project itu ke properti tersebut diblokir. [E157]
- Sebagian besar permintaan membebani 10 token atau kurang; biaya token bergantung pada kompleksitas permintaan. [E158]
- Biaya token dapat naik karena jumlah baris yang besar, rentang tanggal yang panjang, dan volume event properti yang tinggi (properti dengan event lebih banyak dapat memakai lebih banyak token untuk query yang sama). [E159][E160][E161]
- Dimensi berkardinalitas tinggi seperti `pagePath` dapat menaikkan biaya token secara signifikan. [E162]
- Sertakan `"returnPropertyQuota": true` di body permintaan untuk mengetahui biaya token; respons memuat objek `PropertyQuota` dengan token terpakai dan sisa kuota. [E163][E164]
