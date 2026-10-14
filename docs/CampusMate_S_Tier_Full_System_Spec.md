# CampusMate — Full-System Engineering Blueprint & Claude Implementation Brief

> **เอกสารส่งต่อสำหรับ Claude Opus 5.5** | Version 2.0 | 12 ตุลาคม 2026 | Language: Thai (technical identifiers in English)
>
> **สถานะ:** ข้อกำหนดสำหรับการพัฒนา (implementation blueprint) ไม่ใช่คำรับรองว่าระบบปัจจุบันทำงานครบแล้ว
>
> **เป้าหมาย:** แอป Social / หาเพื่อน / Matching / แชตแบบเรียลไทม์บน iOS และ Android โดยคง **React Native** และ **Cloudflare R2** ของโครงการเดิม พร้อมสร้าง **Rust Backend** บน **Fly.io (Singapore)** และ **Neon PostgreSQL** ให้มีแนวทางขยายสู่ระบบระดับ Production ที่มีความเร็ว ความปลอดภัย และความเชื่อถือได้สูง

---

## 0. MASTER INSTRUCTION — คัดลอกส่วนนี้ให้ Claude ก่อนเริ่มลงมือ

คุณคือ **Principal Software Architect + Senior Rust/React Native Engineer + Security Engineer + SRE** ที่ต้องพัฒนาระบบจริงใน Repository ของผู้ใช้ตามเอกสารนี้ โดยดำเนินงานแบบ **incremental, test-driven where practical, security-first** และ **preserve existing code**.

### กติกาบังคับสำหรับ Claude

1. **ตรวจสอบ Repository จริงก่อนเสมอ** (`tree`, `package.json`, Expo/Bare React Native, โครงสร้าง Navigation, existing auth, existing R2 integration, CI, environment templates, database/schema, test infrastructure) แล้วเขียน `docs/AS_IS_AUDIT.md` ระบุสิ่งที่มีอยู่จริง สิ่งที่ขาด และสิ่งที่ขัดกับ Spec นี้
2. **ห้ามรื้อ React Native หรือ Cloudflare R2 ที่ใช้อยู่** โดยไม่มีเหตุผลทางเทคนิคและการยืนยันจากผู้ใช้; ใช้ TypeScript และนำบริการเดิมกลับมาใช้ (reuse) เมื่อเหมาะสม
3. ตัดสินใจบนหลักการ **single source of truth**: **PostgreSQL** เป็นฐานข้อมูลธุรกรรมหลัก; **R2** เก็บไฟล์; **Redis** (ถ้ามี) เป็น ephemeral infrastructure ไม่ใช่ฐานข้อมูลหลัก
4. Backend หลักเป็น **Rust + Axum + Tokio + SQLx**; Deploy ด้วย Docker ไป **Fly.io (`sin`)**; database เป็น **Neon PostgreSQL Region Singapore** หากบัญชี/แผนรองรับ
5. ระบบ Authentication ให้ **ตรวจสอบผู้ให้บริการที่โครงการใช้จริงก่อน**; ค่าเริ่มต้นที่เสนอคือ **Firebase Authentication** และ **FCM**. **ห้ามเพิ่ม Firebase โดยอัตโนมัติถ้ามี auth provider อยู่แล้วโดยไม่มีแผน migration**
6. **ห้ามฝังคีย์ลับ** (R2 Access/Secret Keys, DATABASE_URL, FCM service account, Firebase private credentials) ใน React Native, Git, Logs หรือ API responses
7. เริ่มด้วย **modular monolith + Rust WebSocket + PostgreSQL outbox**; ยัง **ไม่ต้องเพิ่ม Redis, Microservices, Kafka, Kubernetes หรือ ML inference** จนกว่าจะมีเหตุผลจาก Load Test/Requirements
8. ทุก endpoint ที่แตะข้อมูลผู้ใช้ต้องมี **authentication + object-level authorization**. อย่าเชื่อ `user_id`, `sender_id`, `role` ที่ client ส่งมาโดยตรง
9. คำว่า **S-Tier** ในเอกสารหมายถึง **เป้าหมายทางวิศวกรรม**; อย่าอ้างว่า achieved จนกว่าจะผ่าน SLO/Load/Security/Recovery tests ตามเกณฑ์ในเอกสาร
10. เลือก dependency versions จาก lockfile/release ที่ compatible และตรวจ official docs ณ เวลาลงมือ; **ห้ามเดาว่าฟีเจอร์/แพ็กเกจ/เวอร์ชันใดใช้งานได้**
11. ห้ามสร้างบัญชี cloud, ซื้อบริการ, Deploy Production, เปิด Public Bucket, ลบข้อมูล หรือเปลี่ยน auth provider จริงโดยไม่ขออนุมัติจากเจ้าของระบบ
12. **ระบบ Amazon Rekognition Face Liveness + CompareFaces มีใช้อยู่แล้ว**: ตรวจ implementation จริงก่อนเปลี่ยน, ห้ามพัฒนา selfie-liveness เอง, การตัดสิน `PHOTO_VERIFIED` ต้องมาจาก Rust server ตามบท 23 เท่านั้น และต้องไม่แทนที่ login/auth หรือแอบอ้างว่าเป็น KYC/ยืนยันบัตรประชาชน
13. ทำทีละ phase; หลัง phase ให้รายงาน **files changed, commands executed, tests, unresolved risks, manual steps**. หากมีสิ่งจำเป็นต้องตัดสินใจ ให้ทำ Default ที่ปลอดภัยและบันทึกเป็น ADR/TODO โดยไม่เดาข้อมูลธุรกิจสำคัญ
14. สร้างโค้ดที่ build/run/test ได้จริง; ไม่ปล่อย `TODO` ที่เป็น Security Critical และไม่อ้างว่า Integration สำเร็จหากยังไม่ได้ทดสอบด้วย credentials/environment จริง
15. หาก repo ยังไม่มี Backend ให้เริ่ม scaffold ใหม่ภายใต้ `backend/` แต่หากมีโครงสร้างเดิมแล้วให้ปรับเข้ากับโครงสร้างเดิมอย่างระมัดระวัง
16. **ก่อนเขียนหรือแก้ไขโค้ดจำนวนมาก:** อ่านเอกสารนี้ครบ, ตรวจสถานะ Git, ทำ implementation plan เป็น PR-sized tasks, แล้วเริ่มงานทันทีจาก milestone แรกที่ไม่ต้องใช้ secrets

### รูปแบบรายงานทุกครั้งที่ส่งงาน

```text
Phase:
Objectives completed:
Files created/modified:
Architecture decisions:
Commands executed:
Tests (PASS/FAIL/NOT RUN + reasons):
Security/privacy checks:
Manual configuration required:
Open issues/risks:
Next implementation steps:
```

---

## 1. Product Scope & Assumptions

### 1.1 ข้อเท็จจริงที่ยืนยันจากผู้ใช้

- Frontend เป็น **React Native**, รองรับ **iOS + Android**
- ปัจจุบันใช้ **Cloudflare R2 เก็บรูปภาพ** แล้ว — ต้องรักษา integration เดิม
- ปัจจุบันใช้ **Amazon Rekognition Face Liveness + CompareFaces** สำหรับการยืนยันรูปใบหน้า — ต้องตรวจโค้ดเดิมและยกระดับความปลอดภัยตามบท 23 ก่อนเปลี่ยนระบบ
- ต้องการแอปประเภท **Social / หาเพื่อน / Matching / Chat**
- ได้เลือกแนวทาง Backend **Rust + Axum + Tokio + SQLx**, Hosting **Fly.io Singapore**, Database **Neon PostgreSQL**
- ต้องการ Architecture ที่ออกแบบเผื่อ **S-Tier Performance/Reliability** แต่ไม่จำเป็นต้องจ่ายค่าระบบระดับใหญ่ตั้งแต่ MVP

### 1.2 สมมติฐานสำหรับ MVP (ต้อง Validate กับเจ้าของระบบ)

- แอปชื่อชั่วคราว **CampusMate**; สามารถเปลี่ยนชื่อได้โดยไม่กระทบ public API
- ระบบหาเพื่อนแบบ **mutual Like → Match → DM Chat**; ไม่มีการส่งข้อความให้คนที่ยังไม่ Match
- เริ่มด้วย **1:1 Chat**; Group Chat, Voice/Video Call, E2EE, Paid Subscription, AI recommendations, Social Feed, Live Location ไม่รวม MVP
- โปรไฟล์ประกอบด้วยชื่อแสดง รูปภาพ Bio ความสนใจ และข้อมูลสถาบัน (ถ้าผู้ใช้สมัครใจ)
- ไม่มี requirement ให้เปิดเผยตำแหน่ง GPS ที่แม่นยำ; **ห้ามเพิ่มการติดตามตำแหน่ง** โดยไม่มีความยินยอมและการทบทวนความเสี่ยง
- อายุขั้นต่ำ นโยบายการยืนยันตัวตน และหลักเกณฑ์การค้นหาเป็น **product/legal decisions ที่ยังไม่ยืนยัน**; ห้ามสมมติว่าเป็น Dating App สำหรับผู้ใหญ่หรือว่าเด็กเข้าใช้ได้โดยอัตโนมัติ
- มีฟังก์ชัน Block, Report, Unmatch, Account Deletion, Notification Preferences และ Privacy Controls ตั้งแต่ก่อน Production

### 1.3 Non-goals สำหรับ MVP

- ไม่ทำ microservice แยกทุกโมดูล
- ไม่ทำ AI vector similarity หรือ recommendation ML ก่อนมีข้อมูลและ baseline
- ไม่ทำระบบชำระเงิน
- ไม่ใช้ Redis เป็น durable message store
- ไม่คัดลอก Profile/Message ทั้งชุดไปยัง Firestore เพื่อทำให้ซิงค์ซ้ำกับ PostgreSQL
- ไม่ทำ Admin Dashboard แบบเต็มจนกว่าระบบรายงาน/Moderation Backend จะพร้อม; สามารถเริ่มด้วย internal moderation tooling ที่ควบคุมสิทธิ์อย่างปลอดภัย

---

## 2. Architecture Decisions (ADRs)

| ID | Decision | Rationale | สถานะ |
|---|---|---|---|
| ADR-001 | React Native + TypeScript | คงโค้ดมือถือเดิม iOS/Android | Confirmed |
| ADR-002 | Rust Axum + Tokio + SQLx | Native server + Async I/O + PostgreSQL | Target |
| ADR-003 | Fly.io Machines Singapore (`sin`) | เหมาะกับ Rust Native/WebSocket ต่อเนื่อง | Target |
| ADR-004 | Neon PostgreSQL Singapore | Relational data + transactions + indexes | Target |
| ADR-005 | Cloudflare R2 | มีใช้อยู่แล้ว, เก็บ media แยก DB | Confirmed |
| ADR-006 | Firebase Auth + FCM **หรือ** provider เดิม | Auth/Push managed; ตรวจของเดิมก่อนเลือก | Conditional |
| ADR-007 | REST API + WebSocket | REST สำหรับ CRUD/history, WS สำหรับ realtime | Target |
| ADR-008 | Modular Monolith | Low operational overhead, upgradeable modules | Target |
| ADR-009 | PostgreSQL Transactional Outbox | Chat event durability + recoverable side effects | Target |
| ADR-010 | Redis Optional at multi-instance | Presence/PubSub/cache, ไม่ใช่ source of truth | Deferred |
| ADR-011 | PostgreSQL as transaction source of truth | ป้องกัน dual-write inconsistencies | Target |
| ADR-012 | Signed direct upload to R2 | ไม่ให้ไฟล์วิ่งผ่าน Rust API | Target |
| ADR-013 | Rekognition Face Liveness + CompareFaces | Preserve existing face-verification provider; Rust decides photo badge server-side | Confirmed provider, verify code |
| ADR-014 | Separate verification meanings | PHOTO_VERIFIED does not mean legal identity/student status; never grants auth privileges | Target |

### 2.1 Deployment topology (conceptual)

