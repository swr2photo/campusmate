//! Compatibility ranking. Each component is 0..=1 and weighted; the total is
//! the 0..=100 `compatibility` the app already displays on profile cards.
//! Unknown data gets a neutral value so sparse profiles are not buried.

#[cfg(test)]
use std::collections::BTreeSet;
use std::collections::HashSet;

use serde_json::Value;
use sha2::{Digest, Sha256};

#[cfg(test)]
use crate::filters::period_words;
#[cfg(test)]
use crate::model::Slot;
use crate::model::UserRecord;

const W_INTERESTS: f64 = 30.0;
const W_DETAILS: f64 = 10.0;
const W_AVAILABILITY: f64 = 25.0;
const W_PROXIMITY: f64 = 15.0;
const W_CAMPUS: f64 = 10.0;
const W_QUALITY: f64 = 10.0;

/// Two shared hours on the same day count as a full availability match.
#[cfg(test)]
const FULL_OVERLAP_MINUTES: f64 = 120.0;
const DAY_MS: i64 = 86_400_000;

const RUNNING_PACES: [&str; 6] = [
    "เดิน / เริ่มต้น",
    "Pace 8:00+ นาที/กม.",
    "Pace 7:00 - 8:00 นาที/กม.",
    "Pace 6:00 - 7:00 นาที/กม.",
    "Pace 5:00 - 6:00 นาที/กม.",
    "Pace ต่ำกว่า 5:00 นาที/กม.",
];
const LEVELS: [&str; 3] = ["เพิ่งเริ่ม", "พอเล่นได้", "จริงจัง / แข่งขัน"];

fn activity_phrase(id: &str) -> Option<&'static str> {
    Some(match id {
        "running" => "วิ่ง",
        "gym" => "เข้ายิม",
        "sports" => "เล่นกีฬา",
        "study" => "ติวหนังสือ",
        "chill" => "นั่งคาเฟ่",
        "cycling" => "ปั่นจักรยาน",
        "swimming" => "ว่ายน้ำ",
        "yoga" => "โยคะ",
        "music" => "ดนตรี",
        "gaming" => "เล่นเกม",
        "art" => "ศิลปะ",
        "language" => "ฝึกภาษา",
        "food" => "ตะลุยร้านอาหาร",
        "volunteer" => "ทำกิจกรรมชมรม",
        _ => return None,
    })
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatchScore {
    pub score: u8,
    pub reasons: Vec<String>,
}

pub struct Context<'a> {
    pub today: &'a str,
    pub now_ms: i64,
}

pub fn score(
    ctx: &Context,
    viewer: &UserRecord,
    candidate: &UserRecord,
    distance: Option<f64>,
) -> MatchScore {
    let mut reasons: Vec<(f64, String)> = Vec::new();

    // 1. Shared activities: overlap coefficient, so a focused profile that
    // shares its one activity is not penalised against a long list.
    let shared: Vec<&String> = viewer
        .interests
        .iter()
        .filter(|id| candidate.interests.contains(id))
        .collect();
    let interests = if viewer.interests.is_empty() || candidate.interests.is_empty() {
        0.35
    } else {
        let overlap =
            shared.len() as f64 / viewer.interests.len().min(candidate.interests.len()) as f64;
        let union = viewer.interests.len() + candidate.interests.len() - shared.len();
        0.5 * overlap + 0.5 * shared.len() as f64 / union as f64
    };
    let phrases: Vec<&str> = shared
        .iter()
        .filter_map(|id| activity_phrase(id))
        .take(2)
        .collect();
    if !phrases.is_empty() {
        reasons.push((3.0, format!("ชอบ{}เหมือนกัน", phrases.join("และ"))));
    }

    // 2. Activity details (pace, level, sport types) for shared activities.
    let (details, pace_close) = detail_fit(viewer, candidate, &shared);
    if pace_close {
        reasons.push((2.5, "เพซวิ่งใกล้กัน".into()));
    }

    // Convenient time is no longer a product feature. A flat neutral value
    // keeps the score scale without letting old slots change rank or reasons.
    let availability = 0.15;

    // 4. Proximity; `distance` is already privacy-floored.
    let proximity = match distance {
        Some(km) if km <= 1.0 => 1.0,
        Some(km) => (1.0 - (km - 1.0) / 14.0).max(0.0),
        None => 0.4,
    };
    if distance.is_some_and(|km| km <= 2.0) {
        reasons.push((2.0, "อยู่ใกล้คุณ".into()));
    }

    // 5. Campus affinity: same faculty and nearby academic year.
    let (campus, campus_reason) = campus_fit(viewer, candidate);
    if let Some(reason) = campus_reason {
        reasons.push((1.5, reason));
    }

    // 6. Profile quality and recent activity — favours people likely to reply.
    let quality = quality(candidate, ctx.now_ms);

    let total = W_INTERESTS * interests
        + W_DETAILS * details
        + W_AVAILABILITY * availability
        + W_PROXIMITY * proximity
        + W_CAMPUS * campus
        + W_QUALITY * quality;
    reasons.sort_by(|a, b| b.0.total_cmp(&a.0));
    MatchScore {
        score: total.round().clamp(0.0, 100.0) as u8,
        reasons: reasons.into_iter().map(|(_, text)| text).take(3).collect(),
    }
}

