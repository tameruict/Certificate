-- supabase/007_writeups_indexes.sql
-- DRAFT ONLY — CHƯA APPLY LÊN SUPABASE LIVE.
-- This file is shipped in the UI-redesign branch for review only. Merging
-- this PR does NOT apply it: indexes must be applied separately, on
-- staging first, after its own review (see the draft's own header below).
-- It only adds indexes; it changes no policy, no RLS, no column, no grant.

-- =====================================================================
-- DRAFT ONLY — CHƯA APPLY LIVE. KHÔNG CHẠY LÊN DB LIVE KHI CHƯA CÓ
-- DUYỆT RIÊNG + TEST TRÊN STAGING.
--
-- Mục đích: chỉ thêm INDEX phục vụ query đã có trong code, KHÔNG đổi
-- policy, KHÔNG đổi RLS, KHÔNG đổi cột, KHÔNG đổi grant, KHÔNG đổi
-- dữ liệu. Áp dụng được hay không phải kiểm chứng bằng EXPLAIN trên
-- staging (xem REPORT.md §7) trước.
--
-- Phạm vi bảng: chỉ study_articles (Write-ups, migration 006).
-- KHÔNG đụng user_profiles / user_data_archive / study_article_progress
-- trong file này, vì:
--   - user_data_archive đã có PK (user_id, course_id) phục vụ đúng query.
--   - study_article_progress đã có PK (user_id, article_id) phục vụ đúng query.
--   - user_profiles: file 001/002/004 không có trong workspace, không
--     bịa schema để thêm index.
--
-- Thứ tự áp (nếu được duyệt): sau 006, độc lập với 005 (005 không đụng
-- study_articles). Đặt tên file chính thức khi tạo PR, VD:
--   007_writeups_indexes.sql
-- và KHÔNG renumber 001/002/004/005/006.
-- =====================================================================

BEGIN;

-- 1. Index cho query chi tiết bài viết (articles.js: fetchArticleDetail)
--    Predicate: slug = ? AND language = ? AND is_draft = false
--    Hiện có: (library, language, published_at) — không có slug, không
--    có is_draft; UNIQUE (translation_key, language) — khác cột slug,
--    planner không dùng được cho predicate trên slug.
--    Lưu ý: index THƯỜNG, không phải UNIQUE. Slug hiện bằng
--    translation_key ở script import, nhưng schema cho phép slug và
--    translation_key lệch nhau; unique (slug, language) là quyết định
--    dữ liệu riêng, cần user chốt trước khi đổi thành UNIQUE (xem
--    REPORT.md §2.4, §5). Đừng tự đổi thành UNIQUE ở đây.
CREATE INDEX IF NOT EXISTS study_articles_slug_language_idx
  ON public.study_articles (slug, language);

-- 2. Partial index cho query danh sách published (articles.js: fetchArticleList)
--    Predicate: is_draft = false (+ language, ORDER BY published_at DESC)
--    Index hiện có (library, language, published_at) không lọc is_draft,
--    nên planner vẫn phải filter is_draft sau khi quét index.
--    Partial index này chỉ chứa hàng published nên nhỏ hơn và lọc rẻ hơn.
--    Nó KHÔNG thay thế index cũ (index cũ còn phục vụ library + ngôn ngữ
--    cho các query khác nếu có); giữ cả hai, đo EXPLAIN rồi mới tính
--    chuyện drop index cũ — và drop index là PR riêng, không làm chung.
CREATE INDEX IF NOT EXISTS study_articles_published_lang_published_idx
  ON public.study_articles (language, published_at DESC)
  WHERE is_draft = false;

-- 3. (TÙY CHỌN, chỉ khi đã phân trang + lọc platform/category/difficulty
--    ở server — xem queries.md Q-C1) Index cho filter list.
--    Để COMMENTED OUT theo mặc định: khi list còn < 200 bài, thêm index
--    này chỉ tốn dung lượng + thời gian ghi mà không đo được lợi ích.
--    Khi bật, bỏ comment và test EXPLAIN với đúng tổ hợp filter sẽ dùng
--    (language + platform + category + difficulty + published_at).
-- CREATE INDEX IF NOT EXISTS study_articles_published_filters_idx
--   ON public.study_articles (language, platform, category, difficulty, published_at DESC)
--   WHERE is_draft = false;

-- 4. (TÙY CHỌN, chỉ khi làm search server — xem queries.md Q-SEARCH)
--    Cần extension unaccent + pg_trgm và cột search_text GENERATED.
--    Để COMMENTED OUT: chưa có staging để test, chưa chốt hướng
--    (cột search_text hay RPC search_writeups). KHÔNG bật mù.
-- CREATE EXTENSION IF NOT EXISTS unaccent;
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- ALTER TABLE public.study_articles
--   ADD COLUMN IF NOT EXISTS search_text text
--   GENERATED ALWAYS AS (
--     unaccent(lower(coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(platform, '') || ' ' || coalesce(category, '') || ' ' || array_to_string(coalesce(tags, '{}'), ' ')))
--   ) STORED;
-- CREATE INDEX IF NOT EXISTS study_articles_search_text_trgm_idx
--   ON public.study_articles USING gin (search_text gin_trgm_ops);

-- 5. (TÙY CHỌN, chỉ khi làm facet bằng RPC — xem queries.md Q-C5)
--    RPC phải là SECURITY INVOKER (mặc định) để RLS is_draft = false
--    vẫn áp dụng. KHÔNG viết SECURITY DEFINER ở đây.
--    SQL RPC chi tiết để riêng 1 migration sau khi chốt facet tĩnh hay
--    RPC — không bịa sẵn RETURNS khi chưa test.

COMMIT;

-- =====================================================================
-- Kiểm chứng sau khi áp TRÊN STAGING (không chạy live):
--   EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM study_articles
--     WHERE slug = '<slug-mẫu>' AND language = 'vi' AND is_draft = false;
--     → kỳ vọng: Index Scan dùng study_articles_slug_language_idx
--   EXPLAIN (ANALYZE, BUFFERS) SELECT ... FROM study_articles
--     WHERE is_draft = false AND language = 'vi'
--     ORDER BY published_at DESC LIMIT 20;
--     → kỳ vọng: dùng partial index mục 2, không Seq Scan toàn bảng
--       khi dữ liệu đủ lớn.
--   RLS hồi quy (2 tài khoản test):
--     - anon SELECT study_articles → chỉ is_draft = false
--     - authenticated INSERT study_articles → bị chặn (không policy ghi)
--     - user A SELECT/UPDATE study_article_progress của B → bị chặn
-- Rollback (chỉ drop index, không mất dữ liệu):
--   DROP INDEX IF EXISTS public.study_articles_slug_language_idx;
--   DROP INDEX IF EXISTS public.study_articles_published_lang_published_idx;
-- =====================================================================
