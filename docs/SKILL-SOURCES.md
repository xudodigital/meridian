# Sumber skill Meridian

Paket `skills/` memuat 14 skill. Dua belas `evidence.json` historis dipulihkan dari salinan skill lokal; seluruh `[E#]` dalam SKILL.md dan referensi Markdown kini memiliki record bukti. Pemeriksa `scripts/check-skills.mjs` hanya menguji hubungan ID, bukan keakuratan kutipan atau perubahan dokumen daring. Arsip halaman `_sources` tidak tersedia; jangan mengklaim seluruh sumber telah diarsipkan atau divalidasi ulang.

`agent-orchestration` ditulis ulang sebagai kontrak runtime Meridian: OpenAI Responses, satu job pada satu waktu, pembatasan anggaran, skill yang ditugaskan dan review manusia. Referensi runtime Claude/Gemini yang tidak berlaku dihapus. Material 3 memakai token/referensi desain dan generator tema yang sudah diuji, tanpa format ID bukti Google.

Tambahan pedoman mencakup strategi editorial, pemetaan klaim ke bukti, keterbatasan pemeriksaan otomatis, peninjauan ahli untuk topik sensitif, refresh nyata serta Digital PR editorial tanpa link schemes atau outreach otomatis. Catatan pengukuran AI Search membedakan laporan UI Google dari kemampuan API yang tersedia di Meridian.

Dokumentasi resmi yang diperiksa untuk perubahan ini:

- [DataForSEO organic Live Advanced](https://docs.dataforseo.com/v3/serp/google/organic/live/advanced/): permintaan SERP negara/bahasa eksplisit.
- [Google title links](https://developers.google.com/search/docs/appearance/title-link) dan [snippets](https://developers.google.com/search/docs/appearance/snippet): tidak menetapkan batas karakter tetap.
- [Google helpful content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content): kualitas dan manfaat konten, bukan target panjang minimum.
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies): kebijakan link spam.
- [Google AI features](https://developers.google.com/search/docs/appearance/ai-features) dan [AI optimization guide](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide): jangan menyimpulkan endpoint analitik API dari tampilan laporan di UI.

Pengujian job menggunakan layanan tiruan terisolasi. Hasil model, URL sumber dan usulan tindakan tetap harus diperiksa manusia; resolusi ID dan output JSON valid tidak membuktikan akurasi SEO.
