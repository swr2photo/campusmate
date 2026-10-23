//! Party finder and encrypted group chat (legacy partyFunctions.js plus the
//! client-side Firestore reads/writes for parties, requests, epochs, messages
//! and read receipts). Every mutation runs in one transaction with the party
//! row locked; group sends are refused while a key rotation is pending.
use std::{collections::BTreeSet, time::Duration};

use axum::http::HeaderMap;
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{FixedOffset, NaiveDate, NaiveTime, TimeZone, Utc};
use serde_json::{json, Map, Value};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::{auth, error::ApiError, events, notify, AppState};

const CAMPUS: (f64, f64) = (7.008453, 100.497914);
const RADIUS_METERS: f64 = 3000.0;

fn id_arg<'a>(data: &'a Value, key: &str, label: &str) -> Result<&'a str, ApiError> {
    data[key]
        .as_str()
        .filter(|id| {
            !id.is_empty()
                && id.len() <= 128
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
        .ok_or_else(|| ApiError::invalid(format!("{label} ไม่ถูกต้อง")))
}

pub fn distance_meters(latitude: f64, longitude: f64) -> f64 {
    let rad = std::f64::consts::PI / 180.0;
    let d_lat = (latitude - CAMPUS.0) * rad;
    let d_lng = (longitude - CAMPUS.1) * rad;
    let h = (d_lat / 2.0).sin().powi(2)
        + (latitude * rad).cos() * (CAMPUS.0 * rad).cos() * (d_lng / 2.0).sin().powi(2);
    6_371_000.0 * 2.0 * h.sqrt().min(1.0).asin()
}

fn valid_point(latitude: f64, longitude: f64) -> bool {
    latitude.is_finite()
        && longitude.is_finite()
        && latitude.abs() <= 90.0
        && longitude.abs() <= 180.0
        && distance_meters(latitude, longitude) <= RADIUS_METERS
}

fn out_of_range(message: &str) -> ApiError {
    ApiError::new("out-of-range", message)
}

/// Validates a Bangkok-time schedule in the future.
pub fn schedule_from(data: &Value, now_ms: i64) -> Result<(Value, i64, i64), ApiError> {
    let date = data["date"].as_str().unwrap_or_default();
    let start = data["startTime"].as_str().unwrap_or_default();
    let end = data["endTime"].as_str().unwrap_or_default();
    let invalid = || ApiError::invalid("วันและเวลานัดหมายไม่ถูกต้อง");
    if date.len() != 10 || start.len() != 5 || end.len() != 5 {
        return Err(invalid());
    }
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| ApiError::invalid("วันที่นัดหมายไม่มีอยู่จริง"))?;
    let start_time = NaiveTime::parse_from_str(start, "%H:%M").map_err(|_| invalid())?;
    let end_time = NaiveTime::parse_from_str(end, "%H:%M").map_err(|_| invalid())?;
    let bangkok = FixedOffset::east_opt(7 * 3600).ok_or_else(ApiError::internal)?;
    let starts = bangkok
        .from_local_datetime(&day.and_time(start_time))
        .single()
        .ok_or_else(invalid)?
        .timestamp_millis();
    let ends = bangkok
        .from_local_datetime(&day.and_time(end_time))
        .single()
        .ok_or_else(invalid)?
        .timestamp_millis();
    if ends <= starts || starts <= now_ms {
        return Err(ApiError::new(
            "failed-precondition",
            "เวลานัดหมายต้องอยู่ในอนาคตและเวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม",
        ));
    }
    let message: String = data["message"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(500)
        .collect();
    Ok((
        json!({"date":date,"startTime":start,"endTime":end,"startsAt":starts,"endsAt":ends,"message":message}),
        starts,
        ends,
    ))
}

fn places_key() -> Result<String, ApiError> {
    std::env::var("GOOGLE_PLACES_API_KEY")
        .ok()
        .map(|k| k.trim().to_owned())
        .filter(|k| !k.is_empty())
        .ok_or_else(|| ApiError::unavailable("บริการค้นหาสถานที่ยังไม่พร้อม"))
}

async fn places(path: &str, body: Option<Value>) -> Result<Value, ApiError> {
    let key = places_key()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(7))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| ApiError::internal())?;
    let url = format!("https://places.googleapis.com/v1/{path}");
    let request = match &body {
        Some(body) => client.post(url).json(body).header(
            "X-Goog-FieldMask",
            "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
        ),
        None => client
            .get(url)
            .header("X-Goog-FieldMask", "id,displayName,location"),
    };
    let response = request
        .header("X-Goog-Api-Key", key)
        .send()
        .await
        .map_err(|_| ApiError::unavailable("เชื่อมต่อบริการค้นหาสถานที่ไม่ได้"))?;
    if !response.status().is_success() {
        tracing::warn!(status = response.status().as_u16(), "places api failed");
        return Err(ApiError::unavailable("บริการค้นหาสถานที่ขัดข้อง"));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| ApiError::unavailable("บริการค้นหาสถานที่ขัดข้อง"))?;
    if bytes.len() > 256 * 1024 {
        return Err(ApiError::unavailable("บริการค้นหาสถานที่ขัดข้อง"));
    }
    serde_json::from_slice(&bytes).map_err(|_| ApiError::unavailable("บริการค้นหาสถานที่ขัดข้อง"))
}

async fn resolve_place(place_id: &str) -> Result<Value, ApiError> {
    let place = places(&format!("places/{place_id}"), None).await?;
    let latitude = place["location"]["latitude"].as_f64().unwrap_or(f64::NAN);
    let longitude = place["location"]["longitude"].as_f64().unwrap_or(f64::NAN);
    if !valid_point(latitude, longitude) {
        return Err(out_of_range("สถานที่อยู่นอกรัศมี 3 กม. จาก ม.อ. หาดใหญ่"));
    }
    Ok(json!({
        "id": place["id"].as_str().unwrap_or(place_id),
        "name": place["displayName"]["text"].as_str().unwrap_or("สถานที่บนแผนที่"),
        "latitude": latitude, "longitude": longitude,
    }))
}

pub async fn search_places(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "places-search", &user.uid, 60).await?;
    let input: String = data["query"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(100)
        .collect();
    if input.chars().count() < 2 {
        return Ok(json!({"places":[]}));
    }
    let result = places(
        "places:autocomplete",
        Some(json!({"input":input,"locationRestriction":{"circle":{"center":{"latitude":CAMPUS.0,"longitude":CAMPUS.1},"radius":RADIUS_METERS}},
            "includedRegionCodes":["th"],"languageCode":"th"})),
    )
    .await?;
    let places: Vec<Value> = result["suggestions"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .take(8)
        .filter_map(|entry| {
            let id = entry["placePrediction"]["placeId"].as_str()?;
            let name = entry["placePrediction"]["text"]["text"].as_str()?;
            Some(json!({"placeId":id,"name":name}))
        })
        .collect();
    Ok(json!({"places":places}))
}

pub async fn resolve_campus_place(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "places-resolve", &user.uid, 60).await?;
    let id = id_arg(&data, "placeId", "Place ID")?;
    Ok(json!({"place": resolve_place(id).await?}))
}