```mermaid
flowchart TD
    APP[React Native iOS / Android] -->|HTTPS REST + WSS| FLY[Fly.io Singapore Rust/Axum]
    APP -->|Login via provider SDK| AUTH[Firebase Auth or Existing IdP]
    FLY -->|Verify JWT| AUTH
    FLY <-->|TLS SQLx| PG[(Neon PostgreSQL SG)]
    FLY -->|Presign PUT/GET + HEAD| R2[Cloudflare R2]
    APP -->|Presigned PUT direct| R2
    FLY -->|Outbox jobs| WORKER[Rust Background Worker]
    WORKER -->|Push| FCM[FCM / APNs bridge]
    FLY <-->|Optional pubsub/presence| REDIS[(Redis when scaled)]
    R2 -->|Controlled public CDN for public assets only| CDN[Cloudflare CDN]
```

> รูปนี้ไม่บังคับให้ `APP -> FLY -> AUTH` เป็น request ต่อ request ทุกครั้ง: Rust ควร verify JWT แบบ local verification ด้วย public keys ตามกฎ Issuer/Audience/Algorithm/Expiration พร้อม caching และจัดการ key rotation. ฟีเจอร์ที่ต้องตรวจ revocation เพิ่ม อาจมีการเรียก provider เฉพาะกรณี

### 2.2 Single-instance vs multi-instance

**MVP:** Fly.io Machine เดียว (ตัวอย่าง 1 shared CPU / 1 GB RAM เป็น starting point **ไม่ใช่ capacity guarantee**); Rust process เดียวจัด REST, WS, outbox poller ขนาดเล็กได้ แต่ต้องทำ graceful shutdown และ durable synchronization.

**Production HA:** 2+ Fly Machines, Health Checks, multi-instance notification routing via Redis Pub/Sub (หรือ alternative ที่ผ่าน load test), แยก Worker process group ตามภาระ, Neon compute/connection sizing และ backup/recovery tested.

**ไม่ใช่ HA เต็มรูปแบบ** หาก Fly Machines, DB และ Redis ทั้งหมดพึ่ง Region เดียว. Multi-region DB/failover ต้องเป็นแผนอีกระยะหนึ่ง.

---

## 3. Domain Modules & Ownership

1. `auth`: verify provider identity token, map uid -> internal users, authorization claims/policies
2. `users`: account lifecycle, settings, block status, deletion
3. `profiles`: profile metadata, interests, privacy fields, picture ownership
4. `discovery`: candidate filtering, cursor pagination, visibility and block checks
5. `matching`: like/pass, mutual match atomicity, unmatch, canonical pair ordering
6. `chat`: conversations, history, send, read receipts, server ordering and idempotency
7. `realtime`: WS auth, connection manager, fanout, reconnect/sync
8. `media`: upload intent, presigned URL, verify/process media, signed read access
9. `notifications`: FCM tokens, preferences, outbox and retry worker
10. `moderation`: reports, block, account suspension, audit trail
11. `admin`: strict role-based actions, never trust role from client
12. `observability`: structured logging, tracing, metrics, alerting
13. `infrastructure`: config, database pool, R2 S3 client, provider keys, background jobs
14. `identity_verification`: AWS liveness sessions, ownership/consent, pinned R2 photo reference, server-only CompareFaces decision, revocation/appeal/audit (read Chapter 23)

Keep handler -> service/use-case -> repository boundaries where practical; shared domain logic must not live in HTTP controllers or React Native.

---

## 4. Monorepo Layout (adapt to existing repository, don't delete user files)

```text
repository/
├── mobile/                       # React Native app (or existing app root)
│   ├── src/
│   │   ├── app-or-navigation/
│   │   ├── screens/
│   │   │   ├── auth/
│   │   │   ├── onboarding/
│   │   │   ├── discover/
│   │   │   ├── matches/
│   │   │   ├── chat/
│   │   │   ├── profile/
│   │   │   └── settings/
│   │   ├── features/
│   │   ├── components/
│   │   ├── services/{api,auth,websocket,uploads,notifications}/
│   │   ├── hooks/
│   │   ├── state/
│   │   ├── storage/
│   │   └── types/
│   ├── package.json
│   └── ...existing expo / native files...
├── backend/
│   ├── Cargo.toml
│   ├── Cargo.lock
│   ├── Dockerfile
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── app.rs
│   │   ├── config.rs
│   │   ├── errors.rs
│   │   ├── auth/
│   │   ├── modules/{users,profiles,discovery,matching,chat,realtime,media,notifications,moderation}/
│   │   ├── infra/{db,r2,identity,push,redis,telemetry}/
│   │   └── jobs/
│   ├── migrations/
│   └── tests/{integration,security,contract}/
├── contracts/
│   ├── openapi.yaml
│   ├── asyncapi.yaml             # optional formal WS event contract
│   └── json-schemas/
├── infra/
│   ├── fly.toml
│   ├── docker-compose.yml
│   ├── .env.example
│   └── scripts/
├── docs/
│   ├── AS_IS_AUDIT.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── API.md
│   ├── SECURITY.md
│   ├── DEPLOYMENT.md
│   ├── RUNBOOK.md
│   ├── ADR/
│   └── RELEASE_CHECKLIST.md
├── .github/workflows/{backend-ci,mobile-ci,deploy-staging}.yml
└── README.md
```

Claude must NOT overwrite existing navigation, package configuration, Expo/Bare setup, environment naming, or R2 upload implementation without first showing the compatibility impact.

---

## 5. PostgreSQL — Data Model (Authoritative Contract)

### 5.1 General DB Rules

- `UUID` primary keys server-generated; UTC `TIMESTAMPTZ` for all timestamps; `BIGINT` sequence for ordering within each conversation
- use `UNIQUE`, `CHECK`, `FOREIGN KEY`, transaction boundaries and indexes; do **not** rely only on React Native validation
- do not store raw passwords or private credentials in Postgres; auth provider manages credentials
- do not put private media or base64 image data into Postgres; store **R2 object keys** only
- use `ON DELETE` behavior deliberately; account deletion is a lifecycle operation, not uncontrolled cascading deletes
- PII minimization, status-based soft deletion and a separate verified purge process for legal retention requirements
- enable TLS to Neon; separate **pooled** `DATABASE_URL` for application traffic and **direct** `DATABASE_DIRECT_URL` for SQL migrations/pg_dump/session operations
- avoid Postgres `LISTEN/NOTIFY` over transaction-mode PgBouncer as main multi-instance messaging fabric
- choose transaction-safe SQL and test against actual Neon pooled endpoint; consider SQLx prepared statement behavior when using a PgBouncer configuration

### 5.2 ERD Overview

```mermaid
erDiagram
  users ||--|| profiles : has
  users ||--o{ user_interests : selects
  interests ||--o{ user_interests : categorizes
  users ||--o{ swipes : acts
  users ||--o{ matches : pairs
  matches ||--o| conversations : enables
  conversations ||--o{ conversation_members : includes
  users ||--o{ conversation_members : joins
  conversations ||--o{ messages : contains
  users ||--o{ messages : sends
  users ||--o{ media_assets : owns
  media_assets ||--o{ messages : attached
  users ||--o{ blocks : creates
  users ||--o{ reports : files
  users ||--o{ device_tokens : registers
  conversations ||--o{ notification_jobs : triggers
  outbox_events ||--o{ notification_jobs : fans_out
```

### 5.3 Initial migration SQL (baseline, review with actual domain requirements)

> Migration ต่อไปนี้เป็น **design baseline** สำหรับให้ Claude นำไปใช้ ตรวจแก้ตาม Repo/SQLx และรันจริงใน test DB ก่อน Production. กรณี `profiles` ต้องเพิ่มฟิลด์/ข้อกำหนดเฉพาะผลิตภัณฑ์ควรทำ migration ใหม่ ไม่แก้ migration ที่ใช้งานไปแล้ว.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_provider TEXT NOT NULL DEFAULT 'firebase',
  provider_uid TEXT NOT NULL,
  email TEXT,
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active','suspended','deleting','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (auth_provider, provider_uid)
);

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  display_name VARCHAR(80) NOT NULL,
  bio VARCHAR(500) NOT NULL DEFAULT '',
  university VARCHAR(120),
  faculty VARCHAR(120),
  city_label VARCHAR(100),
  visibility TEXT NOT NULL DEFAULT 'visible'
    CHECK (visibility IN ('visible','hidden')),
  discoverable BOOLEAN NOT NULL DEFAULT TRUE,
  primary_avatar_asset_id UUID,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug VARCHAR(64) UNIQUE NOT NULL,
  label VARCHAR(100) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE user_interests (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id UUID NOT NULL REFERENCES interests(id),
  PRIMARY KEY (user_id, interest_id)
);

CREATE TABLE swipes (
  actor_id UUID NOT NULL REFERENCES users(id),
  target_id UUID NOT NULL REFERENCES users(id),
  direction TEXT NOT NULL CHECK (direction IN ('like','pass')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, target_id),
  CHECK (actor_id <> target_id)
);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id UUID NOT NULL REFERENCES users(id),
  user_high_id UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','unmatched','blocked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL UNIQUE REFERENCES matches(id),
  last_message_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_message_seq >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  last_read_seq BIGINT NOT NULL DEFAULT 0 CHECK (last_read_seq >= 0),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id),
  object_key TEXT NOT NULL UNIQUE,
  thumbnail_object_key TEXT UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('avatar','chat_attachment')),
  mime_type TEXT NOT NULL,
  expected_bytes BIGINT CHECK (expected_bytes > 0),
  actual_bytes BIGINT CHECK (actual_bytes > 0),
  width INT CHECK (width > 0),
  height INT CHECK (height > 0),
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','processing','ready','rejected','deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

ALTER TABLE profiles ADD CONSTRAINT profiles_avatar_fk
  FOREIGN KEY (primary_avatar_asset_id) REFERENCES media_assets(id);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  seq BIGINT NOT NULL CHECK (seq > 0),
  sender_id UUID NOT NULL REFERENCES users(id),
  client_message_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','image')),
  body TEXT,
  media_asset_id UUID REFERENCES media_assets(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (conversation_id, seq),
  UNIQUE (sender_id, client_message_id),
  CHECK ((kind = 'text' AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 4000 AND media_asset_id IS NULL)
      OR (kind = 'image' AND media_asset_id IS NOT NULL AND (body IS NULL OR char_length(body) <= 4000)))
);

CREATE TABLE blocks (
  blocker_id UUID NOT NULL REFERENCES users(id),
  blocked_id UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id),
  reported_user_id UUID NOT NULL REFERENCES users(id),
  conversation_id UUID REFERENCES conversations(id),
  reason TEXT NOT NULL CHECK (reason IN ('spam','harassment','impersonation','inappropriate_content','other')),
  detail VARCHAR(2000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  CHECK (reporter_id <> reported_user_id)
);

CREATE TABLE device_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
  token_ciphertext TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_preferences (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  new_match BOOLEAN NOT NULL DEFAULT TRUE,
  new_message BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','dead')),
  attempts INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  claim_token UUID,
  processed_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES outbox_events(id),
  recipient_user_id UUID NOT NULL REFERENCES users(id),
  channel TEXT NOT NULL DEFAULT 'push' CHECK (channel IN ('push')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','cancelled','dead')),
  attempts INT NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, recipient_user_id, channel)
);

CREATE INDEX idx_profiles_discovery ON profiles (visibility, discoverable, university) WHERE discoverable = TRUE;
CREATE INDEX idx_swipes_target_like ON swipes (target_id, actor_id) WHERE direction = 'like';
CREATE INDEX idx_matches_user_low ON matches (user_low_id, status, created_at DESC);
CREATE INDEX idx_matches_user_high ON matches (user_high_id, status, created_at DESC);
CREATE INDEX idx_conversation_members_user ON conversation_members (user_id, conversation_id);
CREATE INDEX idx_messages_history ON messages (conversation_id, seq DESC);
CREATE INDEX idx_blocks_reverse ON blocks (blocked_id, blocker_id);
CREATE INDEX idx_reports_status ON reports (status, created_at);
CREATE INDEX idx_outbox_claim ON outbox_events (status, available_at, created_at)
  WHERE status IN ('pending','processing');