/// Stable within a day for a viewer, different across viewers: equal scores
/// rotate fairly instead of always favouring the same document ids.
pub fn tie_break(viewer_id: &str, candidate_id: &str, today: &str) -> u64 {
    let digest = Sha256::new()
        .chain_update(viewer_id)
        .chain_update([0])
        .chain_update(candidate_id)
        .chain_update([0])
        .chain_update(today)
        .finalize();
    u64::from_be_bytes(digest[..8].try_into().expect("8 bytes"))
}

fn ordinal(options: &[&str], value: &str) -> Option<usize> {
    options.iter().position(|option| *option == value)
}

fn detail_fit(viewer: &UserRecord, candidate: &UserRecord, shared: &[&String]) -> (f64, bool) {
    let mut total = 0.0;
    let mut count = 0usize;
    let mut pace_close = false;
    for activity in shared {
        let mine = viewer
            .raw
            .get("activityDetails")
            .and_then(|d| d.get(activity.as_str()))
            .and_then(Value::as_object);
        let theirs = candidate
            .raw
            .get("activityDetails")
            .and_then(|d| d.get(activity.as_str()))
            .and_then(Value::as_object);
        let (Some(mine), Some(theirs)) = (mine, theirs) else {
            continue;
        };
        for (key, mine_value) in mine {
            let Some(their_value) = theirs.get(key) else {
                continue;
            };
            let fit = match (mine_value, their_value) {
                (Value::String(a), Value::String(b)) => {
                    let scale: Option<&[&str]> = match key.as_str() {
                        "pace" => Some(&RUNNING_PACES),
                        "level" => Some(&LEVELS),
                        _ => None,
                    };
                    match scale.and_then(|options| {
                        Some((ordinal(options, a)?, ordinal(options, b)?, options.len()))
                    }) {
                        Some((i, j, len)) => {
                            let fit = 1.0 - (i.abs_diff(j) as f64 / (len - 1) as f64) * 1.6;
                            if key == "pace" && i.abs_diff(j) <= 1 {
                                pace_close = true;
                            }
                            fit.max(0.0)
                        }
                        None if a == b => 1.0,
                        None => 0.3,
                    }
                }
                (Value::Array(a), Value::Array(b)) => {
                    let a: HashSet<&str> = a.iter().filter_map(Value::as_str).collect();
                    let b: HashSet<&str> = b.iter().filter_map(Value::as_str).collect();
                    let union = a.union(&b).count();
                    if union == 0 {
                        continue;
                    } else {
                        a.intersection(&b).count() as f64 / union as f64
                    }
                }
                _ => continue,
            };
            total += fit;
            count += 1;
        }
    }
    (
        if count == 0 {
            0.5
        } else {
            total / count as f64
        },
        pace_close,
    )
}

#[cfg(test)]
fn overlap_minutes(a: &Slot, b: &Slot) -> u32 {
    match (a.start, a.end, b.start, b.end) {
        (Some(s1), Some(e1), Some(s2), Some(e2)) if e1 > s1 && e2 > s2 => {
            e1.min(e2).saturating_sub(s1.max(s2))
        }
        _ => 0,
    }
}

#[cfg(test)]
fn text_periods(user: &UserRecord) -> BTreeSet<&'static str> {
    let text = user
        .raw
        .get("availability")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_lowercase();
    let all = ["morning", "afternoon", "evening", "night"];
    if text.contains("ตลอดเวลา") || text.contains("anytime") {
        return all.into_iter().collect();
    }
    all.into_iter()
        .filter(|p| period_words(p).iter().any(|word| text.contains(word)))
        .collect()
}

