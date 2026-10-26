-- 한끼노트: Neon PostgreSQL 테이블 생성
-- Neon SQL Editor에서 전체 실행합니다. 새 데이터베이스 기준입니다.
-- 기존 테이블/데이터를 삭제하지 않으며 IF NOT EXISTS는 기존 구조를 변경하지 않습니다.
-- 이 파일은 테이블만 생성합니다. SQLite 자료 이전과 서버 코드 전환은 별도입니다.
-- 현재 코드와 맞춰 ID는 TEXT(예제 r1 및 UUID 모두 지원), 시간은 epoch 밀리초를 사용합니다.

BEGIN;

-- 1. 회원: 비밀번호 원문 대신 서버에서 생성한 scrypt salt/hash 저장
CREATE TABLE IF NOT EXISTS public.users (
    id       TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE
             CHECK (username ~ '^[a-z0-9_]{3,30}$'),
    nickname TEXT NOT NULL CHECK (char_length(btrim(nickname)) BETWEEN 1 AND 30),
    salt     TEXT NOT NULL,
    hash     TEXT NOT NULL
);

-- 이메일 인증으로 전환합니다. 기존 아이디 회원의 원본은 보존하므로 NULL을 허용합니다.
-- 신규 회원은 서버에서 이메일을 필수로 검증하고 username은 내부 호환 ID로만 채웁니다.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email TEXT
    CHECK (char_length(email) <= 254 AND email = lower(btrim(email))
           AND email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
    ON public.users(lower(email)) WHERE email IS NOT NULL;

-- 2. 로그인 세션: token에는 쿠키 원문이 아닌 SHA-256 해시 저장
CREATE TABLE IF NOT EXISTS public.sessions (
    token   TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    expires BIGINT NOT NULL CHECK (expires > 0)
);

-- 3. 레시피: owner_id NULL은 앱의 기본 예제 레시피용
-- body JSONB 필드:
-- title, description, category, time, servings, level, type,
-- creator, source, image, ingredients(문자열 배열), steps(문자열 배열)
-- image에는 현재 앱에서 압축한 사진 data URL 또는 기존 이미지 URL을 저장합니다.
CREATE TABLE IF NOT EXISTS public.recipes (
    id       TEXT PRIMARY KEY,
    owner_id TEXT REFERENCES public.users(id) ON DELETE RESTRICT,
    body     JSONB NOT NULL CHECK (jsonb_typeof(body) = 'object'),
    created  BIGINT NOT NULL DEFAULT
             ((extract(epoch FROM clock_timestamp()) * 1000)::BIGINT)
);

-- 4. 별점: 계정당 레시피별 하나만 등록, 1~5점
CREATE TABLE IF NOT EXISTS public.ratings (
    recipe_id TEXT NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    value     SMALLINT NOT NULL CHECK (value BETWEEN 1 AND 5),
    PRIMARY KEY (recipe_id, user_id)
);

-- 5. 댓글: 별점과 독립적으로 등록/수정/삭제, 계정당 레시피별 하나
-- updated는 현재 앱과 호환되는 ISO 8601 문자열
CREATE TABLE IF NOT EXISTS public.comments (
    recipe_id TEXT NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    body      TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
    updated   TEXT NOT NULL,
    PRIMARY KEY (recipe_id, user_id)
);

-- 6. 북마크: 계정별 중복 저장 방지
CREATE TABLE IF NOT EXISTS public.bookmarks (
    recipe_id TEXT NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    user_id   TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    PRIMARY KEY (recipe_id, user_id)
);

-- 7. 기존 브라우저 백업 가져오기: 동일 계정에서 같은 레시피의 중복 이전 방지
CREATE TABLE IF NOT EXISTS public.imports (
    user_id   TEXT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    legacy_id TEXT NOT NULL,
    recipe_id TEXT NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, legacy_id)
);

-- 8. 인기 검색어: 정규화된 검색어별 누적 횟수
-- 앱에서 NFKC, 소문자 변환 및 공백 정규화 후 저장합니다.
CREATE TABLE IF NOT EXISTS public.search_counts (
    term          TEXT PRIMARY KEY CHECK (char_length(btrim(term)) BETWEEN 1 AND 60),
    count         BIGINT NOT NULL DEFAULT 1 CHECK (count > 0),
    last_searched BIGINT NOT NULL DEFAULT
                  ((extract(epoch FROM clock_timestamp()) * 1000)::BIGINT)
);

-- 기본키/UNIQUE의 인덱스 외에 조회 및 외래키 삭제 검사에 필요한 인덱스
CREATE INDEX IF NOT EXISTS sessions_user_idx ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON public.sessions(expires);
CREATE INDEX IF NOT EXISTS recipes_owner_created_idx ON public.recipes(owner_id, created DESC);
CREATE INDEX IF NOT EXISTS recipes_created_idx ON public.recipes(created DESC, id);
CREATE INDEX IF NOT EXISTS ratings_user_idx ON public.ratings(user_id);
CREATE INDEX IF NOT EXISTS comments_user_idx ON public.comments(user_id);
CREATE INDEX IF NOT EXISTS bookmarks_user_idx ON public.bookmarks(user_id);
CREATE INDEX IF NOT EXISTS imports_recipe_idx ON public.imports(recipe_id);
CREATE INDEX IF NOT EXISTS search_counts_popular_idx
    ON public.search_counts(count DESC, last_searched DESC, term ASC);

COMMIT;

-- 실행 후 생성된 테이블 확인
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('users', 'sessions', 'recipes', 'ratings', 'comments',
                     'bookmarks', 'imports', 'search_counts')
ORDER BY table_name;