CREATE INDEX idx_notification_jobs_claim ON notification_jobs (status, available_at)
  WHERE status IN ('pending','processing');
```

### 5.4 เพิ่ม hardening ที่ DDL baseline ยังไม่ทำ

- Trigger หรือ application rules เพื่อรับรองว่า `conversation_members` มี **สมาชิกได้เฉพาะ 2 คนที่อยู่ใน Match นั้นจริง**; ห้ามให้ client เพิ่มสมาชิกเอง
- Transactional check ว่าผู้ส่งข้อความเป็นสมาชิกห้องและ Match ยัง `active`/ไม่มี Block ณ เวลาที่บันทึก
- ตรวจ `media_assets.owner_user_id = sender_id` และ state=`ready` ก่อน attach; ป้องกัน reuse object จากผู้ใช้คนอื่น
- `profiles.primary_avatar_asset_id` ต้องเป็น avatar ที่ owner=user_id และ `ready`; ตรวจใน service / trigger
- Guard `conversation_members.last_read_seq <= conversations.last_message_seq` และ update ให้ monotonic เท่านั้น
- DDL เป็น **baseline ที่ไม่ได้ทำ state transition constraints ครบ**; เพิ่ม domain policies ด้วย service functions และ tests
- SQL migration อาจต้องปรับชื่อ field, constraints, RLS และแผน data retention ตามโปรเจกต์เดิม
- `token_ciphertext` ต้องเข้ารหัสฝั่งแอปพลิเคชันด้วย key management ที่ปลอดภัย; `token_hash` ใช้หา token ซ้ำ; ห้าม log token
- `created_at`/`updated_at`: เพิ่ม triggers หรือ update ในทุก transaction อย่างสม่ำเสมอ
- ถ้าใช้ระบบฐานข้อมูลใหญ่มาก ให้ศึกษาการ partition `messages` เมื่อมีประโยชน์จริง ไม่ต้อง partition ตั้งแต่แรก

### 5.5 Atomically Create Mutual Match

ดำเนินการใน **DB Transaction**:

1. รับ `target_user_id` จาก client; อ่าน `actor_user_id` จาก Auth Context เท่านั้น
2. Reject self, suspended, hidden (ตาม product policy), blocked ทั้งสองทิศทาง และ policy-invalid target
3. `INSERT INTO swipes ... ON CONFLICT (actor_id,target_id) DO UPDATE` สำหรับ Like/Pass (idempotent)
4. ถ้า Like ตรวจว่าคู่ตรงข้าม `direction='like'`; ไม่เกิด Match จาก Pass
5. กำหนด canonical pair: `user_low_id = LEAST(actor,target)` และ `user_high_id = GREATEST(...)`
6. `INSERT matches ... ON CONFLICT DO NOTHING`; ดึง Match id เดิม; เพิ่ม `conversations` และ **สมาชิกสองคน** อย่าง atomic สำหรับ Match ที่ active ตามนโยบาย
7. สร้าง outbox event `match.created` เพียงครั้งเดียว; **ห้ามแจ้งเตือนซ้ำเมื่อกด Like ซ้ำ**
8. Commit แล้วตอบ `matched: true/false`, match metadata ตามสิทธิ์
9. ทดสอบ **A และ B กด Like พร้อมกัน** โดยต้องสร้าง Match เพียง 1 รายการ และ Conversation เพียง 1 รายการ
10. หาก unmatch แล้วกด Like ใหม่: ค่าเริ่มต้น MVP คือ **ไม่รีแมตช์อัตโนมัติ**; ต้องตัดสินใจ product policy ก่อนรองรับ

### 5.6 Atomically Send Message

ดำเนินการใน **DB Transaction**:

1. Validate JWT, account active, matching active, member of conversation, both-direction block, content length, media ready/ownership
2. ตรวจ `(sender_id, client_message_id)` ว่าเคยบันทึกแล้วหรือไม่ — ถ้ามีให้ return message เดิม (idempotent response)
3. `UPDATE conversations SET last_message_seq = last_message_seq + 1, updated_at=now() WHERE id=$1 RETURNING last_message_seq` เพื่อ lock/allocate ลำดับใหม่ **ต่อห้อง**
4. `INSERT messages` พร้อม `seq` ใหม่; handle conflict/race idempotently โดย transaction retry ตาม error classification
5. `INSERT outbox_events (event_type='message.created', payload minimal event metadata)` ใน transaction เดียวกัน
6. Commit; ส่ง `message.ack` พร้อม server message id + seq ให้ sender
7. Worker process outbox แบบ at-least-once เพื่อ publish realtime event และสร้าง notification job ที่มี unique event-recipient constraint
8. Receiver ใช้ `seq` + last-seen cursor เพื่อ sync ข้อความตกหล่น; **Redis Pub/Sub ไม่ใช่ durable store**
9. `read receipt` = update monotonic `conversation_members.last_read_seq = GREATEST(old, requested_seq)` หลังตรวจ membership / seq bounds
10. ถ้า Transaction Fail ห้ามส่ง success ACK; retry error ให้ client ใช้ `client_message_id` เดิม

### 5.7 Outbox Worker Reliability

- Worker claim rows ด้วย `FOR UPDATE SKIP LOCKED` + lease/timeout แล้ว commit สถานะ claimed ก่อนทำ external side effects
- หลัง Process เสร็จจึง mark complete; ถ้า Worker crash ให้กลับมา claim job ที่ lease หมดได้
- Implement exponential backoff + jitter, max attempts + dead-letter state, metrics/alerts, admin requeue tool
- **At-least-once event processing**: subscribers/client must dedupe by event/message ID; never promise exactly-once delivery across Redis/FCM/network
- FCM can be duplicated or delayed; notification payload must not be source of chat message truth
- Avoid one global transaction spanning Postgres + Redis + FCM; use transactional outbox + idempotent consumers

---

## 6. Authentication & Authorization

### 6.1 Auth Provider

**First: inspect current React Native auth.** If no suitable provider exists, default to Firebase Authentication.

Flow:

1. React Native signs in through auth SDK (Google/Apple/Email as supported)
2. React Native obtains short-lived **ID Token** and calls Rust with `Authorization: Bearer <token>`
3. Rust verifies signature with provider keys, allowable algorithm, `iss`, `aud`, `exp`, `sub`/uid, key rotation and token structure
4. Rust looks up `(auth_provider, provider_uid)` in `users`; create profile seed via transaction on first verified login
5. Rust resolves **internal UUID** and roles server-side, checks suspended/deleting status
6. Each HTTP/WS session derives identity from **verified claims**, not from user-supplied body fields
7. Authorization for `GET messages`: conversation membership + active state per defined privacy policy
8. Auth error: `401`; recognized user without permission: `403` or privacy-safe `404` consistently

**Important:** Firebase Admin SDK is not officially provided for Rust; implement JWT verification following Firebase's official verification specification using a maintained JWT/JWK library, and test expiry/key rotation/audience/issuer cases. Do not treat unsigned decoded JWT as verified. Revocation checking requires a documented strategy, e.g., short token TTL and targeted provider check for high-risk operations.

### 6.2 Authorization Rules

| Operation | Server-side guard |
|---|---|
| Update profile | `actor == profile.owner` |
| View other profile | status + visibility + blocked both ways |
| Discover | complete filters (blocked, hidden, privacy, passed policy) |
| Like/Pass | valid target and account states |
| Create/read message | active match + conversation membership + no block |
| Read private media | owner or authorized current conversation member |
| Register device token | token bound to verified account; ownership check |
| Report | verified reporter; prevent self-report; anti-spam |
| Admin moderation | server-resolved admin role + audit trail |
| Delete account | reauthentication/fresh token policy for destructive action |

### 6.3 Abuse/Safety Controls

- Rate limits for login-sensitive endpoints, discovery, swipes, messages, media upload intents, reports; use account + device + IP carefully
- Report + Block must work before opening the app to real users
- Block in either direction immediately hides profile/discovery and disables new messages
- No sender notification payload exposing sensitive message body by default; use generic `New message` in privacy mode
- Text sanitization for display (React Native should render plain text, not untrusted HTML) and content moderation policy
- External URLs in bio/messages: validate, avoid unsafe link preview SSRF from backend
- Prevent profile enumeration/scraping using rate limits, limited pagination, privacy-safe response fields
- Security tests: BOLA/IDOR, JWT forgery, horizontal privilege escalation, mass assignment, stale auth, replay, spam, upload abuse
- Consider App Attestation/Play Integrity/Apple App Attest as defense-in-depth **after** core auth/rate limits; not a replacement

---

## 7. REST API Contract v1

### 7.1 Protocol

- Base URL: `https://api.example.com/v1` (placeholder)
- Content-Type: `application/json`; media upload directly to R2 via presigned URL
- Bearer Auth for secured routes
- `Idempotency-Key` header for applicable mutating endpoints (or stable request UUID in body)
- Time: UTC RFC3339 ISO 8601; IDs: UUID strings; paging by **opaque cursor**, never trust client-supplied SQL offset
- API responses use stable `error.code` and `request_id`; don't return raw DB/stack errors
- Keep OpenAPI YAML and TypeScript-generated types aligned with actual Rust API

Example success:

```json
{
  "data": { "id": "11111111-1111-4111-8111-111111111111" },
  "meta": { "request_id": "req-example" }
}
```

Example error:

```json
{
  "error": { "code": "MATCH_NOT_ACTIVE", "message": "Conversation is unavailable" },
  "meta": { "request_id": "req-example" }
}
```

### 7.2 Endpoint Matrix (implement & document)

| Method | Route | Purpose | Guard |
|---|---|---|---|
| GET | `/health/live` | Process alive | public internal health |
| GET | `/health/ready` | Ready to serve | internal health; no secrets |
| POST | `/v1/auth/session` | Verify token, ensure user profile | Bearer |
| GET | `/v1/me` | Current account/profile | Bearer |
| PATCH | `/v1/me/profile` | Editable profile fields allowlist | Owner |
| DELETE | `/v1/me` | Account deletion request | Fresh Auth |
| GET | `/v1/interests` | Active interests | Bearer |
| PUT | `/v1/me/interests` | Replace own selected interests | Owner |
| GET | `/v1/discover?cursor&limit` | Candidate feed with ranking | Bearer + filters |
| GET | `/v1/users/{id}` | Visible profile | Visibility + block |
| POST | `/v1/swipes` | Like/Pass | Bearer + target check |
| GET | `/v1/matches?cursor&limit` | Current matches | Bearer |
| POST | `/v1/matches/{id}/unmatch` | End match | Participant |
| GET | `/v1/conversations?cursor&limit` | Conversations | Member |
| GET | `/v1/conversations/{id}/messages?before_seq&limit` | Chat history | Member + policy |
| POST | `/v1/conversations/{id}/messages` | Send persisted message | Member + active match |
| PUT | `/v1/conversations/{id}/read` | Advance read cursor | Member |
| GET | `/v1/realtime` | WebSocket upgrade | Auth via secure WS mechanism |
| POST | `/v1/uploads/presign` | Generate R2 PUT URL + draft media record | Bearer + quota |
| POST | `/v1/uploads/{id}/complete` | Verify uploaded media and mark processing/ready | Owner |
| GET | `/v1/media/{id}/download` | Authorized short-lived GET URL | Owner/member |
| POST | `/v1/devices` | Register FCM token | Bearer |
| DELETE | `/v1/devices/{id}` | Revoke device token | Owner |
| GET | `/v1/me/notification-preferences` | Read preferences | Owner |
| PATCH | `/v1/me/notification-preferences` | Modify preferences | Owner |
| POST | `/v1/users/{id}/block` | Block | Bearer |
| DELETE | `/v1/users/{id}/block` | Unblock | Owner |
| POST | `/v1/reports` | Report account/content | Bearer |

