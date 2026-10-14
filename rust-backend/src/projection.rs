//! Bounded profile projection built from the authoritative private record.
//!
//! The matching input uses the same privacy projection as the response. A
//! hidden attribute cannot affect a score, explanation or selective filter.

use std::collections::HashSet;

use chrono::NaiveDate;
use serde_json::{Map, Number, Value};

use crate::model::UserRecord;

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn text(value: Option<&Value>, limit: usize) -> Option<String> {
    let value = value?.as_str()?.trim();
    if value.is_empty() {
        return None;
    }
    Some(value.chars().take(limit).collect())
}

fn copy_text(out: &mut Map<String, Value>, raw: &Map<String, Value>, key: &str, limit: usize) {
    if let Some(value) = text(raw.get(key), limit) {
        out.insert(key.into(), Value::String(value));
    }
}

fn first_text(raw: &Map<String, Value>, keys: &[&str], limit: usize) -> Option<String> {
    keys.iter().find_map(|key| text(raw.get(*key), limit))
}

fn visible(raw: &Map<String, Value>, field: &str) -> bool {
    raw.get("privacy")
        .and_then(Value::as_object)
        .and_then(|privacy| privacy.get(field))
        != Some(&Value::Bool(false))
}

fn string_list(value: Option<&Value>, max_items: usize, max_chars: usize) -> Vec<Value> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut seen = HashSet::new();
    items
        .iter()
        .filter_map(|item| text(Some(item), max_chars))
        .filter(|item| seen.insert(item.clone()))
        .take(max_items)
        .map(Value::String)
        .collect()
}

fn copy_list(out: &mut Map<String, Value>, raw: &Map<String, Value>, key: &str, max_items: usize) {
    let items = string_list(raw.get(key), max_items, 100);
    if !items.is_empty() {
        out.insert(key.into(), Value::Array(items));
    }
}

fn safe_uint(value: Option<&Value>) -> Option<u64> {
    let value = value?.as_u64()?;
    (value <= MAX_SAFE_INTEGER).then_some(value)
}

fn number(value: Option<&Value>, minimum: f64, maximum: f64) -> Option<Value> {
    let value = value?.as_f64()?;
    (value.is_finite() && (minimum..=maximum).contains(&value))
        .then(|| Number::from_f64(value).map(Value::Number))
        .flatten()
}

fn valid_key(value: &str, activity: bool) -> bool {
    let mut bytes = value.bytes();
    let Some(first) = bytes.next() else {
        return false;
    };
    value.len() <= 50
        && if activity {
            first.is_ascii_lowercase()
        } else {
            first.is_ascii_alphabetic()
        }
        && bytes.all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        && !matches!(value, "__proto__" | "prototype" | "constructor")
}

/// Only absolute HTTPS links with a nonempty host and no credentials survive.
/// Links are rejected, never truncated into a different destination.
fn https_link(value: Option<&Value>, max_chars: usize) -> Option<String> {
    let value = value?.as_str()?.trim();
    if value.chars().count() > max_chars
        || value.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return None;
    }
    let prefix = value.get(..8)?;
    if !prefix.eq_ignore_ascii_case("https://") {
        return None;
    }
    let remainder = value.get(8..)?;
    let host = remainder.split(['/', '?', '#']).next()?;
    if host.is_empty() || host.contains('@') || host.contains('\\') {
        return None;
    }
    Some(value.to_owned())
}

// Mirrors the declared profile form in src/data/activityCategories.js. Unknown
// nested fields must not become a route for copying account metadata.
fn detail_is_list(activity: &str, field: &str) -> Option<bool> {
    match (activity, field) {
        ("running", "pace" | "distance")
        | ("gym", "level" | "goal")
        | ("sports", "level")
        | ("study", "style")
        | ("chill", "topics")
        | ("cycling", "bikeType" | "distance")
        | ("swimming", "level")
        | ("yoga", "level")
        | ("gaming", "games")
        | ("art", "level")
        | ("language", "goal")
        | ("food", "budget")
        | ("other", "note") => Some(false),
        ("running", "timeOfDay")
        | ("gym", "focus")
        | ("sports", "sports")
        | ("study", "subjects")
        | ("chill", "vibe")
        | ("swimming", "strokes")
        | ("yoga", "kind")
        | ("music", "role" | "genres")
        | ("gaming", "platform")
        | ("art", "kind")
        | ("language", "languages")
        | ("food", "kind")
        | ("volunteer", "kind") => Some(true),
        _ => None,
    }
}

