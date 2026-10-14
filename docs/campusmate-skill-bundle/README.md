# CampusMate — Full System + iOS / Android / Face Verification Claude Skills

Version 2.0 | 2026-10-12

Extract this ZIP at **repository root**, retaining `.claude/` and `docs/`. It adds **three skills** and engineering specs:

1. `.claude/skills/campusmate-ios26-27-expo58/SKILL.md` — Apple HIG, iOS 26–27.
2. `.claude/skills/campusmate-android-material3-expo58/SKILL.md` — Google Material 3/Android.
3. `.claude/skills/campusmate-face-verification-rekognition/SKILL.md` — existing AWS Face Liveness + CompareFaces, Rust/Neon/R2 hardening.

Specs:
- `docs/CampusMate_S_Tier_Full_System_Spec.md` — full backend/product implementation brief, now includes **Chapter 23** containing the complete face verification blueprint.
- `docs/CampusMate_S_Tier_Face_Verification.md` — standalone identity verification blueprint and threat model.
- `docs/skills_ios_android_identity.md` — consolidated iOS + Android design skills and face-verification extension.

**Claude entry instruction**: Audit actual repository, read `docs/CampusMate_S_Tier_Full_System_Spec.md` and the relevant SKILL.md; do not rewrite existing React Native/R2/auth/Rekognition setup unless demonstrably necessary. Secure results/badges only on Rust Backend. Verify Expo SDK58 and native AWS liveness compatibility using real native builds, then implement in phases with tests. Never deploy production or touch real biometric data without approval.

This bundle is an implementation target, not a claim the current repository has been audited or validated.
