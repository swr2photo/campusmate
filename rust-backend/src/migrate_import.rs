//! Turns a staged Firestore export (`migration_documents`) into live rows.
//!
//! Runs inside the importer's single locked transaction, after accounts were
//! staged from Auth. Every collection is converted with the same allowlists
//! the API enforces; anything that does not validate is skipped and counted,
//! never activated. Ciphertext is copied verbatim (the server cannot read it).
use std::collections::{BTreeMap, HashMap, HashSet};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Map, Value};
use sqlx::{PgConnection, Row};

const PROFILE_FIELDS: &[&str] = &[
    "name",
    "nickname",
    "bio",
    "faculty",
    "year",
    "age",
    "gender",
    "activities",
    "activity",
    "activityLabel",
    "interests",
    "tags",
    "skill",
    "pace",
    "activityDetails",
    "availability",
    "availabilitySlots",
    "privacy",
    "avatarUri",
    "avatar",
    "avatarColor",
    "gallery",
    "favoriteTracks",
    "meetup",
    "matchingPreferences",
    "locationEnabled",
    "latitude",
    "longitude",
    "locationUpdatedAt",
    "avatarRevision",
    "compatibility",
    "spotifyTopArtists",
    "spotifyTopGenres",
    "studentId",
    "notificationsEnabled",
    "consentAcceptedAt",
];

#[derive(Default)]
pub struct Report {
    counts: BTreeMap<&'static str, u64>,
    skipped: BTreeMap<&'static str, u64>,
}
impl Report {
    fn ok(&mut self, kind: &'static str) {
        *self.counts.entry(kind).or_default() += 1;
    }
    fn skip(&mut self, kind: &'static str) {
        *self.skipped.entry(kind).or_default() += 1;
    }
    pub fn json(&self) -> Value {
        json!({"imported": self.counts, "skipped": self.skipped})
    }
}

/// A staged document: path segments and data.
struct Doc {
    segments: Vec<String>,
    data: Value,
    created: Option<i64>,
}

async fn documents(tx: &mut PgConnection) -> Result<Vec<Doc>, sqlx::Error> {
    let rows = sqlx::query("SELECT substr(path,11) AS path,data FROM migration_documents WHERE path LIKE 'firestore/%' ORDER BY path")
        .fetch_all(&mut *tx)
        .await?;
    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let path: String = row.get("path");
            let raw: Value = row.get("data");
            let data = raw.get("data").cloned().filter(Value::is_object)?;
            Some(Doc {
                segments: path.split('/').map(str::to_owned).collect(),
                data,
                created: raw["create_time_ms"].as_i64(),
            })
        })
        .collect())
}

fn ms(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|v| v as i64))
        .filter(|v| *v > 0)
}

fn uid_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn b64_len(value: &Value, size: usize) -> bool {
    value
        .as_str()
        .is_some_and(|s| STANDARD.decode(s).is_ok_and(|bytes| bytes.len() == size))
}

/// Allowlisted profile, validated exactly like `PUT` profile writes; fields
/// that fail are dropped one by one rather than rejecting the whole profile.
pub fn profile_from_user(data: &Value) -> Value {
    let mut out = Map::new();
    for key in PROFILE_FIELDS {
        if let Some(value) = data.get(*key).filter(|v| !v.is_null()) {
            let mut candidate = out.clone();
            candidate.insert((*key).to_owned(), value.clone());
            if crate::profiles::validate_profile(&Value::Object(candidate)).is_ok() {
                out.insert((*key).to_owned(), value.clone());
            }
        }
    }
    Value::Object(out)
}

/// Firebase Storage gallery URLs lose their access token in the export; point
/// them at the profile media origin where the copy tool places the objects.
pub fn rewrite_gallery(profile: &mut Value, uid: &str, media_origin: Option<&str>) {
    let Some(origin) = media_origin else { return };
    let Some(gallery) = profile.get_mut("gallery").and_then(Value::as_array_mut) else {
        return;
    };
    for entry in gallery.iter_mut() {
        let Some(url) = entry.as_str() else { continue };
        if !url.starts_with("https://firebasestorage.googleapis.com/") {
            continue;
        }
        let Some(object) = url
            .split("/o/")
            .nth(1)
            .map(|rest| rest.split('?').next().unwrap_or(rest))
        else {
            continue;
        };
        let decoded = object.replace("%2F", "/").replace("%2f", "/");
        let prefix = format!("profile_gallery/{uid}/");
        if decoded.starts_with(&prefix)
            && decoded[prefix.len()..]
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.' || b == b'_')
        {
            *entry = json!(format!("{origin}/{decoded}"));
        }
    }
}