fn activity_details(value: Option<&Value>) -> Option<Value> {
    let raw = value?.as_object()?;
    let mut activities = Map::new();
    for (activity, raw_fields) in raw.iter().take(30) {
        if !valid_key(activity, true) {
            continue;
        }
        let Some(raw_fields) = raw_fields.as_object() else {
            continue;
        };
        let mut fields = Map::new();
        for (key, value) in raw_fields.iter().take(6) {
            if !valid_key(key, false) {
                continue;
            }
            let Some(is_list) = detail_is_list(activity, key) else {
                continue;
            };
            if is_list {
                let items = string_list(Some(value), 10, 120);
                if !items.is_empty() {
                    fields.insert(key.clone(), Value::Array(items));
                }
            } else if let Some(value) = text(Some(value), 120) {
                fields.insert(key.clone(), Value::String(value));
            }
        }
        if !fields.is_empty() {
            activities.insert(activity.clone(), Value::Object(fields));
        }
    }
    (!activities.is_empty()).then_some(Value::Object(activities))
}

fn date(value: Option<&Value>) -> Option<String> {
    let value = value?.as_str()?;
    if value.len() != 10 {
        return None;
    }
    let parsed = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    (parsed.format("%Y-%m-%d").to_string() == value).then(|| value.to_owned())
}

fn clock(value: Option<&Value>) -> Option<(String, u32)> {
    let value = value?.as_str()?;
    let minutes = crate::model::minutes(Some(&Value::String(value.to_owned())))?;
    Some((format!("{:02}:{:02}", minutes / 60, minutes % 60), minutes))
}

fn availability_slots(value: Option<&Value>) -> Vec<Value> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut slots = Vec::new();
    let mut seen = HashSet::new();
    for item in items.iter().take(50) {
        let Some(raw) = item.as_object() else {
            continue;
        };
        let Some(day) = date(raw.get("date")) else {
            continue;
        };
        let (Some((start, a)), Some((end, b))) = (clock(raw.get("start")), clock(raw.get("end")))
        else {
            continue;
        };
        if b <= a || !seen.insert((day.clone(), start.clone(), end.clone())) {
            continue;
        }
        let mut slot = Map::new();
        slot.insert("date".into(), Value::String(day));
        slot.insert("start".into(), Value::String(start));
        slot.insert("end".into(), Value::String(end));
        if raw.get("recurring") == Some(&Value::Bool(true))
            || raw.get("repeat").and_then(Value::as_str) == Some("weekly")
        {
            slot.insert("recurring".into(), Value::Bool(true));
        }
        copy_text(&mut slot, raw, "label", 100);
        slots.push(Value::Object(slot));
    }
    slots
}

fn favorite_tracks(value: Option<&Value>) -> Vec<Value> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut tracks = Vec::new();
    let mut seen = HashSet::new();
    for item in items.iter().take(10) {
        let Some(raw) = item.as_object() else {
            continue;
        };
        let (Some(id), Some(name)) = (text(raw.get("id"), 64), text(raw.get("name"), 200)) else {
            continue;
        };
        if !seen.insert(id.clone()) {
            continue;
        }
        let mut track = Map::new();
        track.insert("id".into(), Value::String(id));
        track.insert("name".into(), Value::String(name));
        copy_text(&mut track, raw, "artists", 200);
        for (field, limit) in [
            ("albumArt", 2000),
            ("previewUrl", 2000),
            ("externalUrl", 500),
        ] {
            if let Some(link) = https_link(raw.get(field), limit) {
                track.insert(field.into(), Value::String(link));
            }
        }
        if let (Some(start), Some(end)) = (
            safe_uint(raw.get("previewStartMs")),
            safe_uint(raw.get("previewEndMs")),
        ) {
            if end > start {
                track.insert("previewStartMs".into(), start.into());
                track.insert("previewEndMs".into(), end.into());
            }
        }
        tracks.push(Value::Object(track));
    }
    tracks
}