**Routes under `/v1` are the canonical contract.** The health routes are intentionally outside `/v1`; ensure consistent router implementation and documentation.

### 7.3 Concrete request/response examples

**POST `/v1/swipes`:**

```json
{ "target_user_id": "22222222-2222-4222-8222-222222222222", "direction": "like" }
```

```json
{
  "data": {
    "matched": true,
    "match_id": "33333333-3333-4333-8333-333333333333",
    "conversation_id": "44444444-4444-4444-8444-444444444444"
  }
}
```

**POST `/v1/conversations/{id}/messages`:**

```json
{
  "client_message_id": "55555555-5555-4555-8555-555555555555",
  "kind": "text",
  "body": "สวัสดีครับ"
}
```

```json
{
  "data": {
    "id": "66666666-6666-4666-8666-666666666666",
    "conversation_id": "44444444-4444-4444-8444-444444444444",
    "client_message_id": "55555555-5555-4555-8555-555555555555",
    "seq": 42,
    "kind": "text",
    "body": "สวัสดีครับ",
    "created_at": "2026-10-12T02:00:00Z"
  }
}
```

**History GET `/v1/conversations/{id}/messages?before_seq=42&limit=30`:** Returns descending/ascending order consistently (decide and test), `next_before_seq`, and exactly the messages currently visible under the privacy policy. `before_seq` means *exclusive*.

**POST `/v1/uploads/presign`:**

```json
{ "purpose": "chat_attachment", "content_type": "image/jpeg", "size_bytes": 483210 }
```

```json
{
  "data": {
    "asset_id": "77777777-7777-4777-8777-777777777777",
    "method": "PUT",
    "upload_url": "https://<r2-s3-endpoint>/<key>?X-Amz-...",
    "headers": { "Content-Type": "image/jpeg" },
    "expires_in_seconds": 300
  }
}
```

> Example URLs/UUIDs are illustrative. Do not hardcode them. Returned signed URL is sensitive like a bearer token; redact query params from logs and analytics.

### 7.4 Error Codes (stable)

- `UNAUTHENTICATED`, `INVALID_TOKEN`, `ACCOUNT_SUSPENDED`, `FORBIDDEN`
- `USER_NOT_FOUND`, `PROFILE_NOT_VISIBLE`, `SELF_ACTION_NOT_ALLOWED`, `USER_BLOCKED`
- `MATCH_NOT_ACTIVE`, `NOT_CONVERSATION_MEMBER`, `MESSAGE_TOO_LONG`
- `MEDIA_NOT_READY`, `UNSUPPORTED_MEDIA_TYPE`, `UPLOAD_TOO_LARGE`, `MEDIA_FORBIDDEN`
- `RATE_LIMITED`, `VALIDATION_FAILED`, `CONFLICT`, `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`

Return 429 + `Retry-After` when rate limited; never expose private DB identifiers when blocked/privacy policy implies concealment.

---

## 8. WebSocket Realtime Contract v1

### 8.1 Connection

- Endpoint: `wss://api.example.com/v1/realtime`
- **Do not place long-lived provider JWT in query strings.** Native React Native WS headers may work in selected runtimes, but verify cross-platform support. Prefer a **short-lived, single-use WebSocket ticket** minted using authenticated REST, then send ticket via supported WS authentication channel; server binds connection to verified user and expires/revokes ticket on use.
- Proposed additional endpoint: `POST /v1/realtime/tickets` (Bearer; TTL ~30–60 seconds, one use); store ticket as securely hashed short-lived record in Redis or PostgreSQL depending on stage. For single-instance MVP can use signed short-lived ticket + replay-safe server-side nonce, but multi-instance replay prevention needs shared store.
- TLS only (`wss`), Heartbeat/Ping-Pong, max message size, origin checks where relevant, max concurrent WS per account, server backpressure and clean shutdown.

### 8.2 Envelope format

```json
{
  "v": 1,
  "type": "message.send",
  "request_id": "req-client-uuid",
  "sent_at": "2026-10-12T02:00:00Z",
  "data": {}
}
```

**Client → Server:**

- `message.send`: `{conversation_id, client_message_id, kind, body?, media_asset_id?}`
- `message.read`: `{conversation_id, last_read_seq}`
- `typing.start` / `typing.stop`: `{conversation_id}` (ephemeral, throttled)
- `sync.request`: `{conversations:[{conversation_id,after_seq}]}` (bounded request)
- `ping` (only if app-layer heartbeat used; support WS ping/pong)

**Server → Client:**

- `connection.ready`: `{user_id, connection_id, heartbeat_seconds}`
- `message.ack`: `{request_id, client_message_id, message}`
- `message.created`: `{message}`
- `message.read`: `{conversation_id, reader_user_id, last_read_seq}`
- `match.created`: `{match_id, conversation_id, peer_summary}`
- `match.ended`: `{match_id, conversation_id, reason_code}`
- `typing.changed`: `{conversation_id, user_id, is_typing}`
- `sync.result`: `{conversations:[{conversation_id, messages, next_cursor, has_more}]}`
- `error`: `{request_id?, code, message}`

### 8.3 Message ordering, retry, receipts

- Authoritative order per conversation = `messages.seq` assigned transactionally by DB; do not use client device clock for ordering
- Optimistic UI: client shows pending message with client UUID; on ACK replace temp entry with official message
- Deduplicate by `(sender_id, client_message_id)` and by `message.id` client-side
- On reconnect, first fetch missed messages with `seq > last_seen_seq` or use equivalent bounded sync; reconcile out-of-order events
- Message committed != delivered != read. Receipt fields/events must reflect actual device-side acknowledgments and user views
- On logout/switch account clear WS, pending auth, sensitive local cache according to session policy
- Ensure no private data is broadcast after Match ended or Block occurred; check authorization at delivery or invalidate subscriptions/sessions promptly

### 8.4 Multi-machine scaling

When 2+ API machines exist, in-memory WS registry is only local. Add Redis Pub/Sub or equivalent fanout bus keyed by target user/conversation. Avoid relying on one consumer receiving messages over Pub/Sub. Replay from PostgreSQL remains mandatory; Pub/Sub alone may lose events when a subscriber is offline. Validate connection limits and memory with load tests.

---

## 9. Discovery & Matching Logic

### 9.1 Pipeline

1. **Eligibility filtering**: self, deleted/suspended, hidden, not onboarded, bidirectional blocks, existing active matches, prior pass policy, consent/age/university visibility rules
2. **Candidate retrieval**: indexed PostgreSQL queries; paginate and cap candidate set. Consider diversity/fairness to avoid repeating the same users
3. **Ranking (MVP)**: deterministic weighted score; no automatic ML training or profiling of sensitive attributes
4. **Exposure logging (optional)**: minimal anonymized events for improving algorithm; comply with privacy settings
5. **Feedback**: Like/Pass; mutual Like creates Match transactionally

### 9.2 Example baseline score (product-adjustable; NOT a validated model)

```text
score = 0.40 * shared_interest_score
      + 0.25 * common_community_score
      + 0.20 * activity_overlap_score
      + 0.15 * user_selected_preferences_score
```

- Each component normalized to `[0,1]`; missing data should have a documented neutral policy
- Do not infer protected/sensitive personal attributes
- Make weights config-driven and add unit tests for filtering and ranking
- Avoid N+1 SQL reads; make candidate query bounded and indexed
- If future proximity feature: request consent, use coarse location only, do not expose real-time precise GPS; evaluate PostGIS only if truly needed

---

## 10. Cloudflare R2 Media Design

### 10.1 Storage policy

Keep existing R2 account/bucket/integration. Propose logical prefixes; map them to current bucket structure after audit:

```text
avatars/{user_uuid}/{asset_uuid}/original.jpg
avatars/{user_uuid}/{asset_uuid}/thumb_256.webp
chat/{conversation_uuid}/{asset_uuid}/original.jpg
chat/{conversation_uuid}/{asset_uuid}/thumb_512.webp
quarantine/{owner_uuid}/{asset_uuid}/incoming.bin
```

- **Private by default**, especially chat attachments and raw uploads
- Use public CDN/Cache only for assets explicitly meant to be publicly accessible based on visibility and privacy policy; invalidate/rotate objects when permission changes
- Never return R2 permanent credentials or use predictable shared write keys
- Store stable `media_asset_id` and object key, not expiring signed URL, as DB record

### 10.2 Secure upload flow

1. User requests upload intent (purpose, declared MIME, declared size), auth + rate limit + per-user quota
2. Rust generates unpredictable unique key in pending/quarantine namespace, persists `media_assets(state='pending')`
3. Rust creates short-lived **S3-compatible R2 presigned PUT** (suggest 5 minutes) with method/object key/allowed `Content-Type` signed consistently
4. React Native uploads directly; progress/retry UX; URL is single-object scoped **but may be reusable before expiry** — treat as bearer token
5. React Native calls complete; Rust uses R2 `HEAD`/metadata and processing pipeline to validate actual size/type/magic bytes, enforce allowed dimensions, remove EXIF/location, optionally scan/moderate, transcode + thumbnail
6. Publish a new immutable finalized key or enforce object immutability policy, set DB state=`ready`, attach only after verification; reject/delete invalid file and log safe reason
7. For private read: Rust checks actor's permission then issues short-lived R2 **presigned GET**; authorized URL still shareable while valid, so keep TTL brief
8. Periodic cleanup for abandoned `pending` objects and orphan metadata; ensure deleting account/media removes R2 objects according to retention policy

**Important Cloudflare behavior:** R2 presigned URLs use the **S3 API endpoint** and **not the public custom-domain endpoint**. If Content-Type was signed, RN request must use the same header. CORS is primarily a browser concern, not an authorization mechanism for native React Native apps. Validate uploaded data server-side rather than trusting a signed `Content-Type`.

### 10.3 Media limits (initial suggested configuration — adjust by product policy)

- Avatar: JPEG/PNG/WebP, max 8 MiB incoming, max 4096×4096 pixels, create 256px thumbnail
- Chat image: JPEG/PNG/WebP, max 12 MiB incoming, max 6000×6000 pixels, create 512px preview
- Max upload intents per account per interval, max retained media quota, account-level cleanup
- Verify large decompression/image bombs (pixel count) and storage abuse
- Avoid untrusted SVG/HTML uploads in MVP; no executable content types
- Avoid caching private signed responses in shared caches

---

## 11. Push Notifications (FCM for Android & iOS through APNs)

- Check actual React Native environment (Expo Go/Development Build/Bare) and current notification library before choosing integration
- Firebase Cloud Messaging HTTP v1 from Rust Worker, authorized using service account OAuth2; secrets in Fly secrets
- iOS setup must include APNs capability/credentials and entitlements via the appropriate React Native/Expo integration
- `device_tokens`: associate with verified user, encrypt at rest if stored, hash for deduplication, rotate token, delete invalid tokens from provider responses
- Event examples: `match.created`, `message.created`; honor preferences, recipient block state, quiet-hour policy if added
- Push worker should attempt delivery only after DB commit; batch where appropriate and honor provider rate limits
- Never rely on FCM as durable message delivery, and avoid exposing private message text in lock-screen payload by default
- On tap, open corresponding route and fetch authoritative state via secured REST API
- Disabled notification permission must not break realtime/chat; foreground user receives WebSocket events normally

---

## 12. React Native Mobile Implementation

### 12.1 Existing app audit

Determine:

- Expo managed / custom dev client / React Native CLI (Bare)
- Navigation: Expo Router / React Navigation / other
- Data fetching: TanStack Query / Redux Toolkit / Zustand / other
- Current authentication SDK/provider and secure token storage
- Existing Cloudflare R2 uploader + generated URL pattern + image viewer
- Existing UI designs and screens for profiles, discover, match, chat
- Build setup for iOS/Android and push entitlement provisioning

Only add packages when necessary; avoid two competing HTTP clients/state managers.

### 12.2 Essential app features