fn message_meta(record: &Value) -> Value {
    let mut meta = Map::new();
    for key in [
        "videoMode",
        "videoDuration",
        "videoStartMs",
        "videoEndMs",
        "viewMode",
        "callType",
        "callDuration",
        "callStatus",
        "callTime",
        "forwardedFrom",
    ] {
        if let Some(value) = record.get(key).filter(|v| !v.is_null()) {
            meta.insert(key.into(), value.clone());
        }
    }
    for key in ["isSystem", "forwarded"] {
        if record[key] == true {
            meta.insert(key.into(), json!(true));
        }
    }
    // Keep only what the live API would accept.
    crate::rooms::message_meta(Some(&Value::Object(meta.clone()))).unwrap_or_else(|_| {
        let mut safe = Map::new();
        for (key, value) in meta {
            let single = json!({ key.clone(): value.clone() });
            if crate::rooms::message_meta(Some(&single)).is_ok() {
                safe.insert(key, value);
            }
        }
        Value::Object(safe)
    })
}

fn encrypted_record(record: &Value) -> Option<Value> {
    if record["encrypted"] != true || record["encryptionVersion"].as_i64() != Some(1) {
        return None;
    }
    if !b64_len(&record["nonce"], 24) {
        return None;
    }
    let ciphertext = record["ciphertext"].as_str()?;
    let bytes = STANDARD.decode(ciphertext).ok()?;
    if bytes.len() < 17 || bytes.len() > 64 * 1024 {
        return None;
    }
    Some(
        json!({"encrypted":true,"encryptionVersion":1,"nonce":record["nonce"],"ciphertext":ciphertext}),
    )
}

fn string_map(value: &Value, max: usize) -> Value {
    Value::Object(
        value
            .as_object()
            .map(|m| {
                m.iter()
                    .filter(|(k, v)| {
                        uid_ok(k) && v.as_str().is_some_and(|s| s.chars().count() <= max)
                    })
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect()
            })
            .unwrap_or_default(),
    )
}