fn meetup(value: Option<&Value>, allow_schedule: bool) -> Option<Value> {
    let raw = value?.as_object()?;
    let mut out = Map::new();
    for (field, limit) in [
        ("id", 128),
        ("name", 200),
        ("description", 500),
        ("category", 50),
        ("categoryLabel", 100),
        ("group", 150),
        ("emoji", 16),
        ("rating", 20),
        ("busyTime", 100),
        ("image", 500),
    ] {
        copy_text(&mut out, raw, field, limit);
    }
    if allow_schedule {
        copy_text(&mut out, raw, "scheduledAt", 100);
        if let Some(raw) = raw.get("schedule").and_then(Value::as_object) {
            let mut schedule = Map::new();
            if let Some(day) = date(raw.get("date")) {
                schedule.insert("date".into(), Value::String(day));
            }
            for field in ["startTime", "endTime"] {
                if let Some((time, _)) = clock(raw.get(field)) {
                    schedule.insert(field.into(), Value::String(time));
                }
            }
            copy_text(&mut schedule, raw, "message", 500);
            if let Some(count) =
                safe_uint(raw.get("maxPeople")).filter(|count| (1..=50).contains(count))
            {
                schedule.insert("maxPeople".into(), count.into());
            }
            if let Some(at) = safe_uint(raw.get("scheduledFor")) {
                schedule.insert("scheduledFor".into(), at.into());
            }
            if !schedule.is_empty() {
                out.insert("schedule".into(), Value::Object(schedule));
            }
        }
    }
    (!out.is_empty()).then_some(Value::Object(out))
}

