# Komponen Material Design 3

Rangkuman dari `/components/*/specs` dan `/components/*/guidelines` di m3.material.io. dp = px CSS.

Dimensi di berkas ini sudah dicocokkan pada 1 Oktober 2026 dengan dua berkas token resmi: material-web v0.192 (komponen M3 dasar) dan `androidx.compose.material3.tokens` (ukuran M3 Expressive: tombol XS–XL, FAB medium, navigation bar 64px, navigation rail 96px dan 220–360px). Satu angka dikoreksi: padding tombol XS adalah 16px, bukan 12px.

Daftar komponen di situs: app bars, badges, bottom sheets, button groups, buttons, cards, carousel, checkbox, chips, date pickers, dialogs, divider, extended FAB, FAB, FAB menu, icon buttons, lists, loading indicator, menus, navigation bar, navigation drawer, navigation rail, progress indicators, radio button, search, segmented buttons, side sheets, sliders, snackbar, split button, switch, tabs, text fields, time pickers, toolbars, tooltips.

## Memilih komponen aksi

| Kebutuhan | Komponen |
|---|---|
| Aksi terpenting di halaman, satu saja | Tombol filled (atau FAB di aplikasi) |
| Aksi penting kedua | Tombol tonal |
| Alternatif di samping tombol filled | Tombol outlined |
| Aksi berprioritas rendah, dalam card, dialog, snackbar | Tombol text |
| Butuh pemisah dari latar ramai | Tombol elevated |
| Aksi ringkas dengan ikon yang dikenal | Icon button |
| Pilihan biner (simpan, favorit) | Toggle button |
| Filter, pilihan, saran | Chip |
| Tautan dalam kalimat | Teks bergaris bawah, bukan tombol text |

## Buttons

| | XS | S (bawaan) | M | L | XL |
|---|---|---|---|---|---|
| Tinggi | 32 | 40 | 56 | 96 | 136 |
| Padding kiri-kanan | 16 | 16 | 24 | 48 | 64 |
| Jarak ikon ke label | 8 | 8 | 8 | 12 | 16 |
| Tebal garis outlined | 1 | 1 | 1 | 2 | 3 |
| Ikon | 20 | 20 | 24 | 32 | 40 |
| Sudut bentuk round | penuh | penuh | penuh | penuh | penuh |
| Sudut bentuk square | 12 | 12 | 16 | 28 | 28 |
| Sudut saat ditekan | 8 | 8 | 12 | 16 | 16 |

- Padding 24 pada ukuran small adalah gaya lama; M3 Expressive memakai 16.
- XS dan S tetap bertarget 48px.

| Gaya | Container | Ikon dan label |
|---|---|---|
| Elevated | `surface-container-low`, elevasi 1 | `primary` |
| Filled | `primary` | `on-primary` |
| Tonal | `secondary-container` | `on-secondary-container` |
| Outlined | transparan, garis `outline-variant` | `on-surface-variant` |
| Text | transparan | `primary` |

Toggle terpilih: filled dan elevated menjadi `primary`/`on-primary`; tonal menjadi `secondary`/`on-secondary`; outlined menjadi `inverse-surface`/`inverse-on-surface`. Tidak ada toggle bergaya text. Peran lain boleh dipakai asal container dan teks berkontras 3:1.

Aturan:
- Label 1–3 kata, sentence case, satu baris, tidak terpotong. Lebar mengikuti label atau melebar mengikuti grid; tidak pernah lebih sempit dari label.
- Satu ikon saja, di sisi depan label.
- Filled: idealnya satu per halaman. Elevated: hanya bila perlu pemisah dari latar.
- Outlined dan text hanya di atas latar sederhana, bukan di atas gambar.
- Tombol text tidak digarisbawahi.
- Toggle: ikon outline saat tidak terpilih, ikon terisi saat terpilih; panjang label kedua keadaan mirip.

## Icon buttons
- Visual 40px, target 48px, ikon 24px. Ukuran XS–XL dan sudut mengikuti tabel tombol. Target 48px dibuat dengan `::after { inset: -4px }` (pola `.md-icon-button` di `tokens.css`); `width`/`height` 40px saja belum cukup.
- Label aksesibilitas menyebut aksi dan objeknya ("Delete invoice 1042"), bukan bentuk ikon ("trash can") dan bukan kata "button".
- Gaya: filled (`primary`/`on-primary`), tonal (`secondary-container`), outlined (`outline-variant`), standard (ikon `on-surface-variant`; terpilih `primary`).
- Wajib berlabel aksesibilitas.