pub async fn transform(
    tx: &mut PgConnection,
    media_origin: Option<&str>,
) -> Result<Value, sqlx::Error> {
    let docs = documents(tx).await?;
    let mut report = Report::default();
    let accounts: HashSet<String> = sqlx::query_scalar("SELECT id FROM accounts")
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .collect();
    let exists = |uid: &str| accounts.contains(uid);
    // Top-level documents of one collection.
    let by = |collection: &str, depth: usize| -> Vec<&Doc> {
        docs.iter()
            .filter(|d| d.segments.len() == depth && d.segments[0] == collection)
            .collect()
    };

    // Credentials: legacy password and Google subject from the Auth export.
    let auth = sqlx::query("SELECT data FROM migration_documents WHERE path LIKE 'auth/%'")
        .fetch_all(&mut *tx)
        .await?;
    for row in auth {
        let user: Value = row.get("data");
        let Some(uid) = user["uid"].as_str() else {
            continue;
        };
        let providers = user["providers"].as_array().cloned().unwrap_or_default();
        let password = providers.iter().any(|p| p["providerId"] == "password");
        let google = providers
            .iter()
            .find(|p| p["providerId"] == "google.com")
            .and_then(|p| p["uid"].as_str())
            .map(str::to_owned);
        let display: String = user["displayName"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .filter(|c| !c.is_control())
            .take(200)
            .collect();
        let last = user["metadata"]["lastSignInTime"].as_i64();
        let created = user["metadata"]["creationTime"].as_i64();
        sqlx::query("UPDATE accounts SET legacy_password=$2,google_subject=$3,display_name=$4,last_sign_in_at=CASE WHEN $5::bigint IS NULL THEN NULL ELSE to_timestamp($5::double precision/1000) END,created_at=COALESCE(to_timestamp($6::double precision/1000),created_at) WHERE id=$1")
            .bind(uid).bind(password).bind(google).bind(display).bind(last).bind(created).execute(&mut *tx).await?;
    }

    // Profiles, visibility, device keys.
    let visibility: HashMap<String, String> = by("profileVisibility", 2)
        .iter()
        .filter_map(|d| Some((d.segments[1].clone(), d.data["mode"].as_str()?.to_owned())))
        .collect();
    for doc in by("users", 2) {
        let uid = &doc.segments[1];
        if !exists(uid) {
            report.skip("users");
            continue;
        }
        let mut profile = profile_from_user(&doc.data);
        rewrite_gallery(&mut profile, uid, media_origin);
        let mode = visibility
            .get(uid)
            .map(String::as_str)
            .filter(|m| ["public", "incognito", "hidden"].contains(m))
            .unwrap_or("public");
        let is_new = doc.data["isNewUser"] == true
            || profile.get("name").is_none()
            || profile.get("age").is_none();
        sqlx::query("UPDATE profiles SET raw=$2,face_verified=$3,discoverable=$4,is_new=$5,visibility=$6,revision=revision+1,updated_at=now() WHERE user_id=$1")
            .bind(uid).bind(&profile).bind(doc.data["isFaceVerified"] == true).bind(doc.data["isDiscoverable"] != false).bind(is_new).bind(mode)
            .execute(&mut *tx).await?;
        report.ok("profiles");
        if let Some(devices) = doc.data["encryptionDevices"].as_object() {
            for (device, value) in devices.iter().take(5) {
                let key = value.get("publicKey").unwrap_or(value);
                if crate::chat::identifier(device, 128) && b64_len(key, 32) {
                    sqlx::query("INSERT INTO encryption_devices(user_id,device_id,public_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING")
                        .bind(uid).bind(device).bind(key.as_str()).execute(&mut *tx).await?;
                    report.ok("encryptionDevices");
                }
            }
        }
    }
    for doc in by("entitlements", 2) {
        let uid = &doc.segments[1];
        if !exists(uid) {
            continue;
        }
        let mut record = doc.data.clone();
        // Admin flags are not imported; admins are granted in the console.
        if let Some(object) = record.as_object_mut() {
            for key in ["isAdmin", "isSuperAdmin", "role", "syncGeneration"] {
                object.remove(key);
            }
        }
        sqlx::query("INSERT INTO entitlements(user_id,record) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET record=excluded.record")
            .bind(uid).bind(record).execute(&mut *tx).await?;
        report.ok("entitlements");
    }
    for doc in docs.iter().filter(|d| {
        d.segments.len() == 4 && d.segments[0] == "users" && d.segments[2] == "blockedUsers"
    }) {
        let (actor, target) = (&doc.segments[1], &doc.segments[3]);
        if exists(actor) && exists(target) && actor != target {
            sqlx::query(
                "INSERT INTO blocks(actor_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            )
            .bind(actor)
            .bind(target)
            .execute(&mut *tx)
            .await?;
            report.ok("blocks");
        }
    }

    // Decisions (likes/skips) keep their status and timing.
    for doc in by("decisions", 2) {
        let (Some(from), Some(to)) = (
            doc.data["fromUserId"].as_str(),
            doc.data["toUserId"].as_str(),
        ) else {
            report.skip("decisions");
            continue;
        };
        let kind = doc.data["type"].as_str().unwrap_or_default();
        let status = doc.data["status"].as_str().unwrap_or("pending");
        if !exists(from)
            || !exists(to)
            || from == to
            || !["like", "skip"].contains(&kind)
            || !["pending", "accepted", "rejected", "removed"].contains(&status)
        {
            report.skip("decisions");
            continue;
        }
        let message: String = doc.data["likeMessage"]
            .as_str()
            .unwrap_or_default()
            .chars()
            .take(1000)
            .collect();
        let action = doc.data["lastActionId"]
            .as_str()
            .and_then(|v| uuid::Uuid::parse_str(v).ok());
        let created = ms(&doc.data["createdAt"]).or(doc.created);
        let updated = ms(&doc.data["updatedAt"]).or(created);
        sqlx::query("INSERT INTO decisions(actor_id,target_id,kind,status,message,last_action_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,COALESCE(to_timestamp($7::double precision/1000),now()),COALESCE(to_timestamp($8::double precision/1000),now())) ON CONFLICT DO NOTHING")
            .bind(from).bind(to).bind(kind).bind(status).bind(message).bind(action).bind(created).bind(updated).execute(&mut *tx).await?;
        report.ok("decisions");
    }

    // Direct rooms, member state and encrypted history.
    for doc in by("conversations", 2) {
        let id = &doc.segments[1];
        let participants: Vec<String> = doc.data["participants"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        if participants.len() != 2
            || participants[0] == participants[1]
            || !participants.iter().all(|p| exists(p))
            || !crate::chat::identifier(id, 259)
        {
            report.skip("conversations");
            continue;
        }
        let mut pair = participants.clone();
        pair.sort();
        let encryption = doc
            .data
            .get("encryption")
            .filter(|e| e.is_object())
            .cloned();
        let created = ms(&doc.data["createdAt"]).or(doc.created);
        let updated = ms(&doc.data["updatedAt"]).or(created);
        let inserted = sqlx::query("INSERT INTO conversations(id,member_a,member_b,active,encryption,created_at,updated_at) VALUES($1,$2,$3,false,$4,COALESCE(to_timestamp($5::double precision/1000),now()),COALESCE(to_timestamp($6::double precision/1000),now())) ON CONFLICT DO NOTHING")
            .bind(id).bind(&pair[0]).bind(&pair[1]).bind(encryption).bind(created).bind(updated).execute(&mut *tx).await?.rows_affected();
        if inserted == 0 {
            report.skip("conversations");
            continue;
        }
        report.ok("conversations");
        let accepted: Vec<String> = doc.data["meetupAcceptedUsers"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        for member in &participants {
            let settings = &doc.data["participantSettings"][member];
            let cleared = ms(&settings["historyClearedAt"]).or_else(|| ms(&settings["hiddenAt"]));
            let read = ms(&doc.data["readReceipts"][member]);
            let unread = doc.data["unreadCounts"][member]
                .as_i64()
                .unwrap_or(0)
                .clamp(0, 100_000) as i32;
            sqlx::query("UPDATE conversation_members SET hidden=$3,muted=$4,show_pinned_meetup=$5,history_cleared_at=CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6::double precision/1000) END,unread=$7,read_at=CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8::double precision/1000) END,meetup_accepted=$9 WHERE conversation_id=$1 AND user_id=$2")
                .bind(id).bind(member).bind(settings["isHidden"] == true).bind(settings["isMuted"] == true).bind(settings["showPinnedMeetup"] != false)
                .bind(cleared).bind(unread).bind(read).bind(accepted.contains(member)).execute(&mut *tx).await?;
        }
        // Legacy root-array history first, then the message subcollection.
        let mut messages: Vec<(String, Value, i64)> = Vec::new();
        for (index, record) in doc.data["messages"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let at = ms(&record["createdAt"])
                .or_else(|| ms(&record["time"]))
                .unwrap_or(0);
            let sender = record["senderId"].as_str().unwrap_or("unknown");
            let message_id = record["id"]
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("{id}-m-{at}-{sender}-{index}"));
            messages.push((message_id, record.clone(), at));
        }
        for message in docs.iter().filter(|d| {
            d.segments.len() == 4
                && d.segments[0] == "conversations"
                && d.segments[1] == *id
                && d.segments[2] == "messages"
        }) {
            let at = ms(&message.data["createdAt"])
                .or_else(|| ms(&message.data["time"]))
                .or(message.created)
                .unwrap_or(0);
            messages.push((message.segments[3].clone(), message.data.clone(), at));
        }
        messages.sort_by_key(|(_, _, at)| *at);
        for (message_id, record, at) in messages {
            let sender = record["senderId"].as_str().unwrap_or_default();
            let Some(packet) = encrypted_record(&record) else {
                report.skip("messages:not-encrypted");
                continue;
            };
            if !participants.iter().any(|p| p == sender)
                || !crate::chat::identifier(&message_id, 128)
                || at <= 0
            {
                report.skip("messages");
                continue;
            }
            let hidden: Vec<String> = match &record["hiddenFor"] {
                Value::Array(list) => list
                    .iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect(),
                Value::Object(map) => map
                    .iter()
                    .filter(|(_, v)| **v == Value::Bool(true))
                    .map(|(k, _)| k.clone())
                    .collect(),
                _ => Vec::new(),
            };
            let reaction_times: Map<String, Value> = record["reactionTimes"]
                .as_object()
                .map(|m| {
                    m.iter()
                        .filter_map(|(k, v)| Some((k.clone(), json!(ms(v)?))))
                        .collect()
                })
                .unwrap_or_default();
            let inserted = sqlx::query("INSERT INTO encrypted_messages(conversation_id,id,sender_id,ciphertext,meta,reactions,reaction_times,hidden_for,client_sent_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,to_timestamp($9::double precision/1000),to_timestamp($9::double precision/1000)) ON CONFLICT DO NOTHING")
                .bind(id).bind(&message_id).bind(sender).bind(packet).bind(message_meta(&record)).bind(string_map(&record["reactions"], 16))
                .bind(Value::Object(reaction_times)).bind(hidden).bind(at).execute(&mut *tx).await?.rows_affected();
            if inserted == 0 {
                report.skip("messages:duplicate");
                continue;
            }
            report.ok("messages");
            for view in docs.iter().filter(|d| {
                d.segments.len() == 6
                    && d.segments[1] == *id
                    && d.segments[3] == message_id
                    && d.segments[4] == "videoViews"
            }) {
                if participants.contains(&view.segments[5]) {
                    sqlx::query("INSERT INTO message_views(conversation_id,message_id,viewer_id,views) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING")
                        .bind(id).bind(&message_id).bind(&view.segments[5]).execute(&mut *tx).await?;
                }
            }
            for rendition in docs.iter().filter(|d| {
                d.segments.len() == 6
                    && d.segments[1] == *id
                    && d.segments[3] == message_id
                    && d.segments[4] == "videoRenditions"
            }) {
                if ["high", "medium"].contains(&rendition.segments[5].as_str())
                    && encrypted_record(&rendition.data).is_some()
                {
                    sqlx::query("INSERT INTO message_renditions(conversation_id,message_id,quality,data) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING")
                        .bind(id).bind(&message_id).bind(&rendition.segments[5]).bind(&rendition.data).execute(&mut *tx).await?;
                }
            }
        }
    }
    // A room is open only while both sides still hold an accepted like.
    sqlx::query("UPDATE conversations c SET active=true WHERE EXISTS(SELECT 1 FROM decisions d WHERE ((d.actor_id=c.member_a AND d.target_id=c.member_b) OR (d.actor_id=c.member_b AND d.target_id=c.member_a)) AND d.kind='like' AND d.status='accepted') AND NOT EXISTS(SELECT 1 FROM decisions d WHERE ((d.actor_id=c.member_a AND d.target_id=c.member_b) OR (d.actor_id=c.member_b AND d.target_id=c.member_a)) AND d.status IN ('removed','rejected')) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.actor_id=c.member_a AND b.target_id=c.member_b) OR (b.actor_id=c.member_b AND b.target_id=c.member_a))")
        .execute(&mut *tx).await?;

    for doc in by("appointments", 2) {
        let d = &doc.data;
        let (Some(conversation), Some(host), Some(guest)) = (
            d["conversationId"].as_str(),
            d["hostId"].as_str(),
            d["guestId"].as_str(),
        ) else {
            report.skip("appointments");
            continue;
        };
        let status = if d["status"] == "cancelled" {
            "cancelled"
        } else {
            "active"
        };
        let result = sqlx::query("INSERT INTO appointments(id,conversation_id,host_id,guest_id,meetup,scheduled_for,status,cancelled_by,cancelled_at,created_at,updated_at) SELECT $1,$2,$3,$4,$5,CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6::double precision/1000) END,$7,$8,CASE WHEN $9::bigint IS NULL THEN NULL ELSE to_timestamp($9::double precision/1000) END,now(),now() WHERE EXISTS(SELECT 1 FROM conversations WHERE id=$2) AND $3<>$4 ON CONFLICT DO NOTHING")
            .bind(&doc.segments[1]).bind(conversation).bind(host).bind(guest).bind(d.get("meetup").filter(|m| m.is_object()).cloned().unwrap_or(json!({})))
            .bind(ms(&d["scheduledFor"])).bind(status).bind(d["cancelledBy"].as_str().filter(|u| exists(u))).bind(ms(&d["cancelledAt"]))
            .execute(&mut *tx).await?;
        if result.rows_affected() == 1 {
            report.ok("appointments")
        } else {
            report.skip("appointments")
        }
    }

    for doc in docs.iter().filter(|d| {
        d.segments.len() == 4 && d.segments[0] == "users" && d.segments[2] == "notifications"
    }) {
        let (uid, id) = (&doc.segments[1], &doc.segments[3]);
        let d = &doc.data;
        if !exists(uid) || !uid_ok(id) {
            continue;
        }
        let mut target = Map::new();
        for key in [
            "conversationId",
            "messageId",
            "partyId",
            "appointmentId",
            "route",
        ] {
            if let Some(value) = d["target"][key].as_str() {
                target.insert(
                    key.into(),
                    json!(value.chars().take(200).collect::<String>()),
                );
            }
        }
        sqlx::query("INSERT INTO notifications(user_id,id,type,title,body,target,status,read_at,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $8::bigint IS NULL THEN NULL ELSE to_timestamp($8::double precision/1000) END,COALESCE(to_timestamp($9::double precision/1000),now()),CASE WHEN $10::bigint IS NULL THEN NULL ELSE to_timestamp($10::double precision/1000) END) ON CONFLICT DO NOTHING")
            .bind(uid).bind(id).bind(d["type"].as_str().unwrap_or("system").chars().take(60).collect::<String>())
            .bind(d["title"].as_str().unwrap_or("CampusMate").chars().take(180).collect::<String>())
            .bind(d["body"].as_str().unwrap_or_default().chars().take(2000).collect::<String>())
            .bind(Value::Object(target)).bind(d["status"].as_str()).bind(ms(&d["readAt"])).bind(ms(&d["createdAt"]).or(doc.created)).bind(ms(&d["expiresAt"]))
            .execute(&mut *tx).await?;
        report.ok("notifications");
    }

    for doc in by("reports", 2) {
        let d = &doc.data;
        let Some(reporter) = d["reporterId"].as_str().filter(|u| exists(u)) else {
            report.skip("reports");
            continue;
        };
        let status = d["status"]
            .as_str()
            .filter(|s| ["pending", "reviewing", "resolved", "dismissed"].contains(s))
            .unwrap_or("pending");
        let cut = |key: &str, max: usize| {
            d[key]
                .as_str()
                .map(|s| s.chars().take(max).collect::<String>())
                .filter(|s| !s.is_empty())
        };
        sqlx::query("INSERT INTO reports(reporter_id,reported_user_id,conversation_id,message_id,media_url,message_text,reason,details,status,resolution,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE(to_timestamp($11::double precision/1000),now()),now())")
            .bind(reporter).bind(d["reportedUserId"].as_str().filter(|u| exists(u))).bind(cut("conversationId", 259)).bind(cut("messageId", 128))
            .bind(cut("mediaUrl", 2048)).bind(cut("messageText", 2000)).bind(cut("reason", 100).unwrap_or_else(|| "other".into())).bind(cut("details", 2000).unwrap_or_default())
            .bind(status).bind(json!({"note": cut("reviewNote", 2000), "legacyId": doc.segments[1]})).bind(ms(&d["createdAt"]).or(doc.created))
            .execute(&mut *tx).await?;
        report.ok("reports");
    }

    for doc in by("spots", 2) {
        sqlx::query("INSERT INTO spots(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data")
            .bind(&doc.segments[1]).bind(&doc.data).execute(&mut *tx).await?;
        report.ok("spots");
    }
    for doc in by("app_config", 2) {
        sqlx::query("INSERT INTO app_config(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=excluded.data")
            .bind(&doc.segments[1]).bind(&doc.data).execute(&mut *tx).await?;
        report.ok("appConfig");
    }

    // Parties, requests and encrypted group chats.
    for doc in by("parties", 2) {
        let (id, d) = (&doc.segments[1], &doc.data);
        let Some(host) = d["hostId"].as_str().filter(|h| exists(h)) else {
            report.skip("parties");
            continue;
        };
        let (Some(starts), Some(ends)) = (
            ms(&d["schedule"]["startsAt"]),
            ms(&d["schedule"]["endsAt"]).or_else(|| ms(&d["schedule"]["startsAt"])),
        ) else {
            report.skip("parties");
            continue;
        };
        let status = d["status"]
            .as_str()
            .filter(|s| ["open", "cancelled", "expired", "closed"].contains(s))
            .unwrap_or("closed");
        let max_people = d["maxPeople"].as_i64().unwrap_or(2).clamp(2, 50) as i32;
        let inserted = sqlx::query("INSERT INTO parties(id,host_id,host,location,schedule,starts_at,ends_at,max_people,status,legacy,chat_activation_required,created_at,updated_at) VALUES($1,$2,$3,$4,$5,to_timestamp($6::double precision/1000),to_timestamp($7::double precision/1000),$8,$9,$10,$11,COALESCE(to_timestamp($12::double precision/1000),now()),now()) ON CONFLICT DO NOTHING")
            .bind(id).bind(host).bind(d.get("host").filter(|v| v.is_object()).cloned().unwrap_or(json!({})))
            .bind(d.get("location").filter(|v| v.is_object()).cloned().unwrap_or(json!({}))).bind(d.get("schedule").filter(|v| v.is_object()).cloned().unwrap_or(json!({})))
            .bind(starts).bind(ends).bind(max_people).bind(status).bind(d["legacy"] == true).bind(d["chatActivationRequired"] == true).bind(ms(&d["createdAt"]).or(doc.created))
            .execute(&mut *tx).await?.rows_affected();
        if inserted == 0 {
            report.skip("parties");
            continue;
        }
        report.ok("parties");
        let cards: HashMap<String, Value> = d["members"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|m| Some((m["id"].as_str()?.to_owned(), m)))
            .collect();
        for (position, member) in d["memberIds"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|v| v.as_str())
            .filter(|u| exists(u))
            .enumerate()
        {
            let card = cards.get(member).cloned().unwrap_or(Value::Null);
            sqlx::query("INSERT INTO party_members(party_id,user_id,position,name,avatar_uri) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING")
                .bind(id).bind(member).bind(position as i32).bind(card["name"].as_str().unwrap_or_default().chars().take(100).collect::<String>())
                .bind(card["avatarUri"].as_str().unwrap_or_default().chars().take(5000).collect::<String>()).execute(&mut *tx).await?;
        }
        for request in docs.iter().filter(|r| {
            r.segments.len() == 4
                && r.segments[0] == "parties"
                && r.segments[1] == *id
                && r.segments[2] == "requests"
        }) {
            let r = &request.data;
            let requester = &request.segments[3];
            let status = r["status"]
                .as_str()
                .filter(|s| ["pending", "approved", "rejected", "withdrawn"].contains(s));
            if let (true, Some(status)) = (exists(requester), status) {
                sqlx::query("INSERT INTO party_requests(party_id,requester_id,host_id,requester_name,avatar_uri,status) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING")
                    .bind(id).bind(requester).bind(host).bind(r["requesterName"].as_str().unwrap_or_default().chars().take(100).collect::<String>())
                    .bind(r["avatarUri"].as_str().unwrap_or_default().chars().take(5000).collect::<String>()).bind(status).execute(&mut *tx).await?;
            }
        }
    }
    for doc in by("groupChats", 2) {
        let (id, d) = (&doc.segments[1], &doc.data);
        let Some(host) = d["hostId"].as_str().filter(|h| exists(h)) else {
            continue;
        };
        let epoch_count = d["epochCount"].as_i64().unwrap_or(1).clamp(1, 100) as i32;
        let inserted = sqlx::query("INSERT INTO group_chats(party_id,host_id,title,current_epoch,epoch_count,rekey_required) SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM parties WHERE id=$1) ON CONFLICT DO NOTHING")
            .bind(id).bind(host).bind(d["title"].as_str().unwrap_or_default().chars().take(300).collect::<String>())
            .bind(d["currentEpoch"].as_i64().unwrap_or(0).clamp(0, 99) as i32).bind(epoch_count).bind(d["rekeyRequired"] == true)
            .execute(&mut *tx).await?.rows_affected();
        if inserted == 0 {
            report.skip("groupChats");
            continue;
        }
        report.ok("groupChats");
        for member in d["memberIds"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(|v| v.as_str())
            .filter(|u| exists(u))
        {
            sqlx::query(
                "INSERT INTO group_members(party_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
            )
            .bind(id)
            .bind(member)
            .execute(&mut *tx)
            .await?;
        }
        let children: Vec<&Doc> = docs
            .iter()
            .filter(|c| {
                c.segments.len() == 4 && c.segments[0] == "groupChats" && c.segments[1] == *id
            })
            .collect();
        for epoch in children.iter().filter(|c| c.segments[2] == "epochs") {
            if let (Ok(number), Some(envelopes)) = (
                epoch.segments[3].parse::<i32>(),
                epoch.data.get("keyEnvelopes").filter(|v| v.is_object()),
            ) {
                sqlx::query("INSERT INTO group_epochs(party_id,epoch,key_envelopes) VALUES($1,$2,$3) ON CONFLICT DO NOTHING").bind(id).bind(number).bind(envelopes).execute(&mut *tx).await?;
            }
        }
        let mut messages: Vec<&&Doc> = children
            .iter()
            .filter(|c| c.segments[2] == "messages")
            .collect();
        messages.sort_by_key(|m| ms(&m.data["createdAt"]).or(m.created).unwrap_or(0));
        for message in messages {
            let m = &message.data;
            let ok = m["encrypted"] == true
                && m["nonce"].as_str().is_some_and(|n| n.len() == 32)
                && m["ciphertext"]
                    .as_str()
                    .is_some_and(|c| !c.is_empty() && c.len() <= 20_000)
                && ["text", "image"].contains(&m["type"].as_str().unwrap_or_default())
                && m["senderId"].as_str().is_some_and(exists)
                && uid_ok(&message.segments[3]);
            if !ok {
                report.skip("groupMessages");
                continue;
            }
            sqlx::query("INSERT INTO group_messages(party_id,id,sender_id,epoch,type,nonce,ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE(to_timestamp($8::double precision/1000),now())) ON CONFLICT DO NOTHING")
                .bind(id).bind(&message.segments[3]).bind(m["senderId"].as_str()).bind(m["epoch"].as_i64().unwrap_or(0).clamp(0, 99) as i32)
                .bind(m["type"].as_str()).bind(m["nonce"].as_str()).bind(m["ciphertext"].as_str()).bind(ms(&m["createdAt"]).or(message.created))
                .execute(&mut *tx).await?;
            report.ok("groupMessages");
        }
        for read in children.iter().filter(|c| c.segments[2] == "readReceipts") {
            if let (true, Some(message), Some(at)) = (
                exists(&read.segments[3]),
                read.data["messageId"].as_str(),
                ms(&read.data["lastReadMessageAt"]),
            ) {
                sqlx::query("INSERT INTO group_reads(party_id,user_id,message_id,last_read_message_at) SELECT $1,$2,$3,to_timestamp($4::double precision/1000) WHERE EXISTS(SELECT 1 FROM group_members WHERE party_id=$1 AND user_id=$2) ON CONFLICT DO NOTHING")
                    .bind(id).bind(&read.segments[3]).bind(message).bind(at).execute(&mut *tx).await?;
            }
        }
        sqlx::query("UPDATE group_chats g SET last_message_id=m.id,last_message_at=m.created_at,last_sender_id=m.sender_id FROM (SELECT id,created_at,sender_id FROM group_messages WHERE party_id=$1 ORDER BY sequence DESC LIMIT 1) m WHERE g.party_id=$1")
            .bind(id).execute(&mut *tx).await?;
    }
    for doc in by("revenueCatEvents", 2) {
        sqlx::query("INSERT INTO revenuecat_events(id,type) VALUES($1,$2) ON CONFLICT DO NOTHING")
            .bind(doc.segments[1].chars().take(200).collect::<String>())
            .bind(doc.data["type"].as_str().unwrap_or("UNKNOWN"))
            .execute(&mut *tx)
            .await?;
    }
    Ok(report.json())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profiles_keep_only_valid_allowlisted_fields() {
        let profile = profile_from_user(
            &json!({"name":"A","age":21,"email":"x@y","isFaceVerified":true,"role":"admin","bio":"b".repeat(2000),"latitude":7.0}),
        );
        assert_eq!(profile, json!({"name":"A","age":21,"latitude":7.0}));
    }

    #[test]
    fn gallery_urls_move_to_the_media_origin() {
        let mut profile = json!({"gallery":[
            "https://firebasestorage.googleapis.com/v0/b/x/o/profile_gallery%2Falice%2Fa1.jpg?alt=media",
            "https://firebasestorage.googleapis.com/v0/b/x/o/profile_gallery%2Fbob%2Fb.jpg?alt=media",
            "https://images.example/users/alice/avatar.jpg"]});
        rewrite_gallery(&mut profile, "alice", Some("https://images.example"));
        assert_eq!(
            profile["gallery"][0],
            "https://images.example/profile_gallery/alice/a1.jpg"
        );
        assert!(profile["gallery"][1]
            .as_str()
            .unwrap()
            .starts_with("https://firebasestorage"));
        assert_eq!(
            profile["gallery"][2],
            "https://images.example/users/alice/avatar.jpg"
        );
    }

    #[test]
    fn only_versioned_ciphertext_is_imported() {
        let good = json!({"encrypted":true,"encryptionVersion":1,"nonce":STANDARD.encode([1;24]),"ciphertext":STANDARD.encode([1;40]),"text":"never"});
        assert!(encrypted_record(&good).unwrap().get("text").is_none());
        assert!(encrypted_record(&json!({"text":"plain"})).is_none());
        assert_eq!(
            message_meta(
                &json!({"videoMode":"once","isSystem":true,"preview":"x","forwardedFrom":{"bad":1}})
            ),
            json!({"videoMode":"once","isSystem":true})
        );
    }
}