async fn location(tx: &mut PgConnection, raw: &Value) -> Result<Value, ApiError> {
    match raw["kind"].as_str().unwrap_or_default() {
        "google" => {
            let id = id_arg(raw, "placeId", "Place ID")?;
            let place = resolve_place(id).await?;
            Ok(json!({"kind":"google","placeId":place["id"]}))
        }
        "campus" => {
            let spot = id_arg(raw, "spotId", "สถานที่")?;
            let data: Value = sqlx::query_scalar("SELECT data FROM spots WHERE id=$1")
                .bind(spot)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| ApiError::new("not-found", "ไม่พบสถานที่ใน ม.อ."))?;
            let (lat, lng) = (
                data["latitude"].as_f64().unwrap_or(f64::NAN),
                data["longitude"].as_f64().unwrap_or(f64::NAN),
            );
            if !valid_point(lat, lng) {
                return Err(out_of_range("สถานที่อยู่นอกรัศมี 3 กม."));
            }
            let name: String = data["name"]
                .as_str()
                .unwrap_or_default()
                .chars()
                .take(200)
                .collect();
            Ok(json!({"kind":"campus","spotId":spot,"latitude":lat,"longitude":lng,"name":name}))
        }
        "pin" => {
            let (lat, lng) = (
                raw["latitude"].as_f64().unwrap_or(f64::NAN),
                raw["longitude"].as_f64().unwrap_or(f64::NAN),
            );
            if !valid_point(lat, lng) {
                return Err(out_of_range("จุดนัดหมายอยู่นอกรัศมี 3 กม."));
            }
            let name: String = raw["name"]
                .as_str()
                .unwrap_or("จุดที่ปักหมุด")
                .trim()
                .chars()
                .take(200)
                .collect();
            Ok(json!({"kind":"pin","latitude":lat,"longitude":lng,"name":name}))
        }
        _ => Err(ApiError::invalid("กรุณาเลือกสถานที่")),
    }
}

