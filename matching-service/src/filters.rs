//! Ports of `validateDiscoveryFilters` (profileVisibilityPolicy.js) and
//! `matchesServerFilters` (secureDiscovery.js). Behaviour and messages match
//! the Node callable so both backends accept and reject the same requests.

use std::collections::BTreeMap;

use chrono::{Datelike, NaiveDate};
use serde::Serialize;
use serde_json::{Map, Value};

use crate::error::ApiError;
use crate::model::UserRecord;
use crate::policy::has_plan_feature;
use crate::value::{js_len, js_number, js_string, string_list};

const ADVANCED_KEYS: [&str; 5] = ["faculties", "years", "availabilityPeriods", "availabilityWeekdays", "paces"];
const ALLOWED_KEYS: [&str; 13] = ["genders", "minAge", "maxAge", "distanceKm", "activities", "requirePhoto", "requireAvailability", "activityDetails",
    "faculties", "years", "availabilityPeriods", "availabilityWeekdays", "paces"];
const RESERVED: [&str; 3] = ["__proto__", "prototype", "constructor"];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveryFilters {
    pub min_age: f64,
    pub max_age: f64,
    pub distance_km: f64,
    pub genders: Vec<String>,
    pub activities: Vec<String>,
    pub faculties: Vec<String>,
    pub years: Vec<String>,
    pub availability_periods: Vec<String>,
    pub availability_weekdays: Vec<String>,
    pub paces: Vec<String>,
    pub require_photo: bool,
    pub require_availability: bool,
    // BTreeMap keeps the scope hash independent of key order.
    pub activity_details: BTreeMap<String, BTreeMap<String, Vec<String>>>,
}

fn dedupe(values: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    values.into_iter().filter(|value| seen.insert(value.clone())).collect()
}

/// JavaScript falsiness, for the `input[key] || default` fallbacks in the Node code.
fn is_falsy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => true,
        Some(Value::Number(number)) => number.as_f64().is_none_or(|n| n == 0.0 || n.is_nan()),
        Some(Value::String(text)) => text.is_empty(),
        _ => false,
    }
}