- Auth: session persistence, refresh token lifecycle via provider, secure logout, account suspension UX
- Profile: form validation, edit, selected interests, avatar upload/delete, privacy visibility
- Discover: fast virtualized list/cards, prefetch small profile images, rate-limited swipe actions
- Matches: list sorted by latest activity; new match state; unmatch/block
- Chat: WS lifecycle, local persisted recent messages where permitted, optimistic pending state, read cursor, offline queue with same UUID, retry failed send
- Notifications: permission UX, register/unregister device token, tap navigation
- Settings: privacy, blocked list, notifications, report, account deletion request
- Error/empty/loading states, offline banners, accessibility, localization foundation (Thai/English), small-screen layouts

### 12.3 Client security

- **Never store DATABASE_URL, R2 API credentials, FCM private service account** in app
- Provider tokens only through secure supported storage; avoid logging sensitive tokens
- Verify returned media is intended for the current user, use HTTPS/WSS
- Image cache and auth state must clear/scope per account when switching users
- API request cancellation/timeouts and safe retry semantics; retry only idempotent operations or reuse idempotency key
- Track startup/performance without uploading chat body / raw private profile content to analytics

---

## 13. Fly.io + Neon Infrastructure

### 13.1 Region choices

- Fly.io: **Singapore (`sin`)**
- Neon: choose AWS Singapore (`ap-southeast-1`) if currently offered by plan/console
- End-users mostly in Thailand; measure real mobile latency and DB RTT rather than assuming exact numbers

### 13.2 Environment variables (template ONLY)

```dotenv
APP_ENV=development
RUST_LOG=info
HOST=0.0.0.0
PORT=8080
PUBLIC_API_BASE_URL=https://api.example.com
DATABASE_URL=postgresql://USER:PASSWORD@POOLED_HOST/DB?sslmode=require
DATABASE_DIRECT_URL=postgresql://USER:PASSWORD@DIRECT_HOST/DB?sslmode=require
DATABASE_POOL_MAX=10
DATABASE_POOL_MIN=1
DATABASE_CONNECT_TIMEOUT_SECONDS=10
AUTH_PROVIDER=firebase
FIREBASE_PROJECT_ID=placeholder
FIREBASE_SERVICE_ACCOUNT_JSON=DO_NOT_COMMIT_REAL_SECRET
R2_ACCOUNT_ID=placeholder
R2_BUCKET_NAME=placeholder
R2_ACCESS_KEY_ID=DO_NOT_COMMIT_REAL_SECRET
R2_SECRET_ACCESS_KEY=DO_NOT_COMMIT_REAL_SECRET
R2_PRESIGN_TTL_SECONDS=300
REDIS_URL=                        # optional until multi-instance
OTEL_EXPORTER_OTLP_ENDPOINT=      # optional
SENTRY_DSN=                       # optional
```

**Safety:** real `.env` must be `.gitignore`-ed; use Fly secrets/environment-specific secret manager for deployment. Never store real tokens in `.env.example` or GitHub Actions logs.

### 13.3 Example Fly configuration (starter; validate with deployed app)

```toml
app = "REPLACE_WITH_FLY_APP_NAME"
primary_region = "sin"

[build]
  dockerfile = "backend/Dockerfile"

[env]
  APP_ENV = "production"
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = false
  min_machines_running = 1

  [[http_service.checks]]
    method = "GET"
    path = "/health/ready"
    interval = "15s"
    timeout = "3s"
    grace_period = "20s"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory = "1gb"
```

> Check Fly's accepted syntax and location of `Dockerfile` **relative to fly deployment working directory**. If `fly deploy` is run inside `backend/`, change Dockerfile path accordingly. If `auto_stop_machines='off'`, `min_machines_running` is not the mechanism controlling uptime; do not assume it manages Machine count. This is an initial always-on configuration, not a production capacity proof.

### 13.4 Docker & deployment quality

- Multi-stage Docker build; compile native Rust release binary, non-root runtime where possible, pinned base image/digest, reduce attack surface
- `GET /health/live`: fast, no network dependency; `GET /health/ready`: app ready + bounded DB connectivity check, beware flapping on brief DB hiccups
- Graceful SIGTERM: stop accepting new WS, send shutdown notice, drain, finish in-flight commits, release leases
- Staging and Production environments separate; Neon branches/test DB never accidentally point to prod
- SQL migrations via **direct database URL**, in a controlled CI/release step with rollback strategy; deploy code backwards compatible with schema changes (expand/migrate/contract)
- Never use automatic DB-destructive rollback without explicit operations plan
- Set CPU/RAM, connection count, soft/hard concurrency limits **based on load test**, not assumptions
- Use Fly health checks and rolling/bluegreen strategy as allowed by Machine count/budget

### 13.5 Neon lifecycle

- App reads/writes pooled URL (test SQLx driver compatibility); migrations direct URL
- Production latency-sensitive plans: consider keeping Neon compute active if scale-to-zero latency unacceptable
- Set realistic per-instance DB connections: `total ≈ API machines × pool_max + worker pools + admin connections` and confirm DB plan capacity
- Enable backup/restore strategy and verify retention/point-in-time recovery plan; simulate restore into isolated DB at scheduled intervals
- Manage query budgets using `EXPLAIN (ANALYZE, BUFFERS)`, indexes, and slow query monitoring; no blanket cache without staleness policy

---

## 14. S-Tier Performance Targets (Proposed SLOs, NOT guaranteed benchmarks)

| SLI | Proposed target | Measurement |
|---|---|---|
| Rust REST P95 | <= 200 ms server processing | HTTP histogram excluding client network |
| Discovery P95 | <= 300 ms server processing | matching endpoints |
| Message send-ACK P95 | <= 400 ms over normal target mobile conditions | mobile E2E with network labels |
| Online chat delivery P95 | <= 500 ms app-to-app where both connected under defined network profile | instrument both clients + trace IDs |
| Availability | >= 99.95% monthly target AFTER HA phase | synthetic probes + actual availability |
| 5xx error ratio | <= 0.1% for server-attributable requests | metrics tagged by route |
| Message persistence | No acknowledged message lost in defined failure tests | crash/restart chaos cases |
| Duplicate creation | One DB message per `(sender,client_message_id)` | DB constraints + concurrency tests |
| Incident recovery | Define RTO/RPO with stakeholders then test | drills/runbook |

SLOs require an explicit measurement population and load profile. 99.95% availability is **not** a guaranteed outcome with a single-region single-DB architecture. For initial MVP relax availability objective if budget cannot meet redundancy.

### 14.1 Bottlenecks to measure

- p50/p95/p99 per endpoint, DB query duration, DB pool wait time, WebSocket open connection count, per-instance RSS/CPU, fanout lag
- Outbox pending/oldest age, notification retry/deadletter, R2 upload complete-to-ready time
- Mobile cold launch, image load, crash-free sessions, list scrolling frames, memory
- Region RTT Thailand ↔ Singapore, and Fly ↔ Neon; don't confuse network latency with Rust compute latency

### 14.2 Load testing scenarios

1. 100 concurrent WS clients (baseline)
2. 1,000 concurrent WS clients under idle + active mix
3. 5,000 concurrent WS clients (target for planning; may need multiple instances)
4. Peak send rates, e.g. 10/50/100 messages/sec (test scenarios, **not assumed app capacity**)
5. Discovery pagination with meaningful DB population and indexes
6. Cold-start/DB-resume and reconnect storm after deploy
7. A/B two-user simultaneous Like race, duplicate message retries, block during send
8. Instance restart at commit/ack/publish points; validate replay/reconciliation

Use k6/Artillery or a custom Rust WS load client, plus `pg_stat_statements`/Neon metrics, tracing and real device tests. Record Machine model, region, DB plan, dataset size, scenario, errors and percentiles. **Do not declare S-Tier only from synthetic local tests.**

---

## 15. Security, Privacy, and Abuse Checklist

### 15.1 Mandatory before public release

- [ ] JWT verification + reject wrong issuer/audience/expired/unsigned token
- [ ] Horizontal authorization tests on *every* user ID and conversation ID endpoint
- [ ] Both-direction Block enforce discovery/chat/media and invalidate affected realtime sessions
- [ ] API request validation; prevent SQL injection using SQLx parameterized queries
- [ ] Safe API logging; redact tokens, chat body, signed URL query, PII
- [ ] R2 private-by-default, secure presign, upload verification, size/type and decompression limits
- [ ] Login, swipe, media, messaging, report rate limits and anti-automation defenses
- [ ] Account suspension/moderation with audit trail and no privilege escalation
- [ ] User data deletion/export policy and retention period documented
- [ ] TLS all network paths; no production secrets committed; least-privilege access keys
- [ ] Dependency audit, container scan, secret scan, branch protection for production deployment
- [ ] Backups with documented restore test
- [ ] Explicit policies for minors, harassment, personal safety and permitted content

### 15.2 Thai PDPA and user privacy (requirements needing legal review)

- Document purposes/retention for profile, university info, chat, uploaded media and device token
- Show privacy notice and consent mechanisms wherever consent is the relevant lawful basis
- Support profile hiding, Block, Report, data access/deletion flows
- Restrict staff access to reports/private data, use moderation role/audit, do not silently make all chat readable to admins
- Verify age and youth-specific controls before release if minors may join
- Define deletion policy for backups, evidence retained for abuse reports, and data-subject requests; **do not invent legal guarantees**

### 15.3 E2EE decision

MVP **does not include true end-to-end encryption**. HTTPS/WSS encrypts in transit, while server-managed message storage can be decrypted by authorized backend components. Do not label the app "E2EE" or "end-to-end encrypted" unless a separately reviewed protocol/key management implementation is developed and audited.

---

## 16. Observability, CI/CD & SRE

### 16.1 Logs and traces

- Rust: `tracing`, `tracing-subscriber`, OpenTelemetry where useful, request IDs correlated with SQL span/WS event IDs
- Metrics: HTTP P95/P99, status code rates, Postgres connection pool saturation, WS count, fanout lag, worker backlog
- Error reporting: Sentry or equivalent on Rust + React Native; redact sensitive payloads
- Alerting: consecutive health failures, elevated 5xx, DB unreachable, oldest pending outbox event age, notification dead-letter spike, abnormal upload failures
- Health endpoints should **not** reveal secrets/DB configuration

### 16.2 CI Pipeline