async fn card(
    tx: &mut PgConnection,
    uid: &str,
    fallback: &str,
) -> Result<(String, String, Value), ApiError> {
    let raw: Value = sqlx::query_scalar("SELECT raw FROM profiles WHERE user_id=$1")
        .bind(uid)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(Value::Null);
    let name: String = raw["nickname"]
        .as_str()
        .filter(|s| !s.is_empty())
        .or_else(|| raw["name"].as_str())
        .unwrap_or(fallback)
        .chars()
        .take(100)
        .collect();
    let avatar: String = raw["avatarUri"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(5000)
        .collect();
    Ok((name, avatar, raw))
}

pub async fn create(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    crate::throttle(&state.db, "party-create", &user.uid, 10).await?;
    let (schedule, starts, ends) = schedule_from(&data["schedule"], Utc::now().timestamp_millis())?;
    let max_people = data["maxPeople"]
        .as_i64()
        .filter(|n| (2..=50).contains(n))
        .ok_or_else(|| ApiError::invalid("จำนวนสมาชิกต้องอยู่ระหว่าง 2–50 คน"))?;
    let mut tx = state.db.begin().await?;
    auth::lock_business_session(&mut tx, headers, &user.uid).await?;
    let location = location(&mut tx, &data["location"]).await?;
    let (name, avatar, raw) = card(&mut tx, &user.uid, "เพื่อนใน ม.อ.").await?;
    let host = json!({"name":name,"avatarUri":avatar,
        "faculty":raw["faculty"].as_str().unwrap_or_default().chars().take(100).collect::<String>(),
        "year":raw["year"].as_str().unwrap_or_default().chars().take(50).collect::<String>()});
    let id = Uuid::new_v4().simple().to_string();
    sqlx::query("INSERT INTO parties(id,host_id,host,location,schedule,starts_at,ends_at,max_people) VALUES($1,$2,$3,$4,$5,to_timestamp($6::double precision/1000),to_timestamp($7::double precision/1000),$8)")
        .bind(&id).bind(&user.uid).bind(host).bind(location).bind(schedule).bind(starts).bind(ends).bind(max_people as i32)
        .execute(&mut *tx).await?;
    sqlx::query("INSERT INTO party_members(party_id,user_id,position,name,avatar_uri) VALUES($1,$2,0,$3,$4)")
        .bind(&id).bind(&user.uid).bind(name).bind(avatar).execute(&mut *tx).await?;
    events::publish_one(&mut tx, &user.uid, "parties", Some(&id)).await?;
    tx.commit().await?;
    Ok(json!({"partyId":id}))
}

struct Party {
    host: String,
    status: String,
    starts_ms: i64,
    max_people: i32,
    legacy: bool,
    members: Vec<String>,
}

async fn lock_party(tx: &mut PgConnection, id: &str) -> Result<Option<Party>, ApiError> {
    let Some(row) = sqlx::query("SELECT host_id,status,(extract(epoch FROM starts_at)*1000)::bigint AS starts_ms,max_people,legacy FROM parties WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_optional(&mut *tx).await? else { return Ok(None) };
    let members: Vec<String> = sqlx::query_scalar(
        "SELECT user_id FROM party_members WHERE party_id=$1 ORDER BY position,joined_at",
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
    Ok(Some(Party {
        host: row.get("host_id"),
        status: row.get("status"),
        starts_ms: row.get("starts_ms"),
        max_people: row.get("max_people"),
        legacy: row.get("legacy"),
        members,
    }))
}

fn assert_open(party: &Party) -> Result<(), ApiError> {
    if party.status != "open" {
        return Err(ApiError::new("failed-precondition", "ตี้นี้ไม่ได้เปิดรับแล้ว"));
    }
    if party.starts_ms <= Utc::now().timestamp_millis() {
        return Err(ApiError::new("failed-precondition", "เวลานัดหมายผ่านไปแล้ว"));
    }
    Ok(())
}

async fn request_changed(
    tx: &mut PgConnection,
    party: &str,
    recipient: &str,
    status: &str,
) -> Result<(), ApiError> {
    let title = match status {
        "pending" => "มีคำขอเข้าร่วมตี้",
        "approved" => "คำขอเข้าร่วมตี้ได้รับอนุมัติ",
        "withdrawn" => "มีการถอนคำขอเข้าร่วมตี้",
        _ => "คำขอเข้าร่วมตี้ไม่ได้รับอนุมัติ",
    };
    let mut target = Map::new();
    target.insert("partyId".into(), json!(party));
    let notice = notify::system("party_request", title, "แตะเพื่อดูรายละเอียดในหน้าหาตี้", target);
    notify::enqueue(
        tx,
        recipient,
        &format!("party-request:{party}:{}", Uuid::new_v4()),
        &notice,
    )
    .await
}

pub async fn request_join(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    crate::throttle(&state.db, "party-join", &user.uid, 30).await?;
    let mut tx = state.db.begin().await?;
    auth::lock_business_session(&mut tx, headers, &user.uid).await?;
    let party = lock_party(&mut tx, party_id)
        .await?
        .ok_or_else(|| ApiError::new("failed-precondition", "ตี้นี้ไม่ได้เปิดรับแล้ว"))?;
    assert_open(&party)?;
    if party.host == user.uid || party.members.contains(&user.uid) {
        return Err(ApiError::new("already-exists", "คุณอยู่ในตี้นี้แล้ว"));
    }
    if party.members.len() as i32 >= party.max_people {
        return Err(ApiError::new("resource-exhausted", "ตี้เต็มแล้ว"));
    }
    let blocked: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM blocks WHERE (actor_id=$1 AND target_id=$2) OR (actor_id=$2 AND target_id=$1))")
        .bind(&user.uid).bind(&party.host).fetch_one(&mut *tx).await?;
    if blocked {
        return Err(ApiError::new("permission-denied", "เข้าร่วมตี้นี้ไม่ได้"));
    }
    let current: Option<String> = sqlx::query_scalar(
        "SELECT status FROM party_requests WHERE party_id=$1 AND requester_id=$2",
    )
    .bind(party_id)
    .bind(&user.uid)
    .fetch_optional(&mut *tx)
    .await?;
    if current.as_deref() == Some("pending") {
        tx.commit().await?;
        return Ok(json!({"status":"pending"}));
    }
    let (name, avatar, _) = card(&mut tx, &user.uid, "ผู้ใช้ ม.อ.").await?;
    sqlx::query("INSERT INTO party_requests(party_id,requester_id,host_id,requester_name,avatar_uri,status) VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT(party_id,requester_id) DO UPDATE SET status='pending',requester_name=excluded.requester_name,avatar_uri=excluded.avatar_uri,updated_at=now()")
        .bind(party_id).bind(&user.uid).bind(&party.host).bind(name).bind(avatar).execute(&mut *tx).await?;
    request_changed(&mut tx, party_id, &party.host, "pending").await?;
    events::publish(
        &mut tx,
        &[&user.uid, &party.host],
        "parties",
        Some(party_id),
    )
    .await?;
    tx.commit().await?;
    Ok(json!({"status":"pending"}))
}

pub async fn withdraw(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let mut tx = state.db.begin().await?;
    let host: Option<String> = sqlx::query_scalar("UPDATE party_requests SET status='withdrawn',updated_at=now() WHERE party_id=$1 AND requester_id=$2 AND status='pending' RETURNING host_id")
        .bind(party_id).bind(&user.uid).fetch_optional(&mut *tx).await?;
    let host = host.ok_or_else(|| ApiError::new("failed-precondition", "ไม่พบคำขอที่รออนุมัติ"))?;
    request_changed(&mut tx, party_id, &host, "withdrawn").await?;
    events::publish(&mut tx, &[&user.uid, &host], "parties", Some(party_id)).await?;
    tx.commit().await?;
    Ok(json!({"status":"withdrawn"}))
}

pub async fn reject(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let requester = id_arg(&data, "requesterId", "ผู้ขอเข้าร่วม")?;
    let mut tx = state.db.begin().await?;
    let party = lock_party(&mut tx, party_id)
        .await?
        .ok_or_else(|| ApiError::new("permission-denied", "เจ้าของตี้เท่านั้นที่จัดการคำขอได้"))?;
    if party.host != user.uid {
        return Err(ApiError::new(
            "permission-denied",
            "เจ้าของตี้เท่านั้นที่จัดการคำขอได้",
        ));
    }
    let updated = sqlx::query("UPDATE party_requests SET status='rejected',updated_at=now() WHERE party_id=$1 AND requester_id=$2 AND status='pending'")
        .bind(party_id).bind(requester).execute(&mut *tx).await?.rows_affected();
    if updated == 0 {
        return Err(ApiError::new("failed-precondition", "คำขอนี้ไม่รออนุมัติแล้ว"));
    }
    request_changed(&mut tx, party_id, requester, "rejected").await?;
    events::publish(&mut tx, &[&user.uid, requester], "parties", Some(party_id)).await?;
    tx.commit().await?;
    Ok(json!({"status":"rejected"}))
}

async fn status_changed(
    tx: &mut PgConnection,
    party: &str,
    host: &str,
    members: &[String],
    status: &str,
) -> Result<(), ApiError> {
    let mut target = Map::new();
    target.insert("partyId".into(), json!(party));
    let notice = notify::system(
        "party_status",
        if status == "cancelled" {
            "ตี้ถูกยกเลิกแล้ว"
        } else {
            "ตี้นี้สิ้นสุดแล้ว"
        },
        "แตะเพื่อดูรายละเอียดกิจกรรม",
        target,
    );
    let key = format!("party-status:{party}:{status}");
    for member in members.iter().filter(|m| *m != host) {
        notify::enqueue(tx, member, &key, &notice).await?;
    }
    let users: Vec<&str> = members.iter().map(String::as_str).collect();
    events::publish(tx, &users, "parties", Some(party)).await
}

pub async fn cancel(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let mut tx = state.db.begin().await?;
    let party = lock_party(&mut tx, party_id)
        .await?
        .ok_or_else(|| ApiError::new("permission-denied", "เจ้าของตี้เท่านั้นที่ยกเลิกได้"))?;
    if party.host != user.uid {
        return Err(ApiError::new("permission-denied", "เจ้าของตี้เท่านั้นที่ยกเลิกได้"));
    }
    if party.status != "open" {
        return Err(ApiError::new("failed-precondition", "ตี้นี้ไม่ได้เปิดรับแล้ว"));
    }
    sqlx::query(
        "UPDATE parties SET status='cancelled',cancelled_at=now(),updated_at=now() WHERE id=$1",
    )
    .bind(party_id)
    .execute(&mut *tx)
    .await?;
    status_changed(&mut tx, party_id, &party.host, &party.members, "cancelled").await?;
    tx.commit().await?;
    Ok(json!({"status":"cancelled"}))
}

fn valid_b64(value: &Value, size: usize) -> bool {
    value.as_str().is_some_and(|text| {
        text.len() <= 64 && STANDARD.decode(text).is_ok_and(|bytes| bytes.len() == size)
    })
}

fn valid_envelope(envelope: &Value) -> bool {
    envelope.as_object().is_some_and(|raw| {
        raw.len() == 4
            && raw
                .get("senderDeviceId")
                .and_then(Value::as_str)
                .is_some_and(|id| crate::chat::identifier(id, 128))
            && valid_b64(&raw["senderPublicKey"], 32)
            && valid_b64(&raw["nonce"], 24)
            && valid_b64(&raw["ciphertext"], 48)
    })
}

/// Grants must name exactly the members, and for each the exact set of
/// currently published devices (at most five).
async fn validate_grants(
    tx: &mut PgConnection,
    grants: &Value,
    members: &[String],
) -> Result<(), ApiError> {
    let incomplete = || ApiError::new("failed-precondition", "ข้อมูลกุญแจกลุ่มของสมาชิกไม่ครบ");
    let grants = grants.as_object().ok_or_else(incomplete)?;
    let wanted: BTreeSet<&str> = members.iter().map(String::as_str).collect();
    let given: BTreeSet<&str> = grants.keys().map(String::as_str).collect();
    if wanted != given {
        return Err(incomplete());
    }
    for member in members {
        let devices: Vec<String> = sqlx::query_scalar(
            "SELECT device_id FROM encryption_devices WHERE user_id=$1 ORDER BY device_id LIMIT 5",
        )
        .bind(member)
        .fetch_all(&mut *tx)
        .await?;
        let envelopes = grants[member].as_object().ok_or_else(incomplete)?;
        let envelope_ids: BTreeSet<&str> = envelopes.keys().map(String::as_str).collect();
        let device_ids: BTreeSet<&str> = devices.iter().map(String::as_str).collect();
        if devices.is_empty() || envelope_ids != device_ids {
            return Err(ApiError::new(
                "failed-precondition",
                format!("สมาชิก {member} ยังไม่มีกุญแจอุปกรณ์"),
            ));
        }
        if !envelopes.values().all(valid_envelope) {
            return Err(ApiError::new(
                "failed-precondition",
                format!("กุญแจของสมาชิก {member} ไม่ครบ"),
            ));
        }
    }
    Ok(())
}

fn chat_title(party: &sqlx::postgres::PgRow) -> String {
    let schedule: Value = party.get("schedule");
    let location: Value = party.get("location");
    let host: Value = party.get("host");
    let date: String = schedule["date"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(10)
        .collect();
    let time: String = schedule["startTime"]
        .as_str()
        .unwrap_or_default()
        .chars()
        .take(5)
        .collect();
    let place: String = if location["kind"] == "google" {
        String::new()
    } else {
        location["name"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(80)
            .collect()
    };
    let place = if place.is_empty() {
        format!("ตี้ {date} {time}")
    } else {
        place
    };
    let host_name: String = host["name"]
        .as_str()
        .unwrap_or("เพื่อนใน ม.อ.")
        .chars()
        .take(60)
        .collect();
    format!("{place} · โดย {host_name}")
}

async fn create_chat(
    tx: &mut PgConnection,
    party_id: &str,
    host: &str,
    members: &[String],
    grants: &Value,
) -> Result<(), ApiError> {
    let row = sqlx::query("SELECT schedule,location,host FROM parties WHERE id=$1")
        .bind(party_id)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO group_chats(party_id,host_id,title) VALUES($1,$2,$3)")
        .bind(party_id)
        .bind(host)
        .bind(chat_title(&row))
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO group_members(party_id,user_id) SELECT $1,unnest($2::text[])")
        .bind(party_id)
        .bind(members)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO group_epochs(party_id,epoch,key_envelopes) VALUES($1,0,$2)")
        .bind(party_id)
        .bind(grants)
        .execute(&mut *tx)
        .await?;
    Ok(())
}

pub async fn approve(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let requester = id_arg(&data, "requesterId", "ผู้ขอเข้าร่วม")?;
    let mut tx = state.db.begin().await?;
    auth::lock_business_session(&mut tx, headers, &user.uid).await?;
    let party = lock_party(&mut tx, party_id)
        .await?
        .ok_or_else(|| ApiError::new("failed-precondition", "ตี้นี้ไม่ได้เปิดรับแล้ว"))?;
    assert_open(&party)?;
    if party.host != user.uid {
        return Err(ApiError::new("permission-denied", "เจ้าของตี้เท่านั้นที่อนุมัติได้"));
    }
    let status: Option<String> = sqlx::query_scalar(
        "SELECT status FROM party_requests WHERE party_id=$1 AND requester_id=$2 FOR UPDATE",
    )
    .bind(party_id)
    .bind(requester)
    .fetch_optional(&mut *tx)
    .await?;
    if status.as_deref() != Some("pending") {
        return Err(ApiError::new("failed-precondition", "คำขอนี้ไม่รออนุมัติแล้ว"));
    }
    if party.members.iter().any(|m| m == requester) {
        return Err(ApiError::new("already-exists", "สมาชิกอยู่ในตี้แล้ว"));
    }
    if party.members.len() as i32 >= party.max_people {
        return Err(ApiError::new("resource-exhausted", "ตี้เต็มแล้ว"));
    }
    let chat = sqlx::query(
        "SELECT epoch_count,rekey_required FROM group_chats WHERE party_id=$1 FOR UPDATE",
    )
    .bind(party_id)
    .fetch_optional(&mut *tx)
    .await?;
    let mut next = party.members.clone();
    next.push(requester.to_owned());
    match chat {
        None => {
            validate_grants(&mut tx, &data["initialGrants"], &next).await?;
            create_chat(
                &mut tx,
                party_id,
                &party.host,
                &next,
                &data["initialGrants"],
            )
            .await?;
        }
        Some(chat) => {
            if chat.get::<bool, _>("rekey_required") {
                return Err(ApiError::new(
                    "failed-precondition",
                    "กำลังเปลี่ยนกุญแจกลุ่ม กรุณาลองใหม่",
                ));
            }
            let count: i32 = chat.get("epoch_count");
            let supplied = data["epochGrants"].as_object().cloned().unwrap_or_default();
            if supplied.len() != count as usize {
                return Err(ApiError::new(
                    "failed-precondition",
                    "กุญแจประวัติแชตทุกช่วงไม่ครบ",
                ));
            }
            for epoch in 0..count {
                let grant = supplied
                    .get(&epoch.to_string())
                    .cloned()
                    .unwrap_or(Value::Null);
                validate_grants(
                    &mut tx,
                    &json!({ requester: grant.clone() }),
                    &[requester.to_owned()],
                )
                .await?;
                let envelopes: Value = sqlx::query_scalar("SELECT key_envelopes FROM group_epochs WHERE party_id=$1 AND epoch=$2 FOR UPDATE")
                    .bind(party_id).bind(epoch).fetch_optional(&mut *tx).await?
                    .ok_or_else(|| ApiError::new("failed-precondition", "ไม่พบกุญแจประวัติแชตบางช่วง"))?;
                if envelopes.get(&party.host).is_none() {
                    return Err(ApiError::new(
                        "failed-precondition",
                        "เจ้าของตี้ไม่มีกุญแจประวัติแชตครบ",
                    ));
                }
                sqlx::query("UPDATE group_epochs SET key_envelopes=key_envelopes||jsonb_build_object($3::text,$4::jsonb) WHERE party_id=$1 AND epoch=$2")
                    .bind(party_id).bind(epoch).bind(requester).bind(grant).execute(&mut *tx).await?;
            }
            sqlx::query(
                "INSERT INTO group_members(party_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            )
            .bind(party_id)
            .bind(requester)
            .execute(&mut *tx)
            .await?;
            sqlx::query("UPDATE group_chats SET updated_at=now() WHERE party_id=$1")
                .bind(party_id)
                .execute(&mut *tx)
                .await?;
        }
    }
    let (name, avatar, _) = card(&mut tx, requester, "ผู้ใช้ ม.อ.").await?;
    sqlx::query("INSERT INTO party_members(party_id,user_id,position,name,avatar_uri) VALUES($1,$2,$3,$4,$5)")
        .bind(party_id).bind(requester).bind(next.len() as i32 - 1).bind(name).bind(avatar).execute(&mut *tx).await?;
    sqlx::query("UPDATE parties SET updated_at=now() WHERE id=$1")
        .bind(party_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE party_requests SET status='approved',updated_at=now() WHERE party_id=$1 AND requester_id=$2")
        .bind(party_id).bind(requester).execute(&mut *tx).await?;
    request_changed(&mut tx, party_id, requester, "approved").await?;
    let users: Vec<&str> = next.iter().map(String::as_str).collect();
    events::publish(&mut tx, &users, "parties", Some(party_id)).await?;
    events::publish(&mut tx, &users, "group-messages", Some(party_id)).await?;
    tx.commit().await?;
    Ok(json!({"status":"approved","groupChatId":party_id}))
}

pub async fn activate_legacy(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let mut tx = state.db.begin().await?;
    let party = lock_party(&mut tx, party_id)
        .await?
        .ok_or_else(|| ApiError::new("permission-denied", "เปิดแชตสำหรับตี้นี้ไม่ได้"))?;
    if party.host != user.uid || !party.legacy || party.members.len() < 2 {
        return Err(ApiError::new("permission-denied", "เปิดแชตสำหรับตี้นี้ไม่ได้"));
    }
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM group_chats WHERE party_id=$1)")
            .bind(party_id)
            .fetch_one(&mut *tx)
            .await?;
    if exists {
        tx.commit().await?;
        return Ok(json!({"groupChatId":party_id,"activated":false}));
    }
    validate_grants(&mut tx, &data["initialGrants"], &party.members).await?;
    create_chat(
        &mut tx,
        party_id,
        &party.host,
        &party.members,
        &data["initialGrants"],
    )
    .await?;
    sqlx::query("UPDATE parties SET chat_activation_required=false,updated_at=now() WHERE id=$1")
        .bind(party_id)
        .execute(&mut *tx)
        .await?;
    let users: Vec<&str> = party.members.iter().map(String::as_str).collect();
    events::publish(&mut tx, &users, "group-messages", Some(party_id)).await?;
    tx.commit().await?;
    Ok(json!({"groupChatId":party_id,"activated":true}))
}

pub async fn leave(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let mut tx = state.db.begin().await?;
    let party = lock_party(&mut tx, party_id)
        .await?
        .ok_or_else(|| ApiError::new("failed-precondition", "คุณไม่ได้อยู่ในตี้นี้"))?;
    if !party.members.contains(&user.uid) {
        return Err(ApiError::new("failed-precondition", "คุณไม่ได้อยู่ในตี้นี้"));
    }
    if party.host == user.uid {
        return Err(ApiError::new(
            "failed-precondition",
            "เจ้าของตี้ต้องยกเลิกตี้แทนการออก",
        ));
    }
    sqlx::query("DELETE FROM party_members WHERE party_id=$1 AND user_id=$2")
        .bind(party_id)
        .bind(&user.uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE parties SET updated_at=now() WHERE id=$1")
        .bind(party_id)
        .execute(&mut *tx)
        .await?;
    let removed = sqlx::query("DELETE FROM group_members WHERE party_id=$1 AND user_id=$2")
        .bind(party_id)
        .bind(&user.uid)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if removed > 0 {
        // Remaining members must rotate to a key the leaver does not hold.
        sqlx::query(
            "UPDATE group_chats SET rekey_required=true,updated_at=now() WHERE party_id=$1",
        )
        .bind(party_id)
        .execute(&mut *tx)
        .await?;
    }
    let users: Vec<&str> = party.members.iter().map(String::as_str).collect();
    events::publish(&mut tx, &users, "parties", Some(party_id)).await?;
    events::publish(&mut tx, &users, "group-messages", Some(party_id)).await?;
    tx.commit().await?;
    Ok(json!({"status":"left"}))
}

async fn group_members(tx: &mut PgConnection, party: &str) -> Result<Vec<String>, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT user_id FROM group_members WHERE party_id=$1 ORDER BY user_id")
            .bind(party)
            .fetch_all(&mut *tx)
            .await?,
    )
}

pub async fn rotate_key(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let mut tx = state.db.begin().await?;
    let chat = sqlx::query("SELECT current_epoch,epoch_count,rekey_required FROM group_chats WHERE party_id=$1 FOR UPDATE")
        .bind(party_id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| ApiError::new("permission-denied", "คุณไม่ได้อยู่ในแชตกลุ่ม"))?;
    let members = group_members(&mut tx, party_id).await?;
    if !members.contains(&user.uid) {
        return Err(ApiError::new("permission-denied", "คุณไม่ได้อยู่ในแชตกลุ่ม"));
    }
    if !chat.get::<bool, _>("rekey_required") {
        tx.commit().await?;
        return Ok(json!({"epoch":chat.get::<i32,_>("current_epoch")}));
    }
    let epoch: i32 = chat.get("epoch_count");
    if epoch >= 100 {
        return Err(ApiError::new("resource-exhausted", "ประวัติกุญแจกลุ่มเต็ม"));
    }
    validate_grants(&mut tx, &data["grants"], &members).await?;
    sqlx::query("INSERT INTO group_epochs(party_id,epoch,key_envelopes) VALUES($1,$2,$3)")
        .bind(party_id)
        .bind(epoch)
        .bind(&data["grants"])
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE group_chats SET current_epoch=$2,epoch_count=$2+1,rekey_required=false,updated_at=now() WHERE party_id=$1")
        .bind(party_id).bind(epoch).execute(&mut *tx).await?;
    let users: Vec<&str> = members.iter().map(String::as_str).collect();
    events::publish(&mut tx, &users, "group-messages", Some(party_id)).await?;
    tx.commit().await?;
    Ok(json!({"epoch":epoch}))
}

/// Membership gate for group reads and media tickets. `writable` also
/// requires that no key rotation is pending.
pub async fn require_group_member(
    state: &AppState,
    headers: &HeaderMap,
    uid: &str,
    party: &str,
    writable: bool,
) -> Result<(), ApiError> {
    let mut connection = state.db.acquire().await?;
    let current = auth::reauthorize_session(&mut connection, headers).await?;
    if current.uid != uid {
        return Err(ApiError::unauthenticated());
    }
    let row = sqlx::query("SELECT g.rekey_required FROM group_chats g JOIN group_members m ON m.party_id=g.party_id AND m.user_id=$2 WHERE g.party_id=$1")
        .bind(party).bind(uid).fetch_optional(&mut *connection).await?
        .ok_or_else(|| ApiError::new("permission-denied", "คุณไม่ได้เป็นผู้ร่วมสนทนาในห้องนี้"))?;
    if writable && row.get::<bool, _>("rekey_required") {
        return Err(ApiError::new(
            "permission-denied",
            "กำลังเปลี่ยนกุญแจกลุ่ม กรุณาลองใหม่",
        ));
    }
    Ok(())
}

/// Device keys for chat members (and, for the host, pending requesters).
pub async fn encryption_profiles(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "กิจกรรม")?;
    let ids: Vec<String> = data["userIds"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter_map(|v| v.as_str().map(str::to_owned))
        .collect();
    if ids.len() > 50 || ids.iter().any(|id| !crate::chat::identifier(id, 128)) {
        return Err(ApiError::invalid("รายการผู้ใช้ไม่ถูกต้อง"));
    }
    let mut tx = state.db.begin().await?;
    let party = lock_party(&mut tx, party_id)
        .await?
        .ok_or_else(|| ApiError::new("permission-denied", "ไม่พบสิทธิ์ในกิจกรรมนี้"))?;
    if !party.members.contains(&user.uid) {
        return Err(ApiError::new("permission-denied", "ไม่พบสิทธิ์ในกิจกรรมนี้"));
    }
    for id in &ids {
        if party.members.contains(id) {
            continue;
        }
        let pending: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM party_requests WHERE party_id=$1 AND requester_id=$2 AND status='pending')")
            .bind(party_id).bind(id).fetch_one(&mut *tx).await?;
        if party.host != user.uid || party.status != "open" || !pending {
            return Err(ApiError::new("permission-denied", "สมาชิกไม่อยู่ในกิจกรรม"));
        }
    }
    let mut profiles = Vec::new();
    for id in ids.iter().collect::<BTreeSet<_>>() {
        let rows = sqlx::query("SELECT device_id,public_key FROM encryption_devices WHERE user_id=$1 ORDER BY device_id LIMIT 5")
            .bind(id).fetch_all(&mut *tx).await?;
        let devices: Map<String, Value> = rows
            .iter()
            .map(|r| {
                (
                    r.get::<String, _>("device_id"),
                    json!({"publicKey":r.get::<String,_>("public_key")}),
                )
            })
            .collect();
        profiles.push(json!({"id":id,"encryptionDevices":devices}));
    }
    tx.commit().await?;
    Ok(json!({"profiles":profiles}))
}

const PARTY_COLUMNS: &str = "p.id,p.host_id,p.host,p.location,p.schedule,p.max_people,p.status,p.legacy,p.chat_activation_required,
    (extract(epoch FROM p.starts_at)*1000)::bigint AS starts_ms,(extract(epoch FROM p.created_at)*1000)::bigint AS created_ms,
    (extract(epoch FROM p.updated_at)*1000)::bigint AS updated_ms,(extract(epoch FROM p.cancelled_at)*1000)::bigint AS cancelled_ms";

async fn parties_json(
    connection: &mut PgConnection,
    rows: Vec<sqlx::postgres::PgRow>,
) -> Result<Vec<Value>, ApiError> {
    let ids: Vec<String> = rows.iter().map(|r| r.get("id")).collect();
    let members = sqlx::query("SELECT party_id,user_id,name,avatar_uri FROM party_members WHERE party_id=ANY($1) ORDER BY position,joined_at")
        .bind(&ids).fetch_all(&mut *connection).await?;
    Ok(rows.iter().map(|row| {
        let id: String = row.get("id");
        let list: Vec<&sqlx::postgres::PgRow> = members.iter().filter(|m| m.get::<String, _>("party_id") == id).collect();
        let mut schedule: Value = row.get("schedule");
        if schedule["startsAt"].is_null() {
            schedule["startsAt"] = json!(row.get::<i64,_>("starts_ms"));
        }
        json!({
            "id": id, "hostId": row.get::<String,_>("host_id"), "host": row.get::<Value,_>("host"),
            "location": row.get::<Value,_>("location"), "schedule": schedule,
            "maxPeople": row.get::<i32,_>("max_people"), "status": row.get::<String,_>("status"),
            "legacy": row.get::<bool,_>("legacy"), "chatActivationRequired": row.get::<bool,_>("chat_activation_required"),
            "memberIds": list.iter().map(|m| m.get::<String,_>("user_id")).collect::<Vec<_>>(),
            "members": list.iter().map(|m| json!({"id":m.get::<String,_>("user_id"),"name":m.get::<String,_>("name"),"avatarUri":m.get::<String,_>("avatar_uri")})).collect::<Vec<_>>(),
            "memberCount": list.len(),
            "createdAt": row.get::<i64,_>("created_ms"), "updatedAt": row.get::<i64,_>("updated_ms"),
            "cancelledAt": row.get::<Option<i64>,_>("cancelled_ms"),
        })
    }).collect())
}

/// `scope`: `open` (future open parties), `mine` (parties I am in from the
/// last day), `legacyActivation` (my legacy parties needing a chat) or `one`.
pub async fn list(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let limit = data["limit"].as_i64().unwrap_or(30).clamp(1, 200);
    let mut connection = state.db.acquire().await?;
    let rows = match data["scope"].as_str().unwrap_or("open") {
        "open" => sqlx::query(&format!("SELECT {PARTY_COLUMNS} FROM parties p WHERE p.status='open' AND p.starts_at>=now() ORDER BY p.starts_at LIMIT $1"))
            .bind(limit + 1).fetch_all(&mut *connection).await?,
        "mine" => sqlx::query(&format!("SELECT {PARTY_COLUMNS} FROM parties p JOIN party_members m ON m.party_id=p.id AND m.user_id=$1 WHERE p.starts_at>=now()-interval '1 day' ORDER BY p.starts_at LIMIT $2"))
            .bind(&user.uid).bind(limit + 1).fetch_all(&mut *connection).await?,
        "legacyActivation" => sqlx::query(&format!("SELECT {PARTY_COLUMNS} FROM parties p WHERE p.host_id=$1 AND p.chat_activation_required AND p.legacy LIMIT 30"))
            .bind(&user.uid).fetch_all(&mut *connection).await?,
        "one" => {
            let id = id_arg(&data, "partyId", "ตี้")?;
            sqlx::query(&format!("SELECT {PARTY_COLUMNS} FROM parties p WHERE p.id=$1")).bind(id).fetch_all(&mut *connection).await?
        }
        _ => return Err(ApiError::invalid("ประเภทรายการไม่ถูกต้อง")),
    };
    let has_more = rows.len() as i64 > limit;
    let rows = rows.into_iter().take(limit as usize).collect();
    Ok(json!({"parties": parties_json(&mut connection, rows).await?, "hasMore": has_more}))
}

fn request_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "partyId": row.get::<String,_>("party_id"), "requesterId": row.get::<String,_>("requester_id"),
        "hostId": row.get::<String,_>("host_id"), "requesterName": row.get::<String,_>("requester_name"),
        "avatarUri": row.get::<String,_>("avatar_uri"), "requesterAvatarUri": row.get::<String,_>("avatar_uri"),
        "status": row.get::<String,_>("status"), "createdAt": row.get::<i64,_>("created_ms"), "updatedAt": row.get::<i64,_>("updated_ms"),
    })
}
const REQUEST_COLUMNS: &str = "party_id,requester_id,host_id,requester_name,avatar_uri,status,
    (extract(epoch FROM created_at)*1000)::bigint AS created_ms,(extract(epoch FROM updated_at)*1000)::bigint AS updated_ms";

