//! Server-side view of a `users/{uid}` document: only the fields discovery
//! policy, filters and ranking read. Raw JSON stays available for the ported
//! filter code, which mirrors the Node implementation field-for-field.

use serde_json::{Map, Value};

use crate::value::{js_bool, js_number, js_str, string_list};

#[derive(Debug, Clone)]
pub struct Slot {
    pub date: String,
    pub start: Option<u32>,
    pub end: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct UserRecord {
    pub raw: Map<String, Value>,
    pub discoverable: bool,
    pub is_new: bool,
    pub face_verified: bool,
    pub location_enabled: bool,
    pub coordinates: Option<(f64, f64)>,
    pub slots: Vec<Slot>,
    /// `activities` + `activity` + `interests`, without the catch-all ids.
    pub interests: Vec<String>,
    pub last_active_ms: Option<i64>,
}

/// `HH:MM` -> minutes since midnight (24:00 allowed), matching secureDiscovery.js.
pub fn minutes(value: Option<&Value>) -> Option<u32> {
    let text = value?.as_str()?;
    let (hour, minute) = text.split_once(':')?;
    if hour.is_empty() || hour.len() > 2 || minute.len() != 2 || !hour.bytes().chain(minute.bytes()).all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (hour, minute): (u32, u32) = (hour.parse().ok()?, minute.parse().ok()?);
    (hour <= 24 && minute < 60 && (hour < 24 || minute == 0)).then_some(hour * 60 + minute)
}

impl UserRecord {
    pub fn from_fields(raw: Map<String, Value>) -> Self {
        let latitude = raw.get("latitude").and_then(Value::as_f64);
        let longitude = raw.get("longitude").and_then(Value::as_f64);
        let coordinates = match (latitude, longitude) {
            (Some(lat), Some(lng)) if lat.is_finite() && lng.is_finite() && (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lng) => Some((lat, lng)),
            _ => None,
        };
        let slots = match raw.get("availabilitySlots") {
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(Value::as_object)
                .map(|slot| Slot {
                    date: js_str(slot, "date").to_owned(),
                    start: minutes(slot.get("start")),
                    end: minutes(slot.get("end")),
                })
                .collect(),
            _ => Vec::new(),
        };
        let mut interests: Vec<String> = string_list(raw.get("activities"));
        interests.extend(string_list(raw.get("interests")));
        let single = js_str(&raw, "activity");
        if !single.is_empty() {
            interests.push(single.to_owned());
        }
        interests.retain(|id| id != "other" && id != "all" && !id.is_empty());
        interests.sort();
        interests.dedup();
        let last_active_ms = ["lastSeen", "locationUpdatedAt", "updatedAt"]
            .iter()
            .filter_map(|key| js_number(raw.get(*key)).filter(|value| *value > 0.0).map(|value| value as i64))
            .max();
        Self {
            discoverable: js_bool(&raw, "isDiscoverable") != Some(false),
            is_new: js_bool(&raw, "isNewUser") == Some(true),
            face_verified: js_bool(&raw, "isFaceVerified") == Some(true),
            location_enabled: js_bool(&raw, "locationEnabled") != Some(false),
            coordinates,
            slots,
            interests,
            last_active_ms,
            raw,
        }
    }

    pub fn has_photo(&self) -> bool {
        let non_empty = |key: &str| self.raw.get(key).and_then(Value::as_str).is_some_and(|text| !text.is_empty());
        non_empty("avatarUri") || non_empty("photoURL") || matches!(self.raw.get("photos"), Some(Value::Array(items)) if !items.is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub status: String,
}

impl Decision {
    pub fn from_fields(fields: &Map<String, Value>) -> Option<Self> {
        let from = js_str(fields, "fromUserId");
        let to = js_str(fields, "toUserId");
        if from.is_empty() || to.is_empty() {
            return None;
        }
        Some(Self { from: from.into(), to: to.into(), kind: js_str(fields, "type").into(), status: js_str(fields, "status").into() })
    }
}
