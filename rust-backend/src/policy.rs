//! Ports of functions/plusEntitlements.js and functions/profileVisibilityPolicy.js.
//! Keep these in lockstep with the Node versions: they decide who may be shown.

use serde_json::Value;

use crate::value::is_safe_integer;

pub const PLUS_ENTITLEMENT: &str = "campusmate_plus";
const PLUS_FEATURES: [&str; 5] = [
    "noAds",
    "advancedFilters",
    "incomingLikeProfiles",
    "unlimitedRewind",
    "incognito",
];

fn is_admin(record: &Value) -> bool {
    record.get("isAdmin") == Some(&Value::Bool(true))
        || record.get("isSuperAdmin") == Some(&Value::Bool(true))
        || record.get("role").and_then(Value::as_str) == Some("admin")
        || record.get("isPlus") == Some(&Value::Bool(true))
}

pub fn is_plus_active(record: Option<&Value>, now_ms: i64) -> bool {
    let Some(record) = record else { return false };
    if is_admin(record) {
        return true;
    }
    record.get("source").and_then(Value::as_str) == Some("revenuecat")
        && record.get("entitlementId").and_then(Value::as_str) == Some(PLUS_ENTITLEMENT)
        && is_safe_integer(record.get("activeUntil")).is_some_and(|until| until > now_ms)
        && is_safe_integer(record.get("verifiedAt")).is_some_and(|at| at > 0)
}

/// Free plan unlocks nothing; unknown features never unlock.
pub fn has_plan_feature(record: Option<&Value>, feature: &str, now_ms: i64) -> bool {
    if record.is_some_and(is_admin) {
        return true;
    }
    is_plus_active(record, now_ms) && PLUS_FEATURES.contains(&feature)
}

pub struct ViewCheck<'a> {
    pub owner_exists: bool,
    pub owner_discoverable: bool,
    pub owner_is_new: bool,
    pub owner_face_verified: bool,
    pub blocked: bool,
    pub matched: bool,
    pub owner_liked_viewer: bool,
    /// `None` when there is no profileVisibility document (treated as public).
    pub visibility_mode: Option<&'a str>,
    pub owner_entitlement: Option<&'a Value>,
    pub now_ms: i64,
}

pub fn can_view_profile(viewer_id: &str, owner_id: &str, check: &ViewCheck) -> bool {
    if viewer_id.is_empty() || owner_id.is_empty() || !check.owner_exists {
        return false;
    }
    if viewer_id == owner_id {
        return true;
    }
    if check.blocked || !check.owner_face_verified {
        return false;
    }
    if check.matched {
        return true;
    }
    if (!check.owner_discoverable || check.owner_is_new) && !check.owner_liked_viewer {
        return false;
    }
    match check.visibility_mode.unwrap_or("public") {
        // An expired incognito member stays private until explicitly choosing public.
        "incognito" => {
            has_plan_feature(check.owner_entitlement, "incognito", check.now_ms)
                && check.owner_liked_viewer
        }
        "public" => true,
        _ => false, // unknown/corrupt modes fail closed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const NOW: i64 = 1_800_000_000_000;

    fn base() -> ViewCheck<'static> {
        ViewCheck {
            owner_exists: true,
            owner_discoverable: true,
            owner_is_new: false,
            owner_face_verified: true,
            blocked: false,
            matched: false,
            owner_liked_viewer: false,
            visibility_mode: None,
            owner_entitlement: None,
            now_ms: NOW,
        }
    }

    #[test]
    fn plus_requires_verified_revenuecat_record() {
        let active = json!({ "source": "revenuecat", "entitlementId": PLUS_ENTITLEMENT, "activeUntil": NOW + 1, "verifiedAt": 1 });
        assert!(has_plan_feature(Some(&active), "incognito", NOW));
        assert!(!has_plan_feature(Some(&active), "unknownFeature", NOW));
        let expired = json!({ "source": "revenuecat", "entitlementId": PLUS_ENTITLEMENT, "activeUntil": NOW, "verifiedAt": 1 });
        assert!(!has_plan_feature(Some(&expired), "incognito", NOW));
        assert!(!has_plan_feature(None, "advancedFilters", NOW));
        assert!(has_plan_feature(
            Some(&json!({ "role": "admin" })),
            "anything",
            NOW
        ));
    }

    #[test]
    fn visibility_fails_closed() {
        assert!(can_view_profile("a", "b", &base()));
        assert!(!can_view_profile(
            "a",
            "b",
            &ViewCheck {
                owner_face_verified: false,
                ..base()
            }
        ));
        assert!(!can_view_profile(
            "a",
            "b",
            &ViewCheck {
                blocked: true,
                matched: true,
                ..base()
            }
        ));
        assert!(!can_view_profile(
            "a",
            "b",
            &ViewCheck {
                visibility_mode: Some("invalid"),
                ..base()
            }
        ));
        assert!(!can_view_profile(
            "a",
            "b",
            &ViewCheck {
                visibility_mode: Some("incognito"),
                owner_liked_viewer: true,
                ..base()
            }
        ));
        let plus = json!({ "source": "revenuecat", "entitlementId": PLUS_ENTITLEMENT, "activeUntil": NOW + 1, "verifiedAt": 1 });
        assert!(can_view_profile(
            "a",
            "b",
            &ViewCheck {
                visibility_mode: Some("incognito"),
                owner_liked_viewer: true,
                owner_entitlement: Some(&plus),
                ..base()
            }
        ));
        assert!(can_view_profile(
            "a",
            "b",
            &ViewCheck {
                matched: true,
                owner_discoverable: false,
                ..base()
            }
        ));
    }
}