/// `scope`: `mine` (my pending requests), `hosted` (pending requests to my
/// party `partyId`) or `one` (my request for `partyId`).
pub async fn requests(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let limit = data["limit"].as_i64().unwrap_or(30).clamp(1, 200);
    let rows = match data["scope"].as_str().unwrap_or("mine") {
        "mine" => sqlx::query(&format!("SELECT {REQUEST_COLUMNS} FROM party_requests WHERE requester_id=$1 AND status='pending' ORDER BY updated_at DESC LIMIT $2"))
            .bind(&user.uid).bind(limit + 1).fetch_all(&state.db).await?,
        "hosted" => {
            let id = id_arg(&data, "partyId", "ตี้")?;
            sqlx::query(&format!("SELECT {REQUEST_COLUMNS} FROM party_requests WHERE party_id=$1 AND host_id=$2 AND status='pending' ORDER BY updated_at LIMIT $3"))
                .bind(id).bind(&user.uid).bind(limit + 1).fetch_all(&state.db).await?
        }
        "one" => {
            let id = id_arg(&data, "partyId", "ตี้")?;
            sqlx::query(&format!("SELECT {REQUEST_COLUMNS} FROM party_requests WHERE party_id=$1 AND requester_id=$2"))
                .bind(id).bind(&user.uid).fetch_all(&state.db).await?
        }
        _ => return Err(ApiError::invalid("ประเภทรายการไม่ถูกต้อง")),
    };
    let has_more = rows.len() as i64 > limit;
    Ok(
        json!({"requests": rows.iter().take(limit as usize).map(request_json).collect::<Vec<_>>(), "hasMore": has_more}),
    )
}