Backend PR:

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --workspace
cargo audit   # only if installed/configured; pinned CI tool
```

Additional:

- SQLx migrations against disposable PostgreSQL/Neon branch in CI
- Rust integration test with Postgres test container or managed test branch
- Contract checks: OpenAPI -> generated mobile TypeScript types; compare REST/WS payload definitions
- Dependency scanning, secret scanning, Docker image build/scan
- Mobile: `tsc --noEmit`, lint, unit tests, E2E smoke on Android/iOS as project supports
- Deploy Staging on merge, smoke test; Production manual approval / tagged release

### 16.3 Recovery runbooks

- Database unreachable: stop accepting unsafe writes, return retriable errors, monitor pool, avoid fake success ACK
- Fly Machine restart: clients reconnect; synchronize messages using `seq`; worker reclaims stale outbox leases
- Redis outage: DB durable path continues; realtime availability may degrade, recover by replay; metrics alert
- R2 outage: block new uploads, preserve text chat where possible, retry safely; no image access bypass
- Compromised credentials: rotate secret and tokens, invalidate sessions as supported, inspect audit and incident timeline
- Broken migration: restore documented backup **only when appropriate**, prefer forward fix under expand/contract, coordinate service maintenance

---

## 17. Implementation Roadmap — Claude MUST build in this order

### Phase 0 — Audit & Project Setup

**Deliverables:** `docs/AS_IS_AUDIT.md`, architecture decisions, updated README, `.env.example`, dependency plan.

**Acceptance:** existing RN app builds with zero unintended behavior change; current R2 uploader identified; auth provider clearly identified; missing decisions listed.

### Phase 1 — Rust Backend Scaffold

- Axum router, Tokio runtime, `AppState`, structured error type, config validation, graceful shutdown
- SQLx pool connection, health live/ready endpoints, request tracing, local Docker Compose Postgres
- Tests for config/health and CI

**Acceptance:** `cargo test`, `cargo clippy`, local `curl /health/ready` pass with DB; no secrets committed.

### Phase 2 — DB Migrations & Auth

- Initial schema migration (above, reconciled), seed interests
- Auth verification adapter/provider abstraction, user bootstrap, suspended account handling
- Typed internal auth context and negative/forgery tests

**Acceptance:** invalid token 401; wrong user ID cannot update/view private records; migrations re-run on clean test DB.

### Phase 3 — Profiles + Discovery

- Profile edit, interests, visibility, candidate eligibility filtering, deterministic ranking and pagination
- RN integration with typed REST client, loading/error/offline states

**Acceptance:** hidden/blocked/private users cannot be surfaced; stable pagination; indexes and query plan reviewed.

### Phase 4 — Matching

- Like/Pass idempotency, atomic mutual match + conversation + two participants, unmatch
- Report/Block minimal endpoints

**Acceptance:** parallel Likes create exactly one Match/Conversation, blocked target cannot be liked or chatted with, repeated request does not duplicate effects.

### Phase 5 — Chat Persistence + REST

- message tables/cursor query, server sequence, idempotency, read receipts
- transactional outbox and minimal worker tests

**Acceptance:** message persisted before ACK; duplicate UUID only one message; read/history cannot cross conversations; restart after DB commit does not lose message.

### Phase 6 — WebSocket + React Native Chat

- WS ticket auth, connection manager, send/ack/events, reconnection/backfill, typing indicators
- Optimistic UI, offline retry with stable UUID, cache scoping per account

**Acceptance:** 2 real devices exchange chat; airplane mode/reconnect does not lose committed messages; no cross-user broadcasts.

### Phase 7 — R2 Upload + Media Delivery

- Reuse existing R2 client integration; add secure presign intent/complete flow, image verification, thumbnail pipeline and short-lived read URLs
- RN upload progress and secured image rendering

**Acceptance:** other user cannot upload/read private media; expired/forged signed URLs do not bypass permissions; invalid images rejected; original integration preserved.

### Phase 8 — Notifications, Moderation & Account Lifecycle

- FCM token registration and encrypted storage, push preferences, worker/retry
- Reports moderation workflow, block, account deletion request and retention handling

**Acceptance:** disabled push does not break messages; expired device token disabled; reports handled only by authorized roles; deletion process testable.

### Phase 8A — Rekognition Photo Verification Hardening (existing system)

- **Required**: Audit existing Face Liveness + CompareFaces integration; inspect native SDK, mobile permissions, AWS Region, IAM credentials, and how verified badge is assigned
- Implement server-side AWS result retrieval and ownership binding, safe session expiry and replay protection, immutable R2 reference image/hash, comparison from image bytes, and SQLx identity-verification audit migrations
- Expose clear `PHOTO_VERIFIED` distinct from university/account verification; revocation when image changes, consent and short retention, alternative accessibility path and calibrated decision thresholds
- Build/tune native iOS/Android Expo SDK 58 integration only after verifying compatibility on devices; no Expo Go-only production claim

**Acceptance:** Server-only badge assignment; all cross-user, replay, image-swap, session-expiry and error-path tests pass; user-consent and biometric privacy reviewed; no production biometric data changed without approval. **Full executable brief in Chapter 23**.

### Phase 9 — Staging Deployment & Security Gate

- Docker + Fly Singapore deployment to **staging only**, Neon staging branch/db, health checks, environment secrets
- CI/CD, OpenTelemetry/Sentry, threat model, security tests, external mobile smoke

**Acceptance:** staging all core flows pass with real service integrations; migrations/backups tested; no security-critical open defects.

### Phase 10 — Load Test, Multi-instance & Production Readiness

- Record real capacity, add 2nd Fly Machine only when HA required, Redis fanout only when multi-machine realtime demands it
- Worker lease recovery, graceful rolling deploy, incident alerts, restore drill, release checklist

**Acceptance:** agreed load/SLO budgets pass; server restart preserves acknowledged messages; rollback plan exercised; Production deployment requires manual approval.

---

## 18. Test Matrix (Detailed)

| Area | Test | Expected |
|---|---|---|
| Auth | Expired/JWT wrong issuer/wrong project | 401 |
| Auth | Existing user re-login | same internal user UUID |
| Auth | Suspended account | no normal API/WS access |
| Profile | Modify another user profile | deny |
| Discovery | Blocked/hidden account in candidates | never shown |
| Swipes | Same Like twice | one swipe state, no extra match notification |
| Matching | Both users Like concurrently | exactly one match/conversation |
| Matching | Self Like / blocked target | reject |
| Chat | User outside conversation GET history | deny |
| Chat | Duplicate `client_message_id` after timeout | same persisted message/seq |
| Chat | WS close between DB commit and ACK | retry resolves existing message |
| Chat | 1,000 WS idle/active load profile | measured results with no unbounded memory growth |
| Chat | Block while WS already connected | new send/broadcast denied |
| Identity | Mobile sends `verified: true` | ignored/rejected; no badge |
| Identity | Reuse/wrong owner AWS session | deny or return safe idempotent state |
| Identity | New profile image after verification | revoke photo badge until reverified |
| Identity | AWS error or missing liveness reference image | no approval; safe retry/review |
| Chat | Reconnect missing events | reconcile from DB seq |
| Chat | Read receipt stale/out-of-bounds | no regression/no overflow |
| R2 | Upload forbidden MIME/over max size | reject/quarantine cleanup |
| R2 | Another user's private photo GET | deny |
| R2 | Expired presign / fake key | deny |
| Push | Duplicate outbox delivery | no duplicate DB message; notification idempotency best effort |
| Push | Device token invalid | deactivate token |
| Worker | Crash after claim | lease expiry + retry |
| Worker | Database down | no fake success; eventual recovery |
| Deletion | Request deletion | hidden/restricted immediately; purge per policy |
| Security | Logs inspected | no JWT, media presign, chat text, service secrets |
| Ops | DB restore in staging | successful tested restore |

### 18.1 Definition of Done for EACH feature

- Runtime/compile success
- Tests positive, negative, concurrency as appropriate
- OpenAPI/WS contract updated and TS client adjusted
- Migration + indexes if schema changed
- Authentication and object authorization validated
- Rate limit/error handling/logging included
- Observability signal for production issue
- Manual QA instructions documented
- No known secret leak or unintended modification of existing RN/R2 code

---

## 19. Production Release Checklist

- [ ] Existing React Native app features not regressed (Android/iOS smoke)
- [ ] App privacy notice, terms, content/report policies approved
- [ ] Sign-in/out, revoked/suspended user checks work
- [ ] All migrations verified in staging; direct DB connection only for migration tool
- [ ] All target tables/constraints/indexes verified
- [ ] End-to-end matching and messaging tests pass
- [ ] Secure media upload/download and cache policies tested
- [ ] FCM tested on real Android and iOS devices with correct entitlements
- [ ] Secrets deployed via secrets manager; GitHub CI never prints them
- [ ] Monitoring dashboard + alerts + on-call ownership established
- [ ] Recovery drill and backup retention recorded
- [ ] Rate limits, BOLA/IDOR test pass
- [ ] Load tests saved with hardware/region/network assumptions
- [ ] WebSocket graceful shutdown/reconnect tested during deploy
- [ ] Cost alerts/budgets configured on Fly/Neon/Cloudflare
- [ ] Production change and deployment explicitly approved

---

## 20. Open Decisions — Do NOT guess silently

| Question | Safe default until resolved |
|---|---|
| Expo or Bare React Native? | Detect in repo; do not migrate framework |
| Existing auth provider? | Reuse current provider; Firebase only if chosen after audit |
| Is CampusMate the final product name? | Treat as working title |
| Minimum age and youth safety policy? | Block public launch until product/legal policy agreed |
| Restrict membership to university emails? | **Not enforced** unless explicitly required; design optional future verification |
| Is matching friendship-only or dating? | Friendship-only wording; do not infer protected traits |
| Can users re-match after unmatch? | No auto-rematch in MVP; explicit later product decision |
| Can unmatched users see old messages? | Default deny new access until formal privacy policy decided; avoid silently deleting history |
| Message retention and attachment cleanup? | Policy required before public launch |
| Media CDN public vs private? | Private by default; only public if consent/policy permits |
| Read receipts and typing visibility opt-outs? | Configurable later; no precision presence tracking by default |
| Chat E2EE requirement? | Not in MVP; do not claim E2EE |
| Planned DAU/concurrent WS and monthly budget? | Measure; no arbitrary capacity promise |
| Admin moderation roles? | No privileged role from client; define server roles + audit |
| Face verification: is PHOTO_VERIFIED optional? | Optional for initial app access, unless product/legal decision states otherwise |
| Privacy retention/biometric consent and AWS region? | Define before production, minimum retention, no raw image logging |

---

## 21. Official Documentation References (verify versions at implementation time)

- Fly.io Rust deployment: https://fly.io/rust/
- Fly.io app configuration: https://fly.io/docs/reference/configuration/
- Fly.io health checks: https://fly.io/docs/reference/health-checks/
- Fly.io Machine start/stop: https://fly.io/docs/launch/autostop-autostart/
- Neon connect guide: https://neon.com/docs/get-started/connect-neon
- Neon connection pooling: https://neon.com/docs/connect/connection-pooling
- SQLx reference: https://docs.rs/sqlx/latest/sqlx/
- Axum reference: https://docs.rs/axum/latest/axum/
- Tokio: https://tokio.rs/
- Cloudflare R2 upload: https://developers.cloudflare.com/r2/objects/upload-objects/
- R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 CORS: https://developers.cloudflare.com/r2/buckets/cors/
- Firebase verify ID tokens: https://firebase.google.com/docs/auth/admin/verify-id-tokens
- FCM HTTP v1: https://firebase.google.com/docs/cloud-messaging/send/v1-api
- OpenTelemetry Rust: https://opentelemetry.io/docs/languages/rust/
- OWASP API Security Top 10: https://owasp.org/API-Security/
- PostgreSQL documentation: https://www.postgresql.org/docs/
- AWS Rekognition Face Liveness sessions: https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-diagrams.html
- AWS Rekognition shared responsibility: https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-shared-responsibility-model.html
- AWS Rekognition CompareFaces: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html
- Expo native modules: https://docs.expo.dev/modules/overview/

> ราคาบริการ, ฟรีเทียร์, Plan features, SDK, Region availability และ dependency versions อาจเปลี่ยนได้ ไม่ให้ hardcode ตัวเลขค่าใช้จ่ายเป็นข้อเท็จจริงถาวร; ตรวจหน้า pricing/official docs ปัจจุบันก่อน Deploy/สั่งซื้อ

---

## 22. Ready-to-Paste Prompt for Claude Opus 5.5

```text
อ่านไฟล์ CampusMate_S_Tier_Full_System_Spec_for_Claude_Opus_5_5.md ทั้งหมดก่อนเขียนโค้ด

คุณคือ Principal Rust Backend Engineer, Senior React Native Engineer, Cloud Architect และ Security Engineer ของแอป Social/Matching/Chat นี้

เป้าหมาย:
- รักษา React Native + Cloudflare R2 เดิมทั้งหมด
- พัฒนา Rust + Axum + Tokio + SQLx modular monolith
- Neon PostgreSQL เป็น source of truth
- Fly.io Singapore เป็น production target
- Realtime WebSocket, atomic mutual matching, reliable messaging, secure uploads, auth, FCM notifications, moderation
- Existing Amazon Rekognition Face Liveness + CompareFaces: server-only PHOTO_VERIFIED, no replay/cross-account misuse, R2 immutable reference, consent/revocation and Expo 58 native compatibility, per Chapter 23
- ออกแบบเผื่อ multi-instance, outbox, Redis optional, test/observability/recovery