fn profile_fields(raw: &Value) -> Map<String, Value> {
    let mut out = Map::new();
    let Some(raw) = raw.as_object() else {
        out.insert("isDiscoverable".into(), Value::Bool(false));
        out.insert("isFaceVerified".into(), Value::Bool(false));
        return out;
    };
    out.insert(
        "isDiscoverable".into(),
        Value::Bool(raw.get("isDiscoverable") != Some(&Value::Bool(false))),
    );
    out.insert(
        "isFaceVerified".into(),
        Value::Bool(raw.get("isFaceVerified") == Some(&Value::Bool(true))),
    );
    if let Some(name) = first_text(
        raw,
        &["name", "displayName", "nickname", "userName", "username"],
        100,
    ) {
        out.insert("name".into(), Value::String(name));
    }
    for (field, limit) in [
        ("nickname", 100),
        ("bio", 1000),
        ("avatar", 100),
        ("avatarColor", 50),
    ] {
        copy_text(&mut out, raw, field, limit);
    }
    let avatar = ["avatarUri", "photoURL", "photoUrl", "avatarUrl"]
        .iter()
        .find_map(|field| https_link(raw.get(*field), 5000))
        .or_else(|| {
            raw.get("photos")
                .and_then(Value::as_array)
                .and_then(|items| items.first())
                .and_then(|first| https_link(Some(first), 5000))
        });
    if let Some(avatar) = avatar {
        out.insert("avatarUri".into(), Value::String(avatar));
    }
    if let Some(revision) = safe_uint(raw.get("avatarRevision")) {
        out.insert("avatarRevision".into(), revision.into());
    }
    let mut seen = HashSet::new();
    let gallery: Vec<Value> = raw
        .get("gallery")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| https_link(Some(item), 5000))
        .filter(|link| seen.insert(link.clone()))
        .take(8)
        .map(Value::String)
        .collect();
    if !gallery.is_empty() {
        out.insert("gallery".into(), Value::Array(gallery));
    }
    let tracks = favorite_tracks(raw.get("favoriteTracks"));
    if !tracks.is_empty() {
        out.insert("favoriteTracks".into(), Value::Array(tracks));
    }
    if visible(raw, "showAge") {
        if let Some(age) = number(raw.get("age"), 18.0, 100.0) {
            out.insert("age".into(), age);
        }
    }
    if visible(raw, "showGender") {
        copy_text(&mut out, raw, "gender", 100);
    }
    if visible(raw, "showFaculty") {
        copy_text(&mut out, raw, "faculty", 100);
        copy_text(&mut out, raw, "year", 50);
    }
    if visible(raw, "showActivity") {
        for field in ["activity", "activityLabel", "skill", "pace"] {
            copy_text(&mut out, raw, field, 100);
        }
        copy_list(&mut out, raw, "activities", 30);
        copy_list(&mut out, raw, "tags", 50);
        copy_list(&mut out, raw, "interests", 50);
        let mut details = activity_details(raw.get("activityDetails"))
            .and_then(|value| value.as_object().cloned())
            .unwrap_or_default();
        let runs = out.get("activity").and_then(Value::as_str) == Some("running")
            || out
                .get("activities")
                .and_then(Value::as_array)
                .is_some_and(|items| items.iter().any(|item| item.as_str() == Some("running")));
        if runs && out.contains_key("pace") {
            let running = details
                .entry("running")
                .or_insert_with(|| Value::Object(Map::new()));
            if let Some(running) = running.as_object_mut() {
                if let Some(pace) = out.get("pace") {
                    running.entry("pace").or_insert_with(|| pace.clone());
                }
            }
        }
        if !out.contains_key("pace") {
            if let Some(pace) = details
                .get("running")
                .and_then(|entry| entry.get("pace"))
                .and_then(Value::as_str)
            {
                out.insert("pace".into(), Value::String(pace.to_owned()));
            }
        }
        if !details.is_empty() {
            out.insert("activityDetails".into(), Value::Object(details));
        }
    }
    if visible(raw, "showAvailability") {
        copy_text(&mut out, raw, "availability", 100);
        let slots = availability_slots(raw.get("availabilitySlots"));
        if !slots.is_empty() {
            out.insert("availabilitySlots".into(), Value::Array(slots));
        }
    }
    if visible(raw, "showLocation") && raw.get("locationEnabled") != Some(&Value::Bool(false)) {
        if let Some(meetup) = meetup(raw.get("meetup"), visible(raw, "showAvailability")) {
            out.insert("meetup".into(), meetup);
        }
    }
    if let Some(updated_at) = safe_uint(raw.get("updatedAt")) {
        out.insert("updatedAt".into(), updated_at.into());
    }
    out
}

/// Public response; contains neither account data nor exact coordinates or keys.
pub fn discovery_profile(uid: &str, raw: &Value) -> Value {
    let mut fields = profile_fields(raw);
    if !uid.is_empty() && uid.chars().count() <= 128 && !uid.chars().any(char::is_control) {
        fields.insert("id".into(), Value::String(uid.to_owned()));
    } else {
        fields.insert("isDiscoverable".into(), Value::Bool(false));
    }
    Value::Object(fields)
}