fn chat_json(row: &sqlx::postgres::PgRow, members: Vec<String>) -> Value {
    json!({
        "id": row.get::<String,_>("party_id"), "partyId": row.get::<String,_>("party_id"),
        "hostId": row.get::<String,_>("host_id"), "title": row.get::<String,_>("title"),
        "avatarUri": row.get::<String,_>("avatar_uri"),
        "memberCount": members.len(), "memberIds": members,
        "currentEpoch": row.get::<i32,_>("current_epoch"), "epochCount": row.get::<i32,_>("epoch_count"),
        "rekeyRequired": row.get::<bool,_>("rekey_required"),
        "lastMessageId": row.get::<Option<String>,_>("last_message_id"),
        "lastMessageSenderId": row.get::<Option<String>,_>("last_sender_id"),
        "lastMessageType": row.get::<Option<String>,_>("last_type"),
        "lastMessageAt": row.get::<Option<i64>,_>("last_ms"),
        "createdAt": row.get::<i64,_>("created_ms"), "updatedAt": row.get::<i64,_>("updated_ms"),
    })
}
const CHAT_COLUMNS: &str = "g.party_id,g.host_id,g.title,g.avatar_uri,g.current_epoch,g.epoch_count,g.rekey_required,g.last_message_id,g.last_sender_id,
    (SELECT type FROM group_messages x WHERE x.party_id=g.party_id AND x.id=g.last_message_id) AS last_type,
    (extract(epoch FROM g.last_message_at)*1000)::bigint AS last_ms,(extract(epoch FROM g.created_at)*1000)::bigint AS created_ms,
    (extract(epoch FROM g.updated_at)*1000)::bigint AS updated_ms";