fn string_array(value: Option<&Value>, max_items: usize, message: &str) -> Result<Vec<String>, ApiError> {
    if is_falsy(value) {
        return Ok(Vec::new());
    }
    match value {
        Some(Value::Array(items)) if items.len() <= max_items => items
            .iter()
            .map(|item| match item.as_str() {
                Some(text) if !text.is_empty() && js_len(text) <= 100 => Ok(text.to_owned()),
                _ => Err(ApiError::invalid(message)),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(dedupe),
        _ => Err(ApiError::invalid(message)),
    }
}

pub fn validate(input: &Value, entitlement: Option<&Value>, now_ms: i64) -> Result<DiscoveryFilters, ApiError> {
    let empty = Map::new();
    let input = match input {
        Value::Null => &empty,
        Value::Object(map) => map,
        _ => return Err(ApiError::invalid("ตัวกรองไม่ถูกต้อง")),
    };
    if input.keys().any(|key| !ALLOWED_KEYS.contains(&key.as_str())) {
        return Err(ApiError::invalid("ตัวกรองไม่ถูกต้อง"));
    }
    let mut numbers = [18.0, 100.0, 0.0];
    for (slot, key) in numbers.iter_mut().zip(["minAge", "maxAge", "distanceKm"]) {
        match input.get(key) {
            None => {}
            Some(Value::Number(number)) => *slot = number.as_f64().filter(|value| value.is_finite()).ok_or_else(|| ApiError::invalid("ตัวกรองตัวเลขไม่ถูกต้อง"))?,
            Some(_) => return Err(ApiError::invalid("ตัวกรองตัวเลขไม่ถูกต้อง")),
        }
    }
    let [min_age, max_age, distance_km] = numbers;
    if min_age.fract() != 0.0 || max_age.fract() != 0.0 || min_age < 18.0 || max_age > 100.0 || min_age > max_age || !(0.0..=100.0).contains(&distance_km) {
        return Err(ApiError::invalid("ช่วงตัวกรองไม่ถูกต้อง"));
    }
    let list = |key: &str| string_array(input.get(key), 30, "รายการตัวกรองไม่ถูกต้อง");
    let mut filters = DiscoveryFilters {
        min_age, max_age, distance_km,
        genders: list("genders")?, activities: list("activities")?, faculties: list("faculties")?, years: list("years")?,
        availability_periods: list("availabilityPeriods")?, availability_weekdays: list("availabilityWeekdays")?, paces: list("paces")?,
        require_photo: false, require_availability: false, activity_details: BTreeMap::new(),
    };
    for (key, target) in [("requirePhoto", &mut filters.require_photo), ("requireAvailability", &mut filters.require_availability)] {
        match input.get(key) {
            None => {}
            Some(Value::Bool(flag)) => *target = *flag,
            Some(_) => return Err(ApiError::invalid("เงื่อนไขตัวกรองไม่ถูกต้อง")),
        }
    }
    let details_error = || ApiError::invalid("รายละเอียดกิจกรรมไม่ถูกต้อง");
    let details = match input.get("activityDetails") {
        value if is_falsy(value) => Map::new(),
        Some(Value::Object(map)) if map.len() <= 30 => map.clone(),
        _ => return Err(details_error()),
    };
    for (activity, fields) in &details {
        let Some(fields) = fields.as_object().filter(|map| map.len() <= 20) else { return Err(details_error()) };
        if RESERVED.contains(&activity.as_str()) || !filters.activities.contains(activity) {
            return Err(details_error());
        }
        let entry = filters.activity_details.entry(activity.clone()).or_default();
        for (key, values) in fields {
            let valid_key = !key.is_empty() && key.len() <= 50 && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
            if RESERVED.contains(&key.as_str()) || !valid_key || !values.is_array() {
                return Err(details_error());
            }
            entry.insert(key.clone(), string_array(Some(values), 20, "รายละเอียดกิจกรรมไม่ถูกต้อง")?);
        }
    }
    let advanced = filters.faculties.len() + filters.years.len() + filters.availability_periods.len() + filters.availability_weekdays.len() + filters.paces.len() > 0;
    debug_assert_eq!(ADVANCED_KEYS.len(), 5);
    if (advanced || filters.require_availability) && !has_plan_feature(entitlement, "advancedFilters", now_ms) {
        return Err(ApiError::plus_required("advancedFilters"));
    }
    Ok(filters)
}

const PERIODS: [(&str, &[(u32, u32)]); 4] = [
    ("morning", &[(360, 720)]), ("afternoon", &[(720, 1080)]), ("evening", &[(1080, 1260)]), ("night", &[(1260, 1440), (0, 360)]),
];
const WORDS: [(&str, &[&str]); 4] = [
    ("morning", &["เช้า", "morning"]), ("afternoon", &["บ่าย", "afternoon"]), ("evening", &["เย็น", "ค่ำ", "evening"]), ("night", &["ดึก", "กลางคืน", "night"]),
];

pub fn period_ranges(period: &str) -> &'static [(u32, u32)] {
    PERIODS.iter().find(|(name, _)| *name == period).map(|(_, ranges)| *ranges).unwrap_or(&[])
}
pub fn period_words(period: &str) -> &'static [&'static str] {
    WORDS.iter().find(|(name, _)| *name == period).map(|(_, words)| *words).unwrap_or(&[])
}

/// `String(new Date(date).getUTCDay())` for a valid `YYYY-MM-DD`.
pub fn weekday_of(date: &str) -> Option<String> {
    if date.len() != 10 {
        return None;
    }
    let parsed = NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()?;
    (parsed.format("%Y-%m-%d").to_string() == date).then(|| parsed.weekday().num_days_from_sunday().to_string())
}