/// Private matching input; only shared, valid GPS is retained for distance.
pub fn visible_match_record(raw: &Value) -> UserRecord {
    let mut fields = profile_fields(raw);
    let source = raw.as_object();
    fields.insert(
        "isNewUser".into(),
        Value::Bool(source.and_then(|map| map.get("isNewUser")) == Some(&Value::Bool(true))),
    );
    let share_location = source.is_some_and(|raw| {
        visible(raw, "showLocation") && raw.get("locationEnabled") != Some(&Value::Bool(false))
    });
    fields.insert("locationEnabled".into(), Value::Bool(share_location));
    if share_location {
        if let Some(raw) = source {
            if let (Some(lat), Some(lon)) = (
                number(raw.get("latitude"), -90.0, 90.0),
                number(raw.get("longitude"), -180.0, 180.0),
            ) {
                fields.insert("latitude".into(), lat);
                fields.insert("longitude".into(), lon);
            }
        }
    }
    UserRecord::from_fields(fields)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn allowlist_never_copies_account_secrets_nested_keys_or_exact_gps() {
        let raw = json!({"name":" Person ","isFaceVerified":true,"email":"private@example.test","campusEmail":"secret@psu.ac.th",
            "password":"secret","passwordHash":"hash","refreshToken":"token","role":"admin","isAdmin":true,
            "encryptionDevices":{"device":{"publicKey":"private-projection-key"}},"faceMatchScore":99,"latitude":7.0,"longitude":100.0,
            "avatarUri":"https://cdn.example.test/avatar.jpg","gallery":["javascript:alert(1)","https://user:secret@example.test/one","https://cdn.example.test/one"],
            "activityDetails":{"running":{"pace":"easy","secret":{"token":"secret"},"email":"secret@example.test","constructor":"invalid"}},
            "meetup":{"name":"Campus","latitude":7.0,"longitude":100.0,"email":"secret@example.test"},"updatedAt":123});
        let profile = discovery_profile("u1", &raw);
        assert_eq!(profile["name"], "Person");
        assert_eq!(profile["gallery"].as_array().map(Vec::len), Some(1));
        let encoded = profile.to_string();
        for forbidden in [
            "email",
            "password",
            "refreshToken",
            "role",
            "isAdmin",
            "encryptionDevices",
            "faceMatchScore",
            "latitude",
            "longitude",
            "secret",
            "constructor",
        ] {
            assert!(
                !encoded.contains(forbidden),
                "copied forbidden value: {forbidden}"
            );
        }
    }

    #[test]
    fn all_privacy_combinations_remove_corresponding_matching_inputs() {
        for mask in 0..64 {
            let mut raw = json!({"age":20,"gender":"woman","faculty":"science","year":"2","activity":"running","activities":["running"],
                "tags":["running"],"interests":["running"],"pace":"easy","activityDetails":{"running":{"pace":"easy"}},
                "availability":"เย็น","availabilitySlots":[{"date":"2026-10-12","start":"18:00","end":"20:00"}],
                "latitude":7.0,"longitude":100.0,"meetup":{"name":"Campus"},"privacy":{}});
            for (index, field) in [
                "showAge",
                "showGender",
                "showFaculty",
                "showActivity",
                "showAvailability",
                "showLocation",
            ]
            .iter()
            .enumerate()
            {
                raw["privacy"][*field] = Value::Bool(mask & (1 << index) != 0);
            }
            let profile = discovery_profile("u", &raw);
            let matching = visible_match_record(&raw);
            for (index, keys) in [
                vec!["age"],
                vec!["gender"],
                vec!["faculty", "year"],
                vec![
                    "activity",
                    "activities",
                    "pace",
                    "activityDetails",
                    "interests",
                    "tags",
                ],
                vec!["availability", "availabilitySlots"],
                vec!["meetup", "latitude", "longitude"],
            ]
            .iter()
            .enumerate()
            {
                if mask & (1 << index) == 0 {
                    for key in keys {
                        assert!(profile.get(*key).is_none(), "response exposes hidden {key}");
                        assert!(
                            matching.raw.get(*key).is_none(),
                            "matching reads hidden {key}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn hidden_attribute_changes_never_change_score_or_explanations() {
        let viewer = visible_match_record(
            &json!({"age":20,"activity":"running","activities":["running"],"faculty":"science","year":"2","latitude":7.0,"longitude":100.0,
            "availabilitySlots":[{"date":"2026-10-12","start":"18:00","end":"20:00"}],"activityDetails":{"running":{"pace":"easy"}}}),
        );
        let base = json!({"name":"Person","isFaceVerified":true,"updatedAt":123,"privacy":{"showAge":false,"showGender":false,"showFaculty":false,
            "showActivity":false,"showAvailability":false,"showLocation":false}});
        let ctx = crate::score::Context {
            today: "2026-10-12",
            now_ms: 123,
        };
        let original = visible_match_record(&base);
        let original_score = crate::score::score(
            &ctx,
            &viewer,
            &original,
            crate::distance::visible_distance_km(&viewer, &original),
        );
        for age in [18, 20, 50, 100] {
            for activity in ["running", "gaming", "study"] {
                let mut changed = base.clone();
                changed.as_object_mut().unwrap().extend(json!({"age":age,"gender":"hidden","activity":activity,"activities":[activity],"interests":[activity],"tags":[activity],
                    "faculty":"science","year":"2","pace":"easy","activityDetails":{"running":{"pace":"easy"}},"availability":"เย็น",
                    "availabilitySlots":[{"date":"2026-10-12","start":"18:00","end":"20:00"}],"latitude":7.0,"longitude":100.0,
                    "email":"secret@example.test","encryptionDevices":{"key":"secret"}}).as_object().unwrap().clone());
                assert_eq!(
                    discovery_profile("u", &changed),
                    discovery_profile("u", &base)
                );
                let candidate = visible_match_record(&changed);
                assert_eq!(
                    crate::score::score(
                        &ctx,
                        &viewer,
                        &candidate,
                        crate::distance::visible_distance_km(&viewer, &candidate)
                    ),
                    original_score
                );
            }
        }
    }

    #[test]
    fn limits_preserve_unicode_and_malformed_values_are_ignored() {
        let raw = json!({"name":"ก🦀".repeat(500),"bio":"🦀".repeat(2000),"age":"20","avatarUri":"http://example.test/unsafe",
            "activityDetails":{"running":{"pace":{"nested":"invalid"},"timeOfDay":[null," เย็น "," เย็น "]}},
            "availabilitySlots":[{"date":"2026-02-30","start":"18:00","end":"20:00"},{"date":"2026-10-12","start":"25:00","end":"20:00"},
                {"date":"2026-10-12","start":"18:00","end":"20:00"},{"date":"2026-10-12","start":"18:00","end":"20:00"}],
            "updatedAt":-1,"privacy":false});
        let profile = discovery_profile("u", &raw);
        assert_eq!(
            profile["name"].as_str().map(|s| s.chars().count()),
            Some(100)
        );
        assert_eq!(
            profile["bio"].as_str().map(|s| s.chars().count()),
            Some(1000)
        );
        assert!(profile.get("avatarUri").is_none());
        assert!(profile.get("age").is_none());
        assert!(profile.get("updatedAt").is_none());
        assert_eq!(
            profile["availabilitySlots"].as_array().map(Vec::len),
            Some(1)
        );
        assert_eq!(
            profile["activityDetails"]["running"]["timeOfDay"],
            json!(["เย็น"])
        );
        for malformed in [
            Value::Null,
            json!([]),
            json!(true),
            json!("secret"),
            json!(123),
        ] {
            assert_eq!(discovery_profile("u", &malformed)["isFaceVerified"], false);
            assert!(!visible_match_record(&malformed).discoverable);
        }
    }

    #[test]
    fn distance_uses_coordinates_only_with_both_location_permissions() {
        let raw = json!({"latitude":7.0,"longitude":100.0});
        assert_eq!(visible_match_record(&raw).coordinates, Some((7.0, 100.0)));
        for hidden in [
            json!({"latitude":7.0,"longitude":100.0,"locationEnabled":false}),
            json!({"latitude":7.0,"longitude":100.0,"privacy":{"showLocation":false}}),
            json!({"latitude":91.0,"longitude":100.0}),
        ] {
            assert!(visible_match_record(&hidden).coordinates.is_none());
        }
        assert!(discovery_profile("u", &raw).get("latitude").is_none());
    }
}