## FAB
- Ukuran: FAB 56px, medium 80px, large 96px. Small tidak disarankan pada M3 Expressive.
- Warna: primary-container, secondary-container, tertiary-container, atau primary, secondary, tertiary.
- Elevasi 3. Satu per layar, untuk aksi utama layar itu. Jarang cocok untuk website konten.

## Cards
- Radius 12px. Padding kiri-kanan 16px. Jarak antar-card maksimal 8px. Teks rata depan.
- Elevated: `surface-container-low` + elevasi 1. Filled: `surface-container-highest`. Outlined: `surface` + garis `outline-variant`.
- Ketiganya setara fungsinya; pilih menurut gaya. Outlined paling tegas, filled paling halus.
- Isi: gambar, headline, subhead, teks pendukung, aksi. Hanya container yang wajib.
- Seluruh card boleh menjadi satu target. Menu overflow di sudut kanan atas atau bawah.
- Divider penuh untuk bagian yang bisa dibuka; divider inset untuk memisahkan isi yang berhubungan.
- Dalam kumpulan, card sebidang (elevasi sama). Filter dan pengurutan diletakkan di luar kumpulan.
- Jangan memaksa konten menjadi card bila spasi, heading, atau divider sudah cukup.

## Text fields
- Tinggi 56px; target 56px.
- Padding kiri-kanan 16px tanpa ikon, 12px dengan ikon; jarak ikon ke teks 16px.
- Teks pendukung dan penghitung karakter: 4px di bawah field; jarak di antaranya 16px.
- Filled: container `surface-container-highest`, sudut atas 4px dan bawah 0, garis bawah aktif; padding atas-bawah 8px.
- Outlined: garis `outline`, radius 4px; label terisi diberi padding 4px kiri-kanan.
- Label dan ikon `on-surface-variant`; teks masukan `on-surface`; saat fokus, label, garis, dan caret menjadi `primary`. Error memakai peran `error` dan pesan tampil sebagai teks pendukung.
- Setiap field berlabel dan label selalu terlihat (naik ke atas saat fokus atau terisi). Label satu baris, tidak terpotong.
- Field wajib ditandai asterisk dan dijelaskan sekali di awal formulir atau di teks pendukung.
- Jangan mencampur filled dan outlined dalam satu formulir atau wilayah.
- Di web, pakai text area (tinggi tetap, gulir vertikal) untuk jawaban panjang.

## App bar (top)
- Varian: search app bar, small, medium flexible, large flexible. Center-aligned sudah dilebur ke small. Medium dan large lama tidak disarankan.
- Small: tinggi 64px; judul memakai title large.
- Belum digulir: elevasi 0, `surface`. Sudah digulir: elevasi 2 atau `surface-container`.

## Navigation bar
- 3–5 tujuan, hanya untuk compact dan medium, di bagian bawah, selebar jendela.
- Setiap item punya ikon dan label (1–2 kata; tidak dipotong, dibungkus, atau dikecilkan).
- Item vertikal pada compact; horizontal pada medium.
- Ikon terisi untuk tujuan aktif, outline untuk yang lain. Indikator aktif hanya pada satu tujuan.
- Posisi tetap; tidak digulir.
- Kurang dari 3 tujuan: pakai tabs. Lebih dari 5: pakai rail modal di balik ikon menu.
- Tinggi 80px (lama) atau 64px (flexible).

## Navigation rail
- Collapsed (ikon di atas label, sempit) dan expanded (ikon dan label berdampingan). Expanded bisa standard atau modal.
- Navigation drawer lama kini digantikan expanded rail.
- Lebar collapsed 96px, expanded 220–360px.

## Navigation drawer (lama)
- Lebar 360px, tinggi 100%, sudut 0/16/16/0.
- Indikator aktif: tinggi 56px, radius 28px, lebar 336px; padding indikator 12px.
- Padding kiri-kanan 28px. Ikon 24px.