/// My group chats (newest activity first), or one chat with `partyId`.
pub async fn chats(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let limit = data["limit"].as_i64().unwrap_or(20).clamp(1, 200);
    let mut connection = state.db.acquire().await?;
    let rows = if let Some(id) = data["partyId"].as_str() {
        sqlx::query(&format!("SELECT {CHAT_COLUMNS} FROM group_chats g JOIN group_members m ON m.party_id=g.party_id AND m.user_id=$1 WHERE g.party_id=$2"))
            .bind(&user.uid).bind(id).fetch_all(&mut *connection).await?
    } else {
        sqlx::query(&format!("SELECT {CHAT_COLUMNS} FROM group_chats g JOIN group_members m ON m.party_id=g.party_id AND m.user_id=$1 ORDER BY g.updated_at DESC LIMIT $2"))
            .bind(&user.uid).bind(limit + 1).fetch_all(&mut *connection).await?
    };
    let has_more = rows.len() as i64 > limit;
    let mut out = Vec::new();
    for row in rows.into_iter().take(limit as usize) {
        let members = group_members(&mut connection, &row.get::<String, _>("party_id")).await?;
        out.push(chat_json(&row, members));
    }
    let reads = sqlx::query("SELECT party_id,message_id,(extract(epoch FROM last_read_message_at)*1000)::bigint AS read_ms FROM group_reads WHERE user_id=$1")
        .bind(&user.uid).fetch_all(&mut *connection).await?;
    let reads: Map<String, Value> = reads
        .iter()
        .map(|r| {
            (
                r.get::<String, _>("party_id"),
                json!({
        "partyId": r.get::<String,_>("party_id"), "messageId": r.get::<String,_>("message_id"),
        "lastReadMessageAt": r.get::<i64,_>("read_ms")}),
            )
        })
        .collect();
    Ok(json!({"chats":out,"hasMore":has_more,"reads":reads}))
}

