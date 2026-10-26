# 한끼노트 — 아이디 회원 인증 + Neon

## 로컬 실행

Node.js 24와 Express, pg, dotenv를 사용합니다. 이 PC에는 .runtime/node-v24.22.1-win-x64/에 프로젝트 전용 Node.js가 있습니다.

1. .env에 DATABASE_URL을 설정합니다(.env.example 참고). APP_PASSWORD는 더 이상 사용하지 않습니다.
2. start.cmd를 실행하거나 일반 Node.js 환경에서 npm install 후 npm start를 실행합니다.
3. http://localhost:3000 에 접속합니다. 누구나 레시피를 둘러볼 수 있습니다.
4. 상단 로그인 → 회원가입으로 전환 → 아이디, 닉네임, 비밀번호로 가입합니다.

아이디는 영문·숫자·밑줄 3~30자입니다. 공백을 제거하고 소문자로 정규화하며 Neon의 고유 제약으로 중복 가입을 막습니다. 비밀번호는 8~128자이며 서버에서 임의 salt와 scrypt로 해시합니다.

## 권한과 데이터

레시피 열람은 공개입니다. 레시피·평가·댓글·북마크 등록과 수정·삭제, 백업 가져오기는 로그인한 사용자만 가능합니다. 작성자는 요청 본문의 이름이나 ID가 아닌 서버 세션으로 결정합니다. 레시피는 본인만 수정·삭제하고 평가·댓글은 본인의 기록만 변경할 수 있습니다.

모든 앱 데이터와 회원 로그인 세션은 Neon PostgreSQL에 저장합니다. localStorage나 SQLite는 앱 저장소로 사용하지 않습니다. 회원 세션 쿠키는 HttpOnly·SameSite로 처리하며 Vercel에서는 Secure를 설정합니다. 로그아웃은 서버에서 세션을 삭제합니다.

회원과 기존 글은 삭제하지 않습니다. username이 로그인 아이디입니다. 이전 이메일 방식에서 생성된 계정은 내부 username이 부여되어 있으므로 사람이 사용할 아이디로 별도 연결해야 합니다. email 컬럼은 기존 데이터 보존을 위해 남기지만 신규 가입과 로그인에서는 사용하지 않습니다.

## Vercel

- Framework Preset: Other, Node.js: 24
- Output Directory는 별도 지정하지 않고 저장소의 vercel.json을 사용합니다.
- 환경변수 DATABASE_URL을 Production/Preview에 설정한 뒤 재배포합니다. APP_PASSWORD는 제거해도 됩니다.
- api/index.js가 Express를 실행하며 Neon pooled 연결을 권장합니다. TLS 인증서 검증을 적용합니다.
- .env, data/, .runtime/ 및 node_modules/는 Git 및 배포에서 제외됩니다. 접속 정보와 비밀번호 해시는 브라우저에 제공하지 않습니다.

서버 시작 및 Vercel 함수 초기 요청 시 database/neon-schema.sql로 테이블과 인덱스를 준비합니다. 기존 데이터는 삭제하지 않으며 기본 레시피는 중복 없이 추가합니다.

## 기존 데이터와 테스트

SQLite 원본은 data/hankki.sqlite에 보존했습니다. 승인된 이전 및 검증을 마쳤으며 기본 레시피 6개는 이미 Neon에 있어 추가 삽입은 0건이었습니다. 이전 도구는 scripts/migrate-sqlite.cjs입니다.

localStorage 백업은 기존 Live Server의 같은 주소에서 legacy-export.html로 내보내고 로그인 후 ‘백업 가져오기’로 옮깁니다. 요청 크기는 3MB 이하입니다.

    .\.runtime\node-v24.22.1-win-x64\node.exe --test test/server.test.cjs

실제 Neon의 임시 스키마에서 아이디 가입·로그인, 아이디 중복 방지, 익명 쓰기 차단, 작성자 권한, 별점/댓글 독립 저장, 북마크 집계, 검색어, 서버 재시작 후 지속성을 검증합니다. 테스트 스키마는 종료 시 삭제합니다.