## Dialogs
- Basic: radius 28px; lebar 280–560px; padding 24px di semua sisi.
- Jarak ikon ke judul 16px; judul ke isi 16px; isi ke aksi 24px; antar-tombol 8px. Ikon 24px.
- Dengan ikon: rata tengah. Tanpa ikon: rata depan.
- Layar penuh: radius 0; header 56px; lebar maksimal 560px; hanya untuk compact.
- Elevasi 3 dengan scrim. Aksi memakai tombol text; aksi konfirmasi di paling akhir.
- Di web pakai elemen `<dialog>`.

## Chips
- Tinggi 32px; radius 8px; ikon 18px.
- Padding kiri-kanan 16px tanpa ikon, 8px di sisi yang berikon; jarak antar-elemen 8px.
- Input chip: avatar 24px; target ikon tutup minimal 48px.
- Jenis: assist, filter, input, suggestion.
- Sebaris chip dibaca sebagai satu kontrol.

## Lists
- Padding depan 16px; padding belakang 24px; target 48px.
- Isi rata tengah vertikal; rata atas bila item setinggi 88px atau lebih.
- Tinggi item 56 / 72 / 88px untuk satu, dua, tiga baris.
- Divider inset: 16px dari depan, 24px dari belakang.
- M3 Expressive menambah gaya segmented.

## Tabs
- Tinggi 48px (label saja) atau 64px (ikon dan label). Ikon 24px. Divider 1px.
- Indikator aktif: primary 3px dengan sudut atas 3px, lebar minimal 24px; secondary 2px.
- Tabs untuk konten yang berhubungan dalam satu halaman; navigasi untuk halaman yang berbeda.

## Menus
- Lebar 112–280px; radius 4px; item 48px; padding kiri-kanan 12px; jarak antar-elemen 12px.
- Ikon 24px. Divider 1px dengan padding atas-bawah 8px.
- Elevasi 2, `surface-container`.

## Search
- Bar: tinggi 56px; lebar 360–720px; radius penuh; avatar 30px.
- Padding depan-belakang 24px saat tidak fokus, 12px saat fokus.
- Tampilan hasil: docked (tinggi 240px sampai dua pertiga layar) atau layar penuh.

## Bottom sheets
- Lebar penuh sampai maksimal 640px; margin atas 72px (56px bila jendela lebih dari 640px).
- Drag handle di tengah dengan padding atas-bawah 22px.
- Radius atas 28px. Pada medium ke atas, ganti dengan menu atau pane melayang.

## Carousel
- Radius item 28px; padding depan-belakang 16px; atas-bawah 8px; jarak antar-item 8px.
- Item kecil 40–56px; item besar dinamis.

## Snackbar
- Container `inverse-surface`, teks `inverse-on-surface`, tombol aksi `inverse-primary`.
- Radius 4px; tinggi minimal 48px; elevasi 3.
- Pesan singkat, paling banyak satu aksi, tidak untuk informasi kritis.

## Kontrol pilihan
- **Checkbox:** kotak 18px, state layer 40px, target 48px. Untuk pilihan ganda.
- **Radio button:** ikon 20px, state layer 40px. Untuk satu pilihan dari sedikit opsi yang semuanya terlihat.
- **Switch:** track 52×32px. Untuk pengaturan yang langsung berlaku.
- Di web, bangun di atas `<input type="checkbox">` dan `<input type="radio">` asli.

## Progress indicators
- Linear dan circular; determinate atau indeterminate.
- Tebal track 4px (bawaan); M3 Expressive menambah tebal yang bisa diatur dan bentuk bergelombang.
- Indikator aktif `primary`, track `secondary-container`.

## Lainnya
- **Divider:** 1px, `outline-variant`.
- **Badge:** kecil 6px (titik), besar 16px (angka); warna `error`.
- **Tooltip plain:** `inverse-surface`, radius 4px, body small. **Rich tooltip:** `surface-container`, radius 12px, elevasi 2.
- **Toolbars, button groups, split button, FAB menu, loading indicator:** komponen baru M3 Expressive. Bangun sendiri dengan token karena belum ada implementasi web resmi.

## Ikon
- Material Symbols (variable font) dari fonts.google.com/icons: gaya outlined, rounded, sharp.
- Empat sumbu: weight, fill, optical size, grade. Samakan weight dan optical size ikon dengan teks di sampingnya.
- Ukuran bawaan 24px.
