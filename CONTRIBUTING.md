# CampusMate team workflow

โปรเจกต์นี้แบ่งงานเป็น 4 feature branches และใช้ `develop` เป็น branch รวมงานก่อนปล่อยจริง

## Branch ownership

| สมาชิก | Branch | ขอบเขตหลัก |
|---|---|---|
| 1 | `feature/auth-firebase` | Google Sign-In, Firebase Auth, env config และ login flow |
| 2 | `feature/matching-profile` | โปรไฟล์, activity cards, matching algorithm และ filters |
| 3 | `feature/chat` | ห้องแชต, Firestore realtime messages และ unread state |
| 4 | `feature/meetup` | จุดนัดหมาย, campus spots, map/pin และ schedule |

## กติกาไฟล์ร่วม

`App.js`, `src/context/AppContext.js`, `package.json`, `pnpm-lock.yaml` และ `README.md` เป็นไฟล์ร่วม ให้แจ้งทีมก่อนแก้ไขและรวมผ่าน Pull Request เพื่อลด merge conflict

## Workflow

```powershell
git fetch origin
git switch develop
git pull --ff-only origin develop
git switch -c feature/<your-feature>
pnpm start
```

ก่อนส่งงานให้ตรวจด้วย:

```powershell
pnpm exec expo export --platform web
git status
git add <เฉพาะไฟล์ที่เกี่ยวข้อง>
git commit -m "feat: <สรุปงานสั้น ๆ>"
git push -u origin feature/<your-feature>
```

เปิด Pull Request จาก `feature/<your-feature>` เข้า `develop` เท่านั้น ส่วน `main` ใช้สำหรับเวอร์ชันที่ทดสอบรวมแล้ว

