# 체험학습 운영실

2026년 11월 30일~12월 29일 체험학습 기간의 교사 임장과 출석을 함께 관리하는 한국어 웹앱입니다.

- 기간1반·2반 교사별 임장표 조회, 담당 변경, 일정 맞교환
- 관리반·날짜·교시별 실제 출석 입력·수정, 메모와 변경 이력
- 원래 소속 반별 출석부 조회
- 이메일 등록 없이 공용 비밀번호 하나로 접속

## 접속

일반 이용자는 전달받은 공용 비밀번호만 입력합니다. Firebase Authentication이 서버에서 비밀번호를 확인하고, 전용 공용 계정으로 인증된 접속에만 자료 접근을 허용합니다. 다른 이메일·비밀번호 계정을 임의로 만들거나 익명 로그인해도 자료를 읽을 수 없습니다. 관리자 유지보수는 고정된 Google 관리자 계정으로 구분합니다.

비밀번호는 공개 소스·공개 설정·웹페이지 파일에 넣지 않습니다. 별도로 전달받은 접속 안내 파일에서 확인하며, 해당 파일을 공개 저장소에 올리면 안 됩니다. 공개 설정에는 인증 계정의 공개 식별자와 내부 로그인용 이메일만 있습니다. 이용자가 이메일을 입력하거나 개인 회원가입할 필요는 없습니다.

공용 접속은 개인별 신원을 구분하지 않습니다. 변경 이력에는 개인 이름 대신 ‘공용 접속’으로 표시합니다. 비밀번호를 전달받은 모든 이용자가 같은 학생 명단과 출석 기록을 조회·수정하는 운영 방식을 전제로 합니다.

## 운영 기준

11월 30일·12월 1일은 두 관리반을 운영하고 이후에는 기간1반으로 통합합니다. 월·수·목은 6교시, 화·금은 7교시입니다. 14:00은 5교시 시작이며 반일 학생은 1~4교시 출석 예정, 이후 체험학습 예정입니다. 입력 화면은 등교 예정 학생을 출석, 반일 조퇴 이후 교시를 체험학습으로 기본 선택합니다. 교사는 결석 등 예외만 바꾼 뒤 선택한 날짜·반·교시의 기록을 저장합니다. 저장한 상태와 메모는 기본값보다 우선하며, 원반별 출석부에는 확정해 저장한 기록이 표시됩니다. 주말, 12월 11일과 12월 25일은 제외합니다. 교사의 1·2학년 수업과 동시 임장은 배정할 수 없고, 지정된 임장 횟수 범위도 검사합니다.

실제 학생·교사 이름, 학생별 일정, 실제 기록과 초기 자료 파일은 이 저장소에 없습니다. 최초 관리자만 별도 초기 자료를 해시 검증 후 등록할 수 있으며, 기준 자료는 앱에서 덮어쓰거나 삭제할 수 없습니다.

## 공동 저장과 권한

Firestore Enterprise Native의 전용 school-hub 데이터베이스, 서울(asia-northeast3), 무료 Spark 계획을 사용합니다. 실시간 공동 편집 때문에 Core SDK의 onSnapshot과 트랜잭션을 사용합니다. 현재 버전과 변경 이력을 함께 저장하여 동시 변경으로 기존 내용을 덮어쓰지 않게 합니다.

school/config는 최초 기준 자료, school/schedule은 임장 배정, school/live는 버전, attendance는 교시별 출석, history는 변경 이력입니다. 지우기는 삭제 대신 되돌릴 수 있는 미기록 상태로 저장합니다. 인증된 작성자·자료형·허용 필드·해당 학생·날짜·교시·교사 수업·배정 횟수·현재 버전을 서버에서 검사합니다.

security/shared에는 enabled, validAfter, updatedAt, updatedBy만 있습니다. Google 관리자만 접속을 일괄 중지하거나 auth_time 기준으로 이전 세션을 차단할 수 있습니다. 이 문서에 비밀번호나 비밀번호 해시는 없습니다. 예전 access 이메일 목록은 더 이상 자료 접근 권한을 부여하지 않으며, 앱에서 교사 이메일을 등록하지 않습니다.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for this shared-password workspace because Firebase verifies the password, data access is pinned to one dedicated authenticated UID, privileged configuration requires the Google owner, and data edits retain validation and revision checks. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

## 개발과 검증

Node.js 24와 Java 21에서 다음 명령을 실행합니다.

~~~sh
npm ci
npm test
npx --yes firebase-tools@15.36.0 emulators:exec --project demo-school-hub --only firestore --config firebase.emulator.json "node scripts/test-shared.mjs"
npm run build
npm run dev
~~~

통합 검증은 매번 새로운 demo-school-hub-* 에뮬레이터 프로젝트와 가상의 인물만 사용합니다. 실제 운영 자료나 운영 비밀번호는 사용하지 않습니다. 올바른 전용 인증 계정과 잘못된 인증 계정, 28명 일괄 출석, 같은 공용 계정의 두 브라우저 동시 저장, 임장 변경·맞교환, 기록 위조 차단, 접속 중지와 이전 세션 차단을 검사합니다.

관리자와 공용 계정 UID를 변경하면 공개 연결 설정을 수정한 뒤 node scripts/generate-rules.mjs로 규칙을 다시 생성합니다. 규칙 배포에는 별도로 인증한 프로젝트 관리자가 필요하며 GitHub Actions에 관리자 자격 증명이나 운영 비밀번호를 넣지 않습니다. 비밀번호 교체는 Firebase 관리자 권한으로 수행하고 security/shared의 validAfter를 갱신하여 이전 세션도 차단해야 합니다.

## 발행

GitHub Actions가 검증·빌드를 마친 뒤 PAGES_PUBLISH_APPROVED 저장소 변수가 true일 때 Pages에 발행합니다. 발행 주소는 https://mindy5410-glitch.github.io/school-study-hub-2026/ 입니다. 공개되는 제작 코드와 접근이 제한된 학생 운영 자료를 분리합니다. [GitHub Pages 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