pub fn matches(profile: &UserRecord, filters: &DiscoveryFilters, distance: Option<f64>) -> bool {
    let raw = &profile.raw;
    let selected = |values: &[String], key: &str| values.is_empty() || values.contains(&js_string(raw.get(key)));
    let Some(age) = js_number(raw.get("age")).filter(|value| value.is_finite()) else { return false };
    if age < filters.min_age || age > filters.max_age || !selected(&filters.genders, "gender") || !selected(&filters.faculties, "faculty")
        || !selected(&filters.years, "year") || !selected(&filters.paces, "pace") {
        return false;
    }
    let mut activities = string_list(raw.get("activities"));
    if let Some(single) = raw.get("activity").and_then(Value::as_str) {
        activities.push(single.to_owned());
    }
    if !filters.activities.is_empty() && !filters.activities.iter().any(|value| activities.contains(value)) {
        return false;
    }
    if filters.require_photo && !profile.has_photo() {
        return false;
    }
    for (activity, fields) in &filters.activity_details {
        if !activities.contains(activity) {
            return false;
        }
        for (key, choices) in fields {
            let value = raw.get("activityDetails").and_then(|details| details.get(activity)).and_then(|detail| detail.get(key));
            let hit = choices.iter().any(|choice| match value {
                Some(Value::Array(items)) => items.iter().any(|item| item.as_str() == Some(choice.as_str())),
                Some(Value::String(text)) => text == choice,
                _ => false,
            });
            if !choices.is_empty() && !hit {
                return false;
            }
        }
    }
    if filters.distance_km > 0.0 && distance.is_none_or(|km| km > filters.distance_km) {
        return false;
    }
    let raw_slots = matches!(raw.get("availabilitySlots"), Some(Value::Array(items)) if !items.is_empty());
    let availability_text = raw.get("availability").and_then(Value::as_str).unwrap_or("");
    if filters.require_availability && !raw_slots && availability_text.trim().is_empty() {
        return false;
    }
    if !filters.availability_periods.is_empty() {
        let text = availability_text.to_lowercase();
        let legacy = text.contains("ตลอดเวลา") || text.contains("anytime")
            || filters.availability_periods.iter().any(|period| period_words(period).iter().any(|word| text.contains(word)));
        let overlap = profile.slots.iter().any(|slot| match (slot.start, slot.end) {
            (Some(start), Some(end)) if end > start => filters.availability_periods.iter()
                .any(|period| period_ranges(period).iter().any(|(a, b)| start < *b && end > *a)),
            _ => false,
        });
        if !legacy && !overlap {
            return false;
        }
    }
    if !filters.availability_weekdays.is_empty()
        && !profile.slots.iter().any(|slot| weekday_of(&slot.date).is_some_and(|day| filters.availability_weekdays.contains(&day))) {
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn user(fields: Value) -> UserRecord {
        UserRecord::from_fields(fields.as_object().unwrap().clone())
    }

    #[test]
    fn validation_matches_node_rules() {
        let ok = validate(&json!({ "minAge": 20, "maxAge": 25, "genders": ["female", "female"] }), None, 0).unwrap();
        assert_eq!(ok.genders, vec!["female"]);
        assert_eq!(validate(&json!({ "bogus": 1 }), None, 0).unwrap_err().code, "invalid-argument");
        assert_eq!(validate(&json!({ "minAge": 17 }), None, 0).unwrap_err().code, "invalid-argument");
        assert_eq!(validate(&json!({ "minAge": 20.5 }), None, 0).unwrap_err().code, "invalid-argument");
        assert_eq!(validate(&json!({ "requirePhoto": "yes" }), None, 0).unwrap_err().code, "invalid-argument");
        let paid = validate(&json!({ "faculties": ["วิศวกรรมศาสตร์"] }), None, 0).unwrap_err();
        assert_eq!(paid.code, "permission-denied");
        assert!(validate(&json!({ "activityDetails": { "running": { "pace": ["x"] } } }), None, 0).is_err());
        assert!(validate(&json!({ "activities": ["running"], "activityDetails": { "running": { "pace": ["x"] } } }), None, 0).is_ok());
    }

    #[test]
    fn server_filters() {
        let filters = validate(&json!({ "minAge": 20, "maxAge": 22, "activities": ["running"], "distanceKm": 5 }), None, 0).unwrap();
        let candidate = user(json!({ "age": "21", "activity": "running" }));
        assert!(matches(&candidate, &filters, Some(1.0)));
        assert!(!matches(&candidate, &filters, None));
        assert!(!matches(&candidate, &filters, Some(6.0)));
        assert!(!matches(&user(json!({ "age": 23, "activity": "running" })), &filters, Some(1.0)));
        assert_eq!(weekday_of("2026-10-12").as_deref(), Some("1"));
        assert_eq!(weekday_of("2026-02-30"), None);
    }
}
