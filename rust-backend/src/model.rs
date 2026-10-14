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
    pub recurring: bool,
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

/// Canonical, merged intervals in the next fourteen days. Recurrence is opt-in.
pub fn upcoming_slots(user: &UserRecord, today: &str) -> Vec<Slot> {
    use chrono::{Datelike, NaiveDate};
    use std::collections::BTreeMap;
    let Ok(first) = NaiveDate::parse_from_str(today, "%Y-%m-%d") else {
        return Vec::new();
    };
    let mut days: BTreeMap<String, Vec<(u32, u32)>> = BTreeMap::new();
    for slot in &user.slots {
        let Ok(start_date) = NaiveDate::parse_from_str(&slot.date, "%Y-%m-%d") else {
            continue;
        };
        if start_date.format("%Y-%m-%d").to_string() != slot.date {
            continue;
        }
        let (Some(start), Some(end)) = (slot.start, slot.end) else {
            continue;
        };
        if start >= end || end > 1440 {
            continue;
        }
        for offset in 0..14 {
            let day = first + chrono::Duration::days(offset);
            if day == start_date
                || (slot.recurring && day >= start_date && day.weekday() == start_date.weekday())
            {
                days.entry(day.format("%Y-%m-%d").to_string())
                    .or_default()
                    .push((start, end));
            }
        }
    }
    let mut normalized = Vec::new();
    for (date, mut intervals) in days {
        intervals.sort_unstable();
        let mut merged: Vec<(u32, u32)> = Vec::new();
        for (start, end) in intervals {
            if let Some(last) = merged.last_mut().filter(|last| start <= last.1) {
                last.1 = last.1.max(end);
            } else {
                merged.push((start, end));
            }
        }
        normalized.extend(merged.into_iter().map(|(start, end)| Slot {
            date: date.clone(),
            start: Some(start),
            end: Some(end),
            recurring: false,
        }));
    }
    normalized
}

/// Future portions of the same bounded calendar window, in CampusMate's
/// Bangkok timezone. Slots have minute precision; round a partial minute up
/// so elapsed seconds never count as available time.
pub fn upcoming_slots_at(user: &UserRecord, today: &str, now_ms: i64) -> Vec<Slot> {
    use chrono::{DateTime, Timelike, Utc};

    let Some(local_now) = DateTime::<Utc>::from_timestamp_millis(now_ms)
        .and_then(|at| at.checked_add_signed(chrono::Duration::hours(7)))
    else {
        return Vec::new();
    };
    if local_now.format("%Y-%m-%d").to_string() != today {
        return Vec::new();
    }
    let cutoff = local_now.hour() * 60
        + local_now.minute()
        + u32::from(local_now.second() != 0 || local_now.nanosecond() != 0);
    upcoming_slots(user, today)
        .into_iter()
        .filter_map(|mut slot| {
            if slot.date == today {
                let (Some(start), Some(end)) = (slot.start, slot.end) else {
                    return None;
                };
                if end <= cutoff {
                    return None;
                }
                slot.start = Some(start.max(cutoff));
            }
            Some(slot)
        })
        .collect()
}

/// `HH:MM` -> minutes since midnight (24:00 allowed), matching secureDiscovery.js.
pub fn minutes(value: Option<&Value>) -> Option<u32> {
    let text = value?.as_str()?;
    let (hour, minute) = text.split_once(':')?;
    if hour.is_empty()
        || hour.len() > 2
        || minute.len() != 2
        || !hour
            .bytes()
            .chain(minute.bytes())
            .all(|b| b.is_ascii_digit())
    {
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
            (Some(lat), Some(lng))
                if lat.is_finite()
                    && lng.is_finite()
                    && (-90.0..=90.0).contains(&lat)
                    && (-180.0..=180.0).contains(&lng) =>
            {
                Some((lat, lng))
            }
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
                    recurring: slot.get("recurring").and_then(Value::as_bool) == Some(true)
                        || slot.get("repeat").and_then(Value::as_str) == Some("weekly"),
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
            .filter_map(|key| {
                js_number(raw.get(*key))
                    .filter(|value| *value > 0.0)
                    .map(|value| value as i64)
            })
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
        let non_empty = |key: &str| {
            self.raw
                .get(key)
                .and_then(Value::as_str)
                .is_some_and(|text| !text.is_empty())
        };
        non_empty("avatarUri")
            || non_empty("photoURL")
            || matches!(self.raw.get("photos"), Some(Value::Array(items)) if !items.is_empty())
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
        Some(Self {
            from: from.into(),
            to: to.into(),
            kind: js_str(fields, "type").into(),
            status: js_str(fields, "status").into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn user(fields: Value) -> UserRecord {
        UserRecord::from_fields(fields.as_object().unwrap().clone())
    }

    fn timestamp(value: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .timestamp_millis()
    }

    #[test]
    fn future_intervals_exclude_ended_slots_and_clip_the_current_minute() {
        let record = user(json!({"availabilitySlots":[
            {"date":"2026-10-12","start":"08:00","end":"09:00"},
            {"date":"2026-10-12","start":"10:00","end":"12:00"},
            {"date":"2026-10-12","start":"18:00","end":"19:00"},
            {"date":"2026-10-13","start":"09:00","end":"10:00"}
        ]}));
        let now = timestamp("2026-10-12T04:30:30Z"); // 11:30:30 Bangkok
        let slots = upcoming_slots_at(&record, "2026-10-12", now);
        let actual: Vec<_> = slots
            .iter()
            .map(|slot| (slot.date.as_str(), slot.start, slot.end))
            .collect();
        assert_eq!(
            actual,
            [
                ("2026-10-12", Some(691), Some(720)),
                ("2026-10-12", Some(1080), Some(1140)),
                ("2026-10-13", Some(540), Some(600))
            ]
        );
        let exactly_ended = timestamp("2026-10-12T12:00:00+07:00");
        assert_eq!(
            upcoming_slots_at(&record, "2026-10-12", exactly_ended).len(),
            2
        );
        assert!(upcoming_slots_at(&record, "2026-10-11", now).is_empty());
        assert!(upcoming_slots_at(&record, "2026-10-12", i64::MAX).is_empty());
    }

    #[test]
    fn bangkok_midnight_recurrence_and_horizon_use_the_request_clock() {
        let record = user(json!({"availabilitySlots":[
            {"date":"2026-10-06","start":"00:00","end":"01:00","repeat":"weekly"},
            {"date":"2026-10-12","start":"22:00","end":"23:00"},
            {"date":"2026-10-26","start":"23:00","end":"24:00"},
            {"date":"2026-10-27","start":"10:00","end":"12:00"}
        ]}));
        let now = timestamp("2026-10-12T17:00:30Z"); // Oct 13 Bangkok
        let slots = upcoming_slots_at(&record, "2026-10-13", now);
        let actual: Vec<_> = slots
            .iter()
            .map(|slot| (slot.date.as_str(), slot.start, slot.end))
            .collect();
        assert_eq!(
            actual,
            [
                ("2026-10-13", Some(1), Some(60)),
                ("2026-10-20", Some(0), Some(60)),
                ("2026-10-26", Some(1380), Some(1440))
            ]
        );
        let after_today_ended = timestamp("2026-10-13T01:00:00+07:00");
        let upcoming = upcoming_slots_at(&record, "2026-10-13", after_today_ended);
        assert_eq!(upcoming.len(), 2);
        assert_eq!(upcoming[0].date, "2026-10-20");
    }
}
