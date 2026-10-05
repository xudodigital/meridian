# Referensi: respons SERP API

## Field respons Live Google Organic SERP Advanced

Ringkasan field respons dan jenis item; semua dari dokumentasi endpoint tersebut.

- Baca respons sebagai data JSON dengan array tasks yang memuat informasi tiap task. [E100]
- Baca tasks_error untuk jumlah task dalam array tasks yang mengembalikan error. [E101]
- Ketahui bahwa check_url berisi URL langsung ke hasil search engine, yang menurut penyedia dapat dipakai untuk memastikan hasil yang diberikan akurat. [E102]
- Baca objek spell untuk keyword hasil autokoreksi dan tipe koreksinya. [E103]
- Kenali nilai type koreksi di spell: did_you_mean, showing_results_for, no_results_found_for, atau including_results_for. [E104]
- Kenali item_types yang mungkin: answer_box, app, carousel, multi_carousel, featured_snippet, google_flights, google_reviews, third_party_reviews, images, jobs, knowledge_graph, local_pack, hotels_pack, map, organic, paid, people_also_ask, related_searches, people_also_search, shopping, top_stories, twitter, video, events, recipes, top_sights, scholarly_articles, popular_products, questions_and_answers, find_results_on, stocks_box, commercial_units, local_services, google_hotels, math_solver, currency_box, product_considerations, short_videos, refine_products, perspectives, discussions_and_forums, compare_sites, ai_overview. [E105]
- Baca pages_count untuk total halaman hasil pencarian yang diambil. [E106]
- Baca field page pada tiap elemen untuk nomor halaman SERP tempat elemen berada. [E107]
- Pakai featured_title untuk judul halaman sumber featured snippet. [E108]
- Baca asynchronous_ai_overview untuk mengetahui apakah elemen ai_overview dimuat asinkron (true) atau dari cache (false). [E109]
- Baca markdown pada ai_overview untuk isi teks ai_overview dalam format markdown. [E110]
- Baca checks pada related_result untuk properti yang terdeteksi pada elemen; bernilai null bila tidak ada yang terdeteksi. [E111]