เริ่มจาก:
1) ตรวจ repo ที่เปิดอยู่จริงและสถานะ git
2) ทำ docs/AS_IS_AUDIT.md (แยก existing vs missing vs conflict)
3) ทำ implementation plan ทีละ phase และสร้าง ADR สำหรับสิ่งที่ต้องตัดสินใจ
4) เริ่ม Phase 1 / milestone ที่ปลอดภัยทันที โดยไม่รื้อของเดิม
5) สร้าง source files, migrations, API/WS contracts และ tests จริงตาม spec
6) รัน build/lint/tests แล้วแก้ให้ผ่าน
7) รายงานความสำเร็จด้วย files changed, commands run, test results, missing credentials/config/manual deployment

ข้อห้าม:
- ห้ามใส่ secrets ลง repo/client
- ห้ามลบ/ย้ายข้อมูลจริง, เปิด R2 public, Deploy Production หรือซื้อบริการเอง
- ห้ามถือว่า mocked tests เท่ากับ live integration tests
- ห้ามใช้ Redis Pub/Sub เป็น durable chat store
- ห้ามเปลี่ยน React Native เป็น Flutter และห้ามแทน R2 ด้วย Firebase Storage
- ห้ามสร้าง implementation สมมติว่าเสร็จแล้วเมื่อยังไม่ได้ลงมือ/ทดสอบจริง

ถ้าไม่มีข้อมูล auth provider/Expo-vs-Bare หรือ deployment credentials ให้ทำโค้ดแบบ adapter/configurable และบันทึก Manual Steps; ถามเฉพาะ decision ที่เป็น blocker จริง

ทำงานต่อเนื่องทีละ milestone โดยยึด acceptance criteria ในเอกสารนี้
```

---

**END OF CORE SPEC — see Chapter 23 for the existing Rekognition verification implementation**

---

## 23. Existing Amazon Rekognition Face Liveness + CompareFaces — Mandatory Integration Contract

**MANDATORY FOR CLAUDE:** The user confirms this system already exists. The following complete implementation brief is authoritative for face verification and overrides generic identity assumptions elsewhere in this document. Audit first, change minimally, deploy only with explicit approval. The full brief also exists as a standalone skill reference in the included ZIP.

### CampusMate — S-Tier Face & Profile Verification Blueprint

**Version:** 1.1 (integrated; opaque AWS session ID) • **Date:** 2026-10-12 • **Implementation target:** Claude Code / engineering team  
**Current context:** React Native + Expo SDK 58, Rust + Axum + Tokio + SQLx on Fly.io (Singapore), Neon PostgreSQL, Cloudflare R2, Amazon Rekognition Face Liveness + CompareFaces.  
**Scope:** Design and audit specification; **not** a source-code audit or a claim that production security has been validated.

### 0. Engineering mission and non-negotiables

Upgrade the existing CampusMate face verification without rewriting established mobile, authentication, image-storage or backend functionality. Inspect the current repository and cloud configuration before editing. The server alone decides verified status. Never treat a native UI callback, uploaded selfie, mobile-supplied confidence, or `verified: true` flag as proof. Face Liveness + CompareFaces proves a live session resembles an approved face image; it does **not** establish legal name, date of birth, student affiliation, or government identity. Keep `photo_verified`, `university_verified`, and `account_verified` semantically separate.

**Do not** save AWS root/IAM access keys in React Native, expose raw similarity scores to clients, make biometric media public, log selfie bytes, or assume a Cloudflare R2 object reference is an Amazon S3 `S3Object` accepted by Rekognition. Avoid facial search collections unless separately justified and reviewed. Authentication and verification must remain separate: a photo verification badge does not grant account access.

### 1. Final target architecture

```text
React Native / Expo 58 (iOS & Android)
  ├── Current login provider (preserve)
  ├── Consent + accessibility + camera instructions
  ├── Native Face Liveness SDK bridge [SwiftUI / Jetpack Compose]
  │    └── AWS Rekognition StartFaceLivenessSession (signed client stream)
  └── HTTPS → Rust Axum on Fly.io Singapore
              ├── Auth middleware → current provider JWT verification
              ├── Verification session ownership, throttling, risk controls
              ├── AWS SDK: CreateFaceLivenessSession
              ├── AWS SDK: GetFaceLivenessSessionResults
              ├── R2 SDK: fetch immutable approved reference image as bytes
              ├── AWS SDK: CompareFaces (image bytes, not R2 S3Object)
              ├── Decision engine: versioned thresholds, review policy
              └── Neon PostgreSQL:
                    verification_attempts + photo_verifications + audit_events
Cloudflare R2: approved profile image and app media (separate private boundaries)
AWS S3 (optional): temporary service output **only if needed**, same AWS Region
```

Start with one Rust identity verification module, not a separate microservice. Do not use Redis as the source of truth for verification or allow background jobs to outlive the AWS liveness session lifetime. Consider AWS Rekognition Thailand (`ap-southeast-7`) as a candidate after measuring end-to-end speed and checking every desired API/SDK operation in the target region. AWS documents Face Liveness in Thailand; Singapore is not in the current Face Liveness support list.

### 2. Correct end-to-end verification sequence

1. Logged-in user sees verification purpose, risks, camera notice, consent, accessibility alternatives, and any photosensitivity warning; record consent version/time before processing.
2. Backend identifies the authenticated user and approved **immutable** profile media ID; revalidates ownership, moderation status, acceptable photo quality and privacy classification. Generate a unique image object key and content hash for approved snapshot; reject any client-selected arbitrary URL.
3. `POST /v1/identity/photo-verifications` under JWT, per-user/device/IP rate limiting and concurrency guard. Backend inserts a `CREATING` attempt record, calls AWS `CreateFaceLivenessSession`, then stores AWS session ID (unique), user ID, photo asset ID/hash, AWS Region, expiry, policy version and `CREATED` state. Do not leave an active attempt without cleanup/reconciliation.
4. Client receives only `{verificationId, sessionId, region, expiresAt, state}` plus the **required narrowly scoped AWS authorization mechanism** for streaming. `StartFaceLivenessSession` is done by the official native AWS component, not a homemade selfie upload. Client AWS credentials, if any, must be temporary and least privileged: only the liveness streaming operation; **never** `CompareFaces`, `CreateFaceLivenessSession`, `GetFaceLivenessSessionResults`, or general R2/S3 access. Use AWS Cognito Identity Pool or a rigorously controlled custom temporary credentials provider. Review its IAM policies and session-binding risks.
5. Native component prompts user through the challenge; the client callback only says the stream step ended. It is not an authoritative success verdict.
6. Immediately call `POST /v1/identity/photo-verifications/{verificationId}/complete` (authenticated). Rust checks user ownership and transitions atomically `CREATED/IN_PROGRESS → PROCESSING` to prevent duplicate evaluation.
7. Rust calls `GetFaceLivenessSessionResults(awsSessionId)` **itself** while the AWS result is still available. Require `Status = SUCCEEDED`, an acceptable liveness confidence under the current calibrated risk policy, and a valid returned `ReferenceImage`. Handle missing image as retry/indeterminate rather than verified.
8. Rust retrieves the pinned photo bytes from the private R2 object associated with the attempt; check its stored digest, media type, size, single-face policy and immutability; compare AWS liveness reference image to that image via `CompareFaces` `Bytes` inputs. Rekognition can also accept **Amazon S3** objects; a Cloudflare R2 key is **not** an Amazon S3 bucket for the `S3Object` field. AWS image byte inputs are limited to 5 MB; implement a safe image-transcoding path before compare when necessary.
9. Evaluate **liveness and similarity independently** and use a three-outcome decision policy: `VERIFIED`, `REVIEW_REQUIRED`, or `FAILED/RETRY_ALLOWED`. Never equate AWS confidence 95 with a mathematically guaranteed 95% identity probability. Version and calibrate thresholds using representative consented test pairs and measure false accepts/rejects; give humans a review path for ambiguous cases.
10. Save final outcome with a conditional DB update; commit verification proof linked to the **exact approved photo ID and SHA-256**. Do not expose raw confidence, face vectors or AWS reference image to the mobile client. Reply with `{status, badge, verifiedAt}` or safe retry instructions, not raw scores.
11. Failed/incomplete/expired attempts remain non-verified. A recovery job may reconcile attempts promptly but must never infer a pass from client evidence or retry calls after AWS results expire. User can retry via a **new session**, with abuse throttling.
12. Changing or deleting the approved reference photo makes the **photo verification badge invalid**, unless a defined re-verification flow approves the new photo. Do not revoke unrelated university or email verification states.

**Timing:** AWS states the `SessionId` expires three minutes after being sent, and session data becomes unavailable. Create the AWS session only when the camera flow is ready. Invoke `GetFaceLivenessSessionResults` immediately following native completion; never put this lookup behind a long asynchronous queue. Enforce a safety margin when showing `expiresAt`; failures require a new session.

### 3. Robust state machine

```text
CREATING → CREATED → IN_PROGRESS → PROCESSING
  ├── VERIFIED       (valid liveness + face match + policy)
  ├── REVIEW_REQUIRED (ambiguous/quality needs manual review)
  ├── FAILED         (valid completed session but insufficient proof)
  └── EXPIRED        (session or result no longer available)

VERIFIED → REVOKED   (user request, badge policy change, verified photo changed,
                      confirmed abuse, moderation/admin review)
```

A terminal result may only be created once. An **idempotent** retry of `complete` on the same valid attempt returns the saved terminal decision rather than performing another comparison. Transition with SQL `UPDATE ... WHERE state IN (...) RETURNING id` or row locks. Never hold an SQL transaction open during an external AWS network call. Use bounded processing, retry classification and crash recovery. Session IDs may be seen by the client: ownership is guaranteed by the backend's DB binding, not by secrecy of Session ID.

### 4. SQL starting schema (refine to match the actual repository)

```sql
CREATE TYPE face_attempt_state AS ENUM (
  'CREATING', 'CREATED', 'IN_PROGRESS', 'PROCESSING',
  'VERIFIED', 'REVIEW_REQUIRED', 'FAILED', 'EXPIRED', 'REVOKED'
);

CREATE TABLE face_verification_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  aws_session_id TEXT UNIQUE,
  aws_region TEXT NOT NULL,
  reference_media_id UUID NOT NULL, -- FK to project's existing media table
  reference_sha256 TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  state face_attempt_state NOT NULL DEFAULT 'CREATING',
  failure_code TEXT,                 -- code only; no raw images
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  CHECK (finished_at IS NULL OR finished_at >= created_at)
);
CREATE INDEX face_attempts_user_recent
  ON face_verification_attempts(user_id, created_at DESC);
CREATE INDEX face_attempts_state_expiry
  ON face_verification_attempts(state, expires_at);

CREATE TABLE user_photo_verifications (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  latest_attempt_id UUID REFERENCES face_verification_attempts(id),
  verified_media_id UUID,
  verified_media_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN
    ('UNVERIFIED','VERIFIED','REVIEW_REQUIRED','REVOKED')),
  policy_version TEXT,
  verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE identity_verification_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  attempt_id UUID REFERENCES face_verification_attempts(id),
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  policy_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Schema is a **starter**, not a drop-in migration: confirm existing users/media IDs, RLS/permissions, migration conventions, exact retention policy, and consistency triggers. Do not duplicate sensitive user profile fields or log raw biometric results. Restrict admin read access; never expose these tables directly to clients. Consider encrypting especially sensitive metadata/secret fields and minimizing exact scores. Define a separate short-retention, tightly controlled risk review record only if necessary.

### 5. API contract

