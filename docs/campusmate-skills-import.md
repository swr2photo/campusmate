# CampusMate skills and specification import

Imported on 2026-10-12 from the two user-supplied ZIP archives. This change adds project-local skills and reference documents only.

## Installed skills

| Skill | Claude | Codex |
| --- | --- | --- |
| iOS 26–27 / Expo 58 | [SKILL.md](../.claude/skills/campusmate-ios26-27-expo58/SKILL.md) | [SKILL.md](../.agents/skills/campusmate-ios26-27-expo58/SKILL.md) |
| Android Material 3 / Expo 58 | [SKILL.md](../.claude/skills/campusmate-android-material3-expo58/SKILL.md) | [SKILL.md](../.agents/skills/campusmate-android-material3-expo58/SKILL.md) |
| Face verification / Rekognition | [SKILL.md](../.claude/skills/campusmate-face-verification-rekognition/SKILL.md) | [SKILL.md](../.agents/skills/campusmate-face-verification-rekognition/SKILL.md) |

Each installation includes its reference directory and sibling skills so relative references resolve in both locations. The imported skills are available to Codex on the next turn after skill discovery refreshes.

## Specifications

- [Full system specification](CampusMate_S_Tier_Full_System_Spec.md)
- [Face verification blueprint](CampusMate_S_Tier_Face_Verification.md)
- [Combined platform and identity guidance](skills_ios_android_identity.md)

## Source selection and provenance

The Complete bundle contains all eight platform reference files unchanged. Its iOS and Android skill files include the original platform guidance plus a face-verification companion section. It also adds the face-verification skill and three documents, so it supplies the installed content without duplicate skill names.

- [Original Complete bundle README](campusmate-skill-bundle/README.md)
- [Original platform bundle README](campusmate-skill-bundle/platform-skills-README.md)
- [Archive and imported-file SHA-256 manifest](campusmate-skill-bundle/import-manifest.json)

Imported files are preserved byte for byte. The repository's root README, AGENTS.md, CLAUDE.md, application source, dependencies, and existing skills were not modified by this import.

## Scope and interpretation

The attached documents contain instructions for future implementation tasks. Importing them does not authorize executing their embedded commands, redesigning screens, migrating authentication or databases, provisioning AWS resources, deploying services, or processing biometric data.

Treat architectural statements and dated platform/version claims in the bundle as supplied specifications, not evidence of the current repository or a verified runtime. When a future task applies a skill, inspect the actual code and installed packages, check current official documentation, and follow the user's request and applicable project instructions. These imported references do not replace the existing AWS project rules.

Validation for this import checks file integrity, skill metadata, and local reference paths. It does not establish application, native-device, or service behavior.