/// Epoch envelopes, read receipts and a message page for one chat.
pub async fn messages(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    crate::throttle(&state.db, "group-messages", &user.uid, 240).await?;
    require_group_member(state, headers, &user.uid, party_id, false).await?;
    let before = data["beforeSequence"].as_i64().filter(|n| *n > 0);
    let mut rows = sqlx::query("SELECT id,sender_id,epoch,type,nonce,ciphertext,sequence,(extract(epoch FROM created_at)*1000)::bigint AS at FROM group_messages WHERE party_id=$1 AND ($2::bigint IS NULL OR sequence<$2) ORDER BY sequence DESC LIMIT 101")
        .bind(party_id).bind(before).fetch_all(&state.db).await?;
    let has_more = rows.len() > 100;
    rows.truncate(100);
    let oldest = rows.last().map(|r| r.get::<i64, _>("sequence"));
    let messages: Vec<Value> = rows.iter().map(|r| json!({
        "id": r.get::<String,_>("id"), "senderId": r.get::<String,_>("sender_id"), "epoch": r.get::<i32,_>("epoch"),
        "type": r.get::<String,_>("type"), "encrypted": true, "nonce": r.get::<String,_>("nonce"),
        "ciphertext": r.get::<String,_>("ciphertext"), "createdAt": r.get::<i64,_>("at"), "sequence": r.get::<i64,_>("sequence"),
    })).collect();
    let mut result = json!({"messages":messages,"hasMore":has_more,"beforeSequence":oldest});
    if before.is_none() {
        let epochs = sqlx::query(
            "SELECT epoch,key_envelopes FROM group_epochs WHERE party_id=$1 ORDER BY epoch",
        )
        .bind(party_id)
        .fetch_all(&state.db)
        .await?;
        // A member receives only their own envelopes, never other members' wrapped keys.
        result["epochs"] = json!(epochs.iter().map(|r| {
            let envelopes: Value = r.get("key_envelopes");
            json!({"id": r.get::<i32,_>("epoch").to_string(), "epoch": r.get::<i32,_>("epoch"),
                "keyEnvelopes": {user.uid.clone(): envelopes.get(&user.uid).cloned().unwrap_or(Value::Null)}})
        }).collect::<Vec<_>>());
        let receipts = sqlx::query("SELECT user_id,message_id,(extract(epoch FROM last_read_message_at)*1000)::bigint AS read_ms FROM group_reads WHERE party_id=$1")
            .bind(party_id).fetch_all(&state.db).await?;
        result["readReceipts"] = Value::Object(receipts.iter().map(|r| (r.get::<String,_>("user_id"), json!({
            "partyId": party_id, "messageId": r.get::<String,_>("message_id"), "lastReadMessageAt": r.get::<i64,_>("read_ms")}))).collect());
    }
    Ok(result)
}