| Endpoint | Auth | Expected behavior |
|---|---|---|
| `GET /v1/identity/photo-verification` | JWT | Return status and badge only |
| `POST /v1/identity/photo-verifications` | JWT + explicit consent | Enforce throttling; create AWS liveness session and owned attempt |
| `POST /v1/identity/photo-verifications/{id}/complete` | JWT | Fetch AWS results; compare immutable photo; persist authoritative decision |
| `GET /v1/identity/photo-verifications/{id}` | JWT | Fetch status of owned attempt only |
| `POST /v1/identity/photo-verifications/{id}/appeal` | JWT | Manual review path without raw scores |
| `DELETE /v1/identity/photo-verification` | JWT + reauth if necessary | Revoke badge and initiate data deletion under policy |
| `POST /v1/admin/identity-reviews/{id}/decision` | Strong admin auth | Audited review with least privilege and dual control where needed |

Example public response (no raw confidence):

```json
{
  "verificationId": "uuid",
  "status": "VERIFIED",
  "badge": "PHOTO_VERIFIED",
  "verifiedAt": "2026-10-12T03:45:00+07:00"
}
```

Errors are safe codes: `SESSION_EXPIRED`, `CAMERA_UNAVAILABLE`, `LOW_LIGHT`, `FACE_NOT_ALIGNED`, `RATE_LIMITED`, `REVIEW_REQUIRED`, `IMAGE_CHANGED`, `AWAITING_RESULT`. Do not reveal score cutoffs, raw face similarity or detailed fraud detection methods.

### 6. Expo SDK 58 integration (mandatory compatibility spike)

**Official AWS detector integrations currently documented:**
- iOS: `amplify-ui-swift-liveness` (SwiftUI component).
- Android: `com.amplifyframework.ui:liveness` (Jetpack Compose component).
- React web: `@aws-amplify/ui-react-liveness` (DOM-based; not a React Native component).

Preferred production path: **build or adapt an Expo native module** that presents the AWS-maintained SwiftUI/Compose components. Configure native cameras and AWS temporary credentials via approved plugins; bridge event completion/errors to TypeScript. Install/build with Expo Development Build/EAS; **Expo Go is not sufficient** for custom native code. Verify exact React Native/Expo 58, Gradle, Kotlin/Compose, Xcode, Swift and AWS SDK compatibility in CI with real test devices. Community package `expo-face-liveness-for-aws-amplify` documents tests on Expo 54/55, **not Expo 58**; treat as candidate for review/porting, not assumed compatible or officially supported. Do not implement custom camera-based liveness ML as a quick substitute.

Native bridge surface example (interface only, **not** a functioning library):

```ts
export interface FaceLivenessNativeBridge {
  present(options: {
    sessionId: string;
    region: string;
  }): Promise<{ streamCompleted: boolean }>;
}
```

The bridge result triggers only the Rust `complete` call. The bridge must securely obtain AWS streaming authorization using the selected identity approach; do not expose AWS long-lived credentials in JavaScript, embedded app files or logs. Ensure camera permissions, photosensitivity information, localization, screen readers, cancellation and network recovery. Test on **physical iPhones and Android devices**.

### 7. Threshold, quality, fairness and fallback policy

Use independently configurable server-side thresholds for liveness and similarity, with `policy_version`; **no hard-coded 80/90/95 threshold presented as universally safe**. CompareFaces defaults to a response filter of 80% if none is supplied, but that is **not** an endorsement of 80% for verifying a person. Calibrate FAR/FRR with consented, representative same-person and different-person samples, varied lighting, devices, poses, skin tones and accessibility contexts. Test drift after AWS SDK/model changes. Use human review in ambiguous/high-impact cases and do not lock the person out of the core social app solely because a face check fails. Provide retry instructions driven by AWS feedback codes.

For default challenge, prefer AWS `FaceMovementAndLightChallenge` where suitable; AWS says it maximizes accuracy compared with movement-only. Offer a non-flashing/alternative route for photosensitive users, as recommended by AWS. Consent must be informed and optional for nonessential verification; clear alternatives must exist.

### 8. Abuse, security and cost controls

- Limit parallel attempts: 1 active session/user, per-user/device/IP throttling, idempotency key, and expiry cleanup. AWS recommends no more than 5 failed attempts/3 min/device, then 30–60 min cooldown; consider accessibility-sensitive appeal.
- Credential security: client may only stream with short-lived, narrowly scoped AWS credentials. Server handles Create/Get/Compare; use IAM role/assume-role where possible; never `AmazonRekognitionFullAccess` in production or `AmazonS3FullAccess` on mobile.
- Verify backend JWT server-side every time. Ensure `verification_attempts.user_id == auth.sub mapping`. Treat `sessionId`, mediaId, region and callback payloads as untrusted.
- AWS liveness status check MUST be `SUCCEEDED`; result availability/size and face reference are required. Reject results for the wrong user or photo revision, or terminal/revoked session.
- Store photos in R2 only according to consent and data policy, **private** when biometric reference; per-object unique keys, read only through backend, pinned digest and no mutable overwrites. For `CompareFaces`, send bytes from backend (up to 5 MB input limit) or use Amazon S3 if explicitly provisioned. R2 S3-compatible API does not make R2 an AWS Amazon S3 storage source.
- No client score disclosure, no face images in crash/error reporting, never log signed S3/R2 URLs. Set AWS CloudTrail/audit where appropriate, and check AWS Organizations AI services opt-out for model improvement if your privacy policy requires it.
- Keep `AuditImagesLimit=0` by default; add review images only on a documented, justified need with narrow access and a fixed deletion deadline. Prefer AWS returned bytes for immediate processing rather than permanent S3 copies. AWS session transient nature does not absolve your application of retention policy.
- Callers must see camera, biometric analysis and cross-cloud transfer purposes in privacy notice. Thailand PDPA and policies for minor users must be reviewed with legal counsel before production.
- AWS charges per liveness check and separately for applicable CompareFaces operations. Alert on attempts/day, checks/user, retry amplification and anomalies; AWS budgets and service limits prevent abuse-induced bill spikes.

### 9. Threat model / adversarial QA

| Attack or fault | Required result |
|---|---|
| JS patch sends `{ verified: true }` | Rejected; server ignores value |
| User A submits User B's verification ID or AWS Session ID | Denied by ownership checks |
| Session reused | Denied / idempotent saved result; new scan requires new session |
| Session older than 3 min | New session required; no verified badge |
| Liveness failed but similarity high | Not verified |
| Liveness high but face similarity low | Not verified |
| AWS reference image absent / incomplete | Retry or review, never verified |
| Uploaded profile image swapped after pass | Photo badge revoked until re-verification |
| Another user changes R2 object or URL | Denied; immutable pinned object key/hash |
| App disconnects after video stream | Safe status recovery; no client-side assumption |
| Rust crashes after AWS check / before DB commit | Safe retry with idempotency, never silent success |
| Two calls to complete race | Exactly one processing/terminal decision |
| Brightness/glasses/head coverings/photo sensitivity | Guidance, review or alternative verification |
| Admin tries to see every selfie | Unauthorized; least privilege, short retention, audited access |
| Credential extraction / rooted device | Temporary scoped credentials + rate controls; no permanent cloud privileges |
| Huge malicious photo / forged MIME type | Server bounds, actual image decoding, safe transcoding before AWS |

### 10. Measurable S-tier acceptance criteria

- **Zero** client-controlled promotion to `PHOTO_VERIFIED`.
- **Zero** face image / biometric result disclosures through public R2 objects, analytics events, logs or client responses.
- **100%** terminal approvals have authenticated user, unique AWS session, verified result, pinned image hash and policy version (validated by automated tests).
- 100% of expired/replayed/wrong-owner sessions remain unverified.
- Completion is idempotent; errors and timeouts preserve non-verified state.
- Mobile accessibility fallback available for photosensitivity and compatible devices unable to perform the scan.
- Measure p50/p95/p99 verification completion from camera start and break down AWS stream, GetResults, R2 GET, CompareFaces, SQL. **Do not promise fixed seconds before device + region benchmark**.
- Privacy consent audit, retention/deletion test, AI opt-out review, and appeal/false rejection tests passed.
- Android and iOS release builds pass hardware integration tests; Expo 58 compat verified in CI.
- Region and cost choices validated using production-like traffic and AWS quota/budget alerts.

### 11. Implementation plan / Claude execution order

**Phase 0 — Audit only (no behavior change)**
1. Map existing Expo version, React Native native module setup, AWS Rekognition calls, secrets, Cloudflare R2 bindings, media schema and current badge logic.
2. Identify server-only vs client-side checks. Search for client `verified` write paths, public R2 URLs, unsafe AWS credentials, check for logs of biometrics.
3. Document AWS region and IAM permissions. Inventory current legal consent and retention settings.

**Phase 1 — Backend hardening**
1. Add attempts + user verification states and indexes through incremental SQLx migrations.
2. Implement Create/Get result, server decision, session-ownership guard, idempotency and bounded recovery.
3. Implement R2 immutable photo snapshot + AWS CompareFaces Bytes; deny mutable profile photos without revocation.
4. Add rate limiting, audit, safe error taxonomy and configurable calibration thresholds.

**Phase 2 — Native integration**
1. Verify actual Expo 58 native build on iOS 26/27 and Android.
2. Integrate AWS-maintained iOS/Android native liveness via Expo Modules API or a carefully audited wrapper.
3. Ensure AWS streaming authorization is short-lived and least-privileged. Add consent, permissions, liveness instructions, photosensitivity fallback.
4. Validate end-to-end capture on physical devices and handle app background/network interruption.

**Phase 3 — Privacy and production readiness**
1. Threat-model review, dynamic pen-test, replay/race tests, audit trail review.
2. Tune thresholds on representative authorized test samples; monitor false accept/reject rates and changes.
3. Deletion/retention, admin review, AWS opt-out policy and budget alerts.
4. Stage rollout behind a feature flag; measure complete workflow before enabling public badges.

**Definition of done:** Tests and artifacts demonstrate the controls above. Do not claim the system is S-Tier just because dependencies are installed. Do not deploy production or mutate real user biometric records without explicit authorization.

### 12. Copy/paste task brief for Claude

> Use this file as the implementation specification for CampusMate Amazon Rekognition Face Liveness + CompareFaces verification. Audit the existing repository first; retain React Native / Expo 58, Rust / Axum / Tokio / SQLx, Neon and Cloudflare R2. Do not replace existing authentication or media flows without proof of need. Implement the secure session lifecycle, backend decision, R2 immutable reference comparison, verification status model, privacy consent, scoped AWS streaming authorization, native SwiftUI/Jetpack Compose bridge and tests in phases. Verify Expo 58 SDK/ABI compatibility instead of assuming third-party wrappers work. Require server-side AWS outcomes and prevent replay, image swaps, cross-account requests and client-controlled badges. Provide each phase's changed files, DB migrations, commands, test evidence, unresolved risks and rollback plan. Never expose credentials or production biometric media. Stop before production deployment.

### 13. Official sources checked (2026-10-12)

- Face Liveness architecture / Session expiry (3 min): https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-diagrams.html
- Face Liveness create and results API: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CreateFaceLivenessSession.html and https://docs.aws.amazon.com/rekognition/latest/APIReference/API_GetFaceLivenessSessionResults.html
- AWS face-liveness shared responsibility: https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-shared-responsibility-model.html
- AWS usage recommendations and client scores: https://docs.aws.amazon.com/rekognition/latest/dg/recommendations-liveness.html
- Rekognition CompareFaces behavior and image input: https://docs.aws.amazon.com/rekognition/latest/APIReference/API_CompareFaces.html
- Face Liveness supported regions (includes Thailand): https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness-faq.html
- Amazon Rekognition endpoints: https://docs.aws.amazon.com/general/latest/gr/rekognition.html
- AWS SwiftUI detector: https://ui.docs.amplify.aws/swift/connected-components/liveness
- AWS Android detector: https://ui.docs.amplify.aws/android/connected-components/liveness
- Expo native code / development builds: https://docs.expo.dev/workflow/customizing/
- Community Expo wrapper (currently documented tests on Expo 54/55): https://github.com/olawalethefirst/expo-face-liveness-for-aws-amplify
- AWS AI services opt-out: https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_ai-opt-out.html
- Face matching responsible AI: https://docs.aws.amazon.com/ai/responsible-ai/rekognition-face-matching/overview.html