#[cfg(test)]
fn availability_fit(
    ctx: &Context,
    viewer: &UserRecord,
    candidate: &UserRecord,
) -> (f64, Option<String>) {
    let (mine, theirs) = (
        crate::model::upcoming_slots_at(viewer, ctx.today, ctx.now_ms),
        crate::model::upcoming_slots_at(candidate, ctx.today, ctx.now_ms),
    );
    let mut minutes = 0u32;
    let mut days = BTreeSet::new();
    for a in &mine {
        for b in theirs.iter().filter(|b| b.date == a.date) {
            let shared = overlap_minutes(a, b);
            if shared > 0 {
                minutes += shared;
                days.insert(a.date.clone());
            }
        }
    }
    if minutes > 0 {
        return (
            (f64::from(minutes) / FULL_OVERLAP_MINUTES).min(1.0),
            Some(format!("ว่างตรงกัน {} วัน", days.len())),
        );
    }
    let (a, b) = (text_periods(viewer), text_periods(candidate));
    if !a.is_empty() && !b.is_empty() {
        return (
            if a.intersection(&b).next().is_some() {
                0.3
            } else {
                0.0
            },
            None,
        );
    }
    (0.15, None)
}

fn year_number(user: &UserRecord) -> Option<u32> {
    let text = crate::value::js_string(user.raw.get("year"));
    let digits: String = text
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse::<u32>().ok().filter(|n| (1..=12).contains(n))
}

fn campus_fit(viewer: &UserRecord, candidate: &UserRecord) -> (f64, Option<String>) {
    let faculty = |user: &UserRecord| {
        user.raw
            .get("faculty")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_owned()
    };
    let same_faculty = !faculty(viewer).is_empty() && faculty(viewer) == faculty(candidate);
    let year_gap = year_number(viewer)
        .zip(year_number(candidate))
        .map(|(a, b)| a.abs_diff(b));
    let mut fit: f64 = if same_faculty { 0.6 } else { 0.0 };
    fit += match year_gap {
        Some(0) => 0.4,
        Some(1) => 0.25,
        _ => 0.0,
    };
    let reason = match (same_faculty, year_gap) {
        (true, Some(0)) => Some("คณะและชั้นปีเดียวกัน".into()),
        (true, _) => Some("คณะเดียวกัน".into()),
        (false, Some(0)) => Some("ชั้นปีเดียวกัน".into()),
        _ => None,
    };
    (fit.min(1.0), reason)
}