pub async fn send(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let message_id = id_arg(&data, "id", "ข้อความ")?;
    let record = &data["record"];
    let kind = record["type"]
        .as_str()
        .filter(|t| ["text", "image", "audio", "gif", "track"].contains(t))
        .ok_or_else(|| ApiError::invalid("ข้อความไม่ถูกต้อง"))?;
    let nonce = record["nonce"]
        .as_str()
        .filter(|n| n.len() == 32 && valid_b64(&json!(n), 24))
        .ok_or_else(|| ApiError::invalid("ข้อความไม่ถูกต้อง"))?;
    let ciphertext = record["ciphertext"]
        .as_str()
        .filter(|c| !c.is_empty() && c.len() <= 20_000 && STANDARD.decode(c).is_ok())
        .ok_or_else(|| ApiError::invalid("ข้อความไม่ถูกต้อง"))?;
    let previous = data["previousCiphertext"].as_str();
    let epoch = record["epoch"]
        .as_i64()
        .ok_or_else(|| ApiError::invalid("ข้อความไม่ถูกต้อง"))?;
    if record["encrypted"] != true {
        return Err(ApiError::invalid("ข้อความไม่ถูกต้อง"));
    }
    crate::throttle(&state.db, "group-send", &user.uid, 120).await?;
    let mut tx = state.db.begin().await?;
    let account: Option<bool> = sqlx::query_scalar(
        "SELECT NOT suspended AND deleted_at IS NULL FROM accounts WHERE id=$1 FOR SHARE",
    )
    .bind(&user.uid)
    .fetch_optional(&mut *tx)
    .await?;
    if account != Some(true) || auth::reauthorize_session(&mut tx, headers).await?.uid != user.uid {
        return Err(ApiError::unauthenticated());
    }
    let chat = sqlx::query(
        "SELECT current_epoch,rekey_required FROM group_chats WHERE party_id=$1 FOR UPDATE",
    )
    .bind(party_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::new("permission-denied", "คุณไม่ได้อยู่ในแชตกลุ่ม"))?;
    let members = group_members(&mut tx, party_id).await?;
    if !members.contains(&user.uid) {
        return Err(ApiError::new("permission-denied", "คุณไม่ได้อยู่ในแชตกลุ่ม"));
    }
    let existing =
        sqlx::query("SELECT sender_id,ciphertext FROM group_messages WHERE party_id=$1 AND id=$2")
            .bind(party_id)
            .bind(message_id)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(row) = existing {
        let stored: String = row.get("ciphertext");
        if row.get::<String, _>("sender_id") != user.uid
            || (stored != ciphertext && Some(stored.as_str()) != previous)
        {
            return Err(ApiError::new("already-exists", "Message ID conflict"));
        }
        tx.commit().await?;
        return Ok(json!({"duplicate":true}));
    }
    if chat.get::<bool, _>("rekey_required")
        || i64::from(chat.get::<i32, _>("current_epoch")) != epoch
    {
        return Err(ApiError::new(
            "failed-precondition",
            "กุญแจกลุ่มเปลี่ยนแล้ว กรุณาลองอีกครั้ง",
        ));
    }
    let at: i64 = sqlx::query_scalar("INSERT INTO group_messages(party_id,id,sender_id,epoch,type,nonce,ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING (extract(epoch FROM created_at)*1000)::bigint")
        .bind(party_id).bind(message_id).bind(&user.uid).bind(epoch as i32).bind(kind).bind(nonce).bind(ciphertext)
        .fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE group_chats SET last_message_id=$2,last_message_at=now(),last_sender_id=$3,updated_at=now() WHERE party_id=$1")
        .bind(party_id).bind(message_id).bind(&user.uid).execute(&mut *tx).await?;
    let notice = notify::group_message(party_id, message_id, kind);
    for member in members.iter().filter(|m| **m != user.uid) {
        notify::enqueue(
            &mut tx,
            member,
            &format!("group:{party_id}:{message_id}"),
            &notice,
        )
        .await?;
    }
    let users: Vec<&str> = members.iter().map(String::as_str).collect();
    events::publish(&mut tx, &users, "group-messages", Some(party_id)).await?;
    tx.commit().await?;
    Ok(json!({"duplicate":false,"createdAt":at}))
}

pub async fn mark_read(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let message_id = id_arg(&data, "messageId", "ข้อความ")?;
    require_group_member(state, headers, &user.uid, party_id, false).await?;
    let mut tx = state.db.begin().await?;
    let at: Option<chrono::DateTime<Utc>> =
        sqlx::query_scalar("SELECT created_at FROM group_messages WHERE party_id=$1 AND id=$2")
            .bind(party_id)
            .bind(message_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(at) = at else {
        return Ok(json!({"ok":false}));
    };
    sqlx::query("INSERT INTO group_reads(party_id,user_id,message_id,last_read_message_at) VALUES($1,$2,$3,$4) ON CONFLICT(party_id,user_id) DO UPDATE SET message_id=excluded.message_id,last_read_message_at=excluded.last_read_message_at,updated_at=now() WHERE group_reads.last_read_message_at<=excluded.last_read_message_at")
        .bind(party_id).bind(&user.uid).bind(message_id).bind(at).execute(&mut *tx).await?;
    let members = group_members(&mut tx, party_id).await?;
    let users: Vec<&str> = members.iter().map(String::as_str).collect();
    events::publish(&mut tx, &users, "group-messages", Some(party_id)).await?;
    tx.commit().await?;
    Ok(json!({"ok":true}))
}

/// Host-only group name and profile photo. The photo must be a profile image this user uploaded.
pub async fn update_profile(
    state: &AppState,
    headers: &HeaderMap,
    data: Value,
) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    let party_id = id_arg(&data, "partyId", "ตี้")?;
    let title = data["title"].as_str().unwrap_or_default().trim();
    if title.chars().count() < 1
        || title.chars().count() > 80
        || title.chars().any(|c| c.is_control())
    {
        return Err(ApiError::invalid("ชื่อกลุ่มต้องมี 1-80 ตัวอักษร"));
    }
    let avatar = data["avatarUri"].as_str().unwrap_or_default().trim();
    if avatar.len() > 2000
        || (!avatar.is_empty() && !crate::media::owned_profile_url(state, avatar, &user.uid))
    {
        return Err(ApiError::invalid("รูปกลุ่มต้องเป็นรูปที่คุณอัปโหลด"));
    }
    let updated = sqlx::query(
        "UPDATE group_chats SET title=$3, avatar_uri=$4, updated_at=now() \
         WHERE party_id=$1 AND host_id=$2 RETURNING party_id",
    )
    .bind(party_id)
    .bind(&user.uid)
    .bind(title)
    .bind(avatar)
    .fetch_optional(&state.db)
    .await?;
    if updated.is_none() {
        return Err(ApiError::new(
            "permission-denied",
            "เฉพาะคนสร้างตี้ที่แก้ไขชื่อและรูปกลุ่มได้",
        ));
    }
    Ok(json!({ "partyId": party_id, "title": title, "avatarUri": avatar }))
}

/// Legacy `expirePastParties`: open parties whose start time has passed.
pub async fn expire(pool: &sqlx::PgPool) -> Result<u64, ApiError> {
    let mut tx = pool.begin().await?;
    let rows = sqlx::query("UPDATE parties SET status='expired',updated_at=now() WHERE id IN (SELECT id FROM parties WHERE status='open' AND starts_at<=now() ORDER BY starts_at LIMIT 200 FOR UPDATE SKIP LOCKED) RETURNING id,host_id")
        .fetch_all(&mut *tx).await?;
    for row in &rows {
        let id: String = row.get("id");
        let host: String = row.get("host_id");
        let members: Vec<String> =
            sqlx::query_scalar("SELECT user_id FROM party_members WHERE party_id=$1")
                .bind(&id)
                .fetch_all(&mut *tx)
                .await?;
        status_changed(&mut tx, &id, &host, &members, "expired").await?;
    }
    tx.commit().await?;
    Ok(rows.len() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn campus_radius_and_schedule_rules() {
        assert!(valid_point(7.008453, 100.497914));
        assert!(!valid_point(13.7563, 100.5018));
        let now = 1_700_000_000_000;
        assert!(schedule_from(
            &json!({"date":"2099-01-01","startTime":"10:00","endTime":"11:00"}),
            now
        )
        .is_ok());
        assert!(schedule_from(
            &json!({"date":"2099-02-30","startTime":"10:00","endTime":"11:00"}),
            now
        )
        .is_err());
        assert!(schedule_from(
            &json!({"date":"2099-01-01","startTime":"11:00","endTime":"10:00"}),
            now
        )
        .is_err());
        assert!(schedule_from(
            &json!({"date":"2000-01-01","startTime":"10:00","endTime":"11:00"}),
            now
        )
        .is_err());
        let (schedule, starts, _) = schedule_from(
            &json!({"date":"2099-01-01","startTime":"10:00","endTime":"11:00"}),
            now,
        )
        .unwrap();
        assert_eq!(schedule["startsAt"], starts);
    }

    #[test]
    fn envelopes_require_exact_shape() {
        let key = STANDARD.encode([1; 32]);
        let good = json!({"senderDeviceId":"phone","senderPublicKey":key,"nonce":STANDARD.encode([1;24]),"ciphertext":STANDARD.encode([1;48])});
        assert!(valid_envelope(&good));
        let mut extra = good.clone();
        extra["secretKey"] = json!("x");
        assert!(!valid_envelope(&extra));
    }
}
