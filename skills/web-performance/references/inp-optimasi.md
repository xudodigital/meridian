# Optimasi INP: detail

Detail teknik perbaikan INP dari web.dev. Berlaku bersama SKILL.md.

## Input delay

Bagian pertama dari latensi interaksi.

- Input delay dimulai saat pengguna memulai interaksi dan berakhir saat event callback mulai berjalan. [E222]
- Kurangi input delay seminimal mungkin agar event callback dapat mulai berjalan secepatnya. [E223]
- Input delay dapat berasal dari aktivitas main thread (script yang dimuat, di-parse, dan dikompilasi), fetch handling, timer, atau interaksi lain yang tumpang tindih. [E224]
- Pengguna dapat berinteraksi saat halaman masih dimuat; halaman yang sudah tampil belum tentu selesai dimuat. [E225]
- Setelah file JavaScript diunduh, browser masih harus mem-parse, mengompilasi ke bytecode, lalu mengeksekusinya. [E226]
- Bergantung pada ukuran script, pekerjaan itu dapat menimbulkan long task di main thread yang menunda respons terhadap interaksi lain. [E227]

## Event callback

Bagian kedua: processing duration.

- Saran umum terbaik: lakukan pekerjaan sesedikit mungkin di dalam event callback. [E228]
- Jika tidak bisa dikurangi banyak, pecah pekerjaan di event callback menjadi task terpisah agar tidak menjadi long task yang memblokir main thread. [E229]
- setTimeout adalah salah satu cara memecah task karena callback-nya berjalan di task baru. [E230]
- Yielding tanpa pandang bulu lebih baik daripada tidak yielding sama sekali. [E231]
- Cara yang lebih halus: yield tepat setelah event callback yang memperbarui antarmuka agar logika rendering bisa berjalan lebih cepat. [E232]
- Teknik lanjutan: batasi event callback hanya pada logika yang dibutuhkan untuk pembaruan visual frame berikutnya, dan tunda sisanya ke task berikutnya. [E233]
- setTimeout di dalam requestAnimationFrame berfungsi di semua browser untuk mencegah kode non-kritis memblokir frame berikutnya. [E234]
- Layout thrashing (memperbarui style di JavaScript lalu segera membaca nilainya) adalah bottleneck kinerja karena memaksa browser melakukan pekerjaan layout sinkron. [E235]

## Presentation delay

Bagian ketiga: dari akhir event callback sampai frame berikutnya dipresentasikan.

- Pekerjaan rendering cenderung membesar mengikuti ukuran DOM yang besar. [E236]
- DOM besar bermasalah pada render awal halaman dan saat merespons interaksi pengguna. [E237]
- Ada kasus DOM besar tidak bisa dikurangi banyak; teknik seperti meratakan DOM atau menambah DOM saat interaksi hanya sampai batas tertentu. [E238]
- Salah satu cara membatasi pekerjaan rendering saat load halaman dan saat merespons interaksi adalah memakai properti CSS content-visibility, yang pada dasarnya merender elemen secara lazy ketika mendekati viewport. [E239]
- HTML dari server tiba sebagai stream, dan browser mem-parse serta merender bagian demi bagian sambil secara implisit yield secara berkala. [E240]
- Pada model single-page application, merender HTML dengan JavaScript di klien menambah biaya pemrosesan JavaScript dan browser tidak yield sampai selesai mem-parse dan merender HTML itu. [E241]
- Merender HTML lewat JavaScript umumnya tidak masalah selama tidak merender HTML dalam jumlah besar di klien, yang dapat menunda presentasi frame berikutnya. [E242]

## Mengukur INP lewat JavaScript

Catatan teknis pengukuran INP.

- Ukuran INP di JavaScript memerlukan event timing semua interaksi, lalu persentil ke-98 pada saat halaman di-unload. [E243]
- Entri event di bawah 104 milidetik tidak dilaporkan secara default oleh performance observer. [E244]
- Jika halaman dipulihkan dari back/forward cache, nilai INP harus direset ke nol. [E245]
- INP perlu dilaporkan setiap kali halaman masuk background, selain saat di-unload. [E246]
- Library web-vitals menangani kasus tersebut kecuali kasus iframe. [E247]
