# 체험학습 운영실

2026년 11월 30일~12월 29일 체험학습 기간의 교사 임장과 출석을 함께 관리하는 한국어 웹앱입니다.

- 기간1반·2반의 교사별 임장표 조회, 담당 변경, 일정 맞교환
- 관리반·날짜·교시별 실제 출석 입력과 수정, 메모, 저장 취소와 변경 이력
- 원래 소속 반별 전체 출석부 조회와 CSV 내려받기
- Google 로그인과 관리자에 의한 교사 계정 등록·사용 중지

## 운영 기준

11월 30일·12월 1일은 두 관리반을 운영하며, 이후에는 기간1반으로 통합합니다. 월·수·목은 6교시, 화·금은 7교시입니다. 14:00은 5교시 시작이며 반일 등교 학생은 1~4교시에 출석 예정, 이후에는 체험학습 예정으로 표시됩니다. 실제 출석은 교사가 저장하기 전까지 미기록입니다. 주말, 12월 11일과 12월 25일은 운영 날짜에서 제외합니다.

교사의 1·2학년 수업과 동시 임장은 배정할 수 없으며, 특별히 지정된 임장 횟수 범위를 함께 검사합니다. 학생 명단, 교사별 세부 배정, 정규 수업 정보는 로그인 후 공동 저장소에서 가져옵니다.

## 운영 자료와 공개 소스

이 저장소에는 실제 학생 명단·출석 기록·교사 이메일 목록·초기 자료 파일이 없습니다. 운영 자료는 Firebase의 전용 `school-hub` 데이터베이스에 저장하며, 등록된 교사만 읽고 수정할 수 있습니다. `public/project-config.json`은 Firebase 웹앱의 공개 연결 설정과 고정 관리자 식별자입니다. 비밀 관리자 키나 계정 비밀번호는 포함하지 않습니다.

관리자는 처음 한 번 별도로 전달받은 초기 자료 파일을 선택합니다. 파일의 고정 해시를 확인한 후 관리자만 초기 자료를 원자적으로 등록할 수 있고, 등록된 기준 자료는 앱에서 덮어쓰거나 삭제할 수 없습니다. 기준 자료 내용과 최초 관리자는 신뢰 경계입니다. 학생 명단이 바뀌는 경우 관리자 검토를 거친 별도 자료 이관이 필요합니다.

## 공동 저장 구조

Firebase Authentication의 이메일이 확인된 Google 계정만 허용합니다. 관리자는 서버 규칙에 고정한 UID로 식별합니다. 교사의 사용 권한은 관리자만 변경하며, 모든 등록 교사가 같은 시간표와 출석 기록을 관리합니다. 회원가입 순서로 관리자 권한을 주지 않습니다.

Firestore Enterprise Native, 서울(`asia-northeast3`), 무료 Spark 계획을 사용합니다. 실시간 공동 편집이 필요하므로 Core SDK의 `onSnapshot`과 트랜잭션을 사용합니다. 버전 번호와 변경 이력을 함께 저장하며, 동시에 수정하면 한 건만 저장하고 나머지는 최신 자료를 확인하도록 안내합니다. 실제 데이터로 만든 시험 기록은 저장하지 않습니다.

`school/config`는 최초 기준 자료와 검증용 조회표, `school/schedule`은 배정과 횟수, `school/live`는 버전입니다. 교시별 출석은 `attendance`, 변경 이력은 `history`, 등록 교사 권한은 `access`에 저장합니다. 출석 지우기는 삭제 대신 되돌릴 수 있는 미기록 상태로 저장합니다. 서버 규칙은 자료형·허용 필드·날짜·교시·해당 학생·담당 교사·임장 횟수·현재 버전·인증된 작성자를 검사합니다.

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for a dedicated school workspace because access requires a verified Google account and an explicit teacher grant, administration is pinned to one UID, and all edits are validated and revision-linked. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.

## 개발과 검증

Node.js 24와 Java 21을 사용합니다.

```sh
npm ci
npm test
npx --yes firebase-tools@15.36.0 emulators:exec --project demo-school-hub --only firestore --config firebase.emulator.json "node scripts/test-shared.mjs"
npm run build
npm run dev
```

통합 검증은 매번 새로운 `demo-school-hub-*` 에뮬레이터 프로젝트와 가상의 인물만 사용합니다. 실제 학생 자료나 운영 계정 인증 정보가 필요하지 않습니다. 두 실제 SDK 클라이언트의 실시간 전파, 동시 저장 충돌, 28명 일괄 출석, 일정 변경·맞교환, 접근 차단, 권한 중지, 위조 필드와 임장 제한을 검사합니다.

관리자 UID를 바꾸는 경우 `public/project-config.json`을 수정하고 `node scripts/generate-rules.mjs`로 규칙을 다시 생성해야 합니다. 빈 UID는 모든 접근을 차단하는 규칙을 생성합니다. 규칙·색인 배포에는 별도로 인증한 프로젝트 관리자가 필요합니다. GitHub Actions에는 Firebase 관리자 자격 증명을 넣지 않습니다.

## GitHub Pages 발행

워크플로는 소스 검증·에뮬레이터 시험·빌드를 실행합니다. 발행은 `PAGES_PUBLISH_APPROVED` 저장소 변수가 `true`일 때만 실행하며, 초기에는 비활성화합니다. 게시 승인 후 Pages의 원본을 GitHub Actions로 설정하고 Firebase Authentication의 승인 도메인에 실제 Pages 호스트를 등록합니다. 요금제나 저장소 공개 범위는 자동 변경하지 않습니다.

GitHub Free의 Pages는 공개 저장소를 사용하므로 소스 공개 승인이 필요합니다. 학생 명단과 운영 기록은 이와 별도로 접근 제한된 Firebase에 보관합니다. [GitHub Pages 공식 안내](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