fn quality(candidate: &UserRecord, now_ms: i64) -> f64 {
    let raw = &candidate.raw;
    let mut fit: f64 = if candidate.has_photo() { 0.25 } else { 0.0 };
    let gallery = raw
        .get("gallery")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    fit += match gallery {
        0 => 0.0,
        1 => 0.1,
        _ => 0.2,
    };
    let bio = raw
        .get("bio")
        .and_then(Value::as_str)
        .map_or(0, |bio| bio.trim().chars().count());
    fit += if bio >= 20 {
        0.2
    } else if bio > 0 {
        0.1
    } else {
        0.0
    };
    if !candidate.slots.is_empty()
        || raw
            .get("availability")
            .and_then(Value::as_str)
            .is_some_and(|text| !text.trim().is_empty())
    {
        fit += 0.1;
    }
    let idle_days = candidate
        .last_active_ms
        .map(|at| (now_ms - at).max(0) / DAY_MS);
    fit += match idle_days {
        Some(0..=3) => 0.25,
        Some(4..=14) => 0.15,
        Some(15..=30) => 0.05,
        _ => 0.0,
    };
    fit.min(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn user(fields: Value) -> UserRecord {
        UserRecord::from_fields(fields.as_object().unwrap().clone())
    }
    const NOW: i64 = 1_791_763_200_000; // 2026-10-12T00:00:00Z

    fn ctx() -> Context<'static> {
        Context {
            today: "2026-10-12",
            now_ms: NOW,
        }
    }

    #[test]
    fn shared_interests_and_time_rank_higher() {
        let viewer = user(
            json!({ "activities": ["running", "study"], "faculty": "วิศวกรรมศาสตร์", "year": "ปี 2",
            "availabilitySlots": [{ "date": "2026-10-14", "start": "17:00", "end": "19:00" }],
            "activityDetails": { "running": { "pace": "Pace 6:00 - 7:00 นาที/กม." } } }),
        );
        let great = user(
            json!({ "activities": ["running"], "faculty": "วิศวกรรมศาสตร์", "year": "ปี 2", "bio": "ชอบวิ่งตอนเย็นรอบอ่างเก็บน้ำ ม.อ.",
            "avatarUri": "https://x/y.jpg", "lastSeen": NOW - 1000,
            "availabilitySlots": [{ "date": "2026-10-14", "start": "17:30", "end": "19:30" }],
            "activityDetails": { "running": { "pace": "Pace 7:00 - 8:00 นาที/กม." } } }),
        );
        let weak = user(json!({ "activities": ["gaming"], "faculty": "แพทยศาสตร์", "year": "ปี 5" }));
        let high = score(&ctx(), &viewer, &great, Some(0.7));
        let low = score(&ctx(), &viewer, &weak, Some(12.0));
        assert!(high.score > low.score + 15, "{high:?} vs {low:?}");
        assert_eq!(high.reasons[0], "ชอบวิ่งเหมือนกัน");
        assert!(high.reasons.iter().all(|r| !r.starts_with("ว่างตรงกัน")));
        assert!(high.score <= 100);
    }

    #[test]
    fn past_slots_do_not_count_as_overlap() {
        let a = user(
            json!({ "availabilitySlots": [{ "date": "2026-10-01", "start": "10:00", "end": "12:00" }] }),
        );
        let b = user(
            json!({ "availabilitySlots": [{ "date": "2026-10-01", "start": "10:00", "end": "12:00" }] }),
        );
        let (fit, reason) = availability_fit(&ctx(), &a, &b);
        assert_eq!(reason, None);
        assert!(fit <= 0.3);
    }

    #[test]
    fn todays_elapsed_time_cannot_improve_compatibility_or_reasons() {
        let record = user(json!({"availabilitySlots":[
            {"date":"2026-10-12","start":"09:00","end":"12:00"}
        ]}));
        let at = |instant: &str| Context {
            today: "2026-10-12",
            now_ms: chrono::DateTime::parse_from_rfc3339(instant)
                .unwrap()
                .timestamp_millis(),
        };
        let before = at("2026-10-12T08:00:00+07:00");
        let during = at("2026-10-12T11:30:30+07:00");
        let after = at("2026-10-12T21:00:00+07:00");
        assert_eq!(availability_fit(&before, &record, &record).0, 1.0);
        assert_eq!(availability_fit(&during, &record, &record).0, 29.0 / 120.0);
        assert_eq!(availability_fit(&after, &record, &record), (0.15, None));
        let expired_score = score(&after, &record, &record, None);
        let no_slots = user(json!({}));
        // The separate profile-completeness component may still reward a
        // filled schedule, but its expired time must never explain a match.
        assert_eq!(
            expired_score.reasons,
            score(&after, &no_slots, &no_slots, None).reasons
        );
        assert_eq!(
            score(&before, &record, &record, None).score,
            expired_score.score
        );
    }

    #[test]
    fn tie_break_is_stable_per_day() {
        assert_eq!(
            tie_break("a", "b", "2026-10-12"),
            tie_break("a", "b", "2026-10-12")
        );
        assert_ne!(
            tie_break("a", "b", "2026-10-12"),
            tie_break("a", "b", "2026-10-13")
        );
    }

    #[test]
    fn duplicate_and_overlapping_intervals_cannot_inflate_availability() {
        let viewer = user(
            json!({"availabilitySlots":[{"date":"2026-10-14","start":"18:00","end":"20:00"}]}),
        );
        let one = user(
            json!({"availabilitySlots":[{"date":"2026-10-14","start":"18:00","end":"18:30"}]}),
        );
        let duplicates = user(json!({"availabilitySlots":[
          {"date":"2026-10-14","start":"18:00","end":"18:30"},
          {"date":"2026-10-14","start":"18:00","end":"18:30"},
          {"date":"2026-10-14","start":"18:10","end":"18:20"}]}));
        assert_eq!(
            availability_fit(&ctx(), &viewer, &one),
            availability_fit(&ctx(), &viewer, &duplicates)
        );
        assert_eq!(availability_fit(&ctx(), &viewer, &one).0, 0.25);
    }

    #[test]
    fn dates_require_explicit_recurrence_and_never_recur_before_start() {
        let viewer = user(
            json!({"availabilitySlots":[{"date":"2026-10-14","start":"18:00","end":"20:00"}]}),
        );
        for date in ["2026-10-07", "2026-11-04", "2026-02-30", "2026-1-14"] {
            let other =
                user(json!({"availabilitySlots":[{"date":date,"start":"18:00","end":"20:00"}]}));
            assert_eq!(availability_fit(&ctx(), &viewer, &other).1, None);
        }
        let weekly = user(
            json!({"availabilitySlots":[{"date":"2026-10-07","start":"18:00","end":"20:00","repeat":"weekly"}]}),
        );
        assert!(availability_fit(&ctx(), &viewer, &weekly).1.is_some());
        let future_weekly = user(
            json!({"availabilitySlots":[{"date":"2026-11-04","start":"18:00","end":"20:00","recurring":true}]}),
        );
        assert_eq!(availability_fit(&ctx(), &viewer, &future_weekly).1, None);
    }
}
