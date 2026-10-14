use crate::{auth::authenticate, error::ApiError, policy, AppState};
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SaveProfile {
    pub revision: i64,
    pub profile: Value,
}

pub async fn me(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let row = sqlx::query(
        "SELECT raw,revision,face_verified,discoverable,is_new FROM profiles WHERE user_id=$1",
    )
    .bind(&principal.uid)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(
        json!({"id":principal.uid,"profile":row.get::<Value,_>("raw"),"revision":row.get::<i64,_>("revision"),
        "isFaceVerified":row.get::<bool,_>("face_verified"),"isDiscoverable":row.get::<bool,_>("discoverable"),"isNewUser":row.get::<bool,_>("is_new")}),
    ))
}

pub fn validate_profile(profile: &Value) -> Result<(), ApiError> {
    let raw = profile
        .as_object()
        .ok_or_else(|| ApiError::invalid("ข้อมูลโปรไฟล์ไม่ถูกต้อง"))?;
    const KEYS: &[&str] = &[
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
    if raw.keys().any(|key| !KEYS.contains(&key.as_str())) {
        return Err(ApiError::invalid("มีฟิลด์ที่ไม่ได้รับอนุญาต"));
    }
    if serde_json::to_vec(profile)
        .map_err(|_| ApiError::invalid("โปรไฟล์ไม่ถูกต้อง"))?
        .len()
        > 32_768
    {
        return Err(ApiError::invalid("ข้อมูลโปรไฟล์มากเกินไป"));
    }
    for key in [
        "name",
        "nickname",
        "faculty",
        "year",
        "gender",
        "activity",
        "activityLabel",
        "skill",
        "pace",
        "availability",
        "avatar",
        "avatarColor",
    ] {
        if raw
            .get(key)
            .is_some_and(|v| v.as_str().is_none_or(|s| s.chars().count() > 120))
        {
            return Err(ApiError::invalid("ข้อความโปรไฟล์ไม่ถูกต้อง"));
        }
    }
    if raw
        .get("bio")
        .is_some_and(|v| v.as_str().is_none_or(|s| s.chars().count() > 1000))
    {
        return Err(ApiError::invalid("ข้อความแนะนำตัวไม่ถูกต้อง"));
    }
    if raw
        .get("age")
        .is_some_and(|v| v.as_u64().is_none_or(|age| !(18..=100).contains(&age)))
    {
        return Err(ApiError::invalid("อายุต้องอยู่ระหว่าง 18 ถึง 100 ปี"));
    }
    // Lists hold strings; the app also stores small objects in activities.
    for key in ["activities", "interests", "tags", "gallery"] {
        if raw.get(key).is_some_and(|v| {
            v.as_array().is_none_or(|a| {
                a.len() > 50
                    || a.iter().any(|x| {
                        x.as_str().is_none_or(|s| s.chars().count() > 5000)
                            && (key == "gallery" || !x.is_object())
                    })
            })
        }) {
            return Err(ApiError::invalid("รายการในโปรไฟล์ไม่ถูกต้อง"));
        }
    }
    for key in ["privacy", "activityDetails", "matchingPreferences"] {
        if raw.get(key).is_some_and(|v| !v.is_object()) {
            return Err(ApiError::invalid("การตั้งค่าโปรไฟล์ไม่ถูกต้อง"));
        }
    }
    if raw
        .get("privacy")
        .and_then(Value::as_object)
        .is_some_and(|flags| flags.len() > 30 || flags.values().any(|value| !value.is_boolean()))
    {
        return Err(ApiError::invalid("ค่าความเป็นส่วนตัวต้องเป็น true หรือ false"));
    }
    if raw.get("availabilitySlots").is_some_and(|v| {
        v.as_array().is_none_or(|a| {
            a.len() > 50
                || a.iter()
                    .any(|s| !s.is_object() && s.as_str().is_none_or(|t| t.chars().count() > 200))
        })
    }) {
        return Err(ApiError::invalid("เวลาว่างไม่ถูกต้อง"));
    }
    for (key, min, max) in [("latitude", -90., 90.), ("longitude", -180., 180.)] {
        if raw
            .get(key)
            .is_some_and(|v| v.as_f64().is_none_or(|n| !(min..=max).contains(&n)))
        {
            return Err(ApiError::invalid("พิกัดไม่ถูกต้อง"));
        }
    }
    for key in ["avatarRevision", "locationUpdatedAt", "consentAcceptedAt"] {
        if raw
            .get(key)
            .is_some_and(|v| v.as_i64().is_none_or(|n| n < 0))
        {
            return Err(ApiError::invalid("ข้อมูลเวลาในโปรไฟล์ไม่ถูกต้อง"));
        }
    }
    if raw.get("studentId").is_some_and(|v| {
        v.as_str()
            .is_none_or(|s| s.len() > 10 || !s.bytes().all(|b| b.is_ascii_digit()))
    }) {
        return Err(ApiError::invalid("รหัสนักศึกษาไม่ถูกต้อง"));
    }
    for key in ["spotifyTopArtists", "spotifyTopGenres"] {
        if raw
            .get(key)
            .is_some_and(|v| v.as_array().is_none_or(|a| a.len() > 20))
        {
            return Err(ApiError::invalid("ข้อมูลเพลงในโปรไฟล์ไม่ถูกต้อง"));
        }
    }
    if raw
        .get("notificationsEnabled")
        .is_some_and(|v| !v.is_boolean())
    {
        return Err(ApiError::invalid("การตั้งค่าการแจ้งเตือนไม่ถูกต้อง"));
    }
    if raw.get("locationEnabled").is_some_and(|v| !v.is_boolean()) {
        return Err(ApiError::invalid("การตั้งค่าตำแหน่งไม่ถูกต้อง"));
    }
    Ok(())
}

pub async fn save(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<SaveProfile>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    crate::throttle(&state.db, "profile", &principal.uid, 30).await?;
    validate_profile(&input.profile)?;
    let mut tx = state.db.begin().await?;
    crate::auth::lock_business_session(&mut tx, &headers, &principal.uid).await?;
    // A photo badge covers the photo it was verified against. Replacing that
    // photo revokes the badge and ends any attempt pinned to the old one.
    let previous: Option<String> =
        sqlx::query_scalar("SELECT raw->>'avatarUri' FROM profiles WHERE user_id=$1 FOR UPDATE")
            .bind(&principal.uid)
            .fetch_one(&mut *tx)
            .await?;
    let photo_changed =
        previous.as_deref() != input.profile.get("avatarUri").and_then(Value::as_str);
    if photo_changed {
        crate::identity::revoke_in(
            &mut tx,
            &principal.uid,
            "PHOTO_CHANGED",
            ("user", Some(&principal.uid)),
        )
        .await?;
    }
    let row=sqlx::query("UPDATE profiles SET raw=$2,is_new=NOT($2 ? 'name' AND $2 ? 'age'),revision=revision+1,updated_at=now() WHERE user_id=$1 AND revision=$3 RETURNING revision")
        .bind(&principal.uid).bind(&input.profile).bind(input.revision).fetch_optional(&mut *tx).await?
        .ok_or_else(||ApiError::new("aborted","โปรไฟล์เปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก"))?;
    tx.commit().await?;
    if photo_changed {
        if let Some(services) = state.identity.clone() {
            if crate::identity::purge_snapshots(
                &state.db,
                services.store.as_ref(),
                Some(&principal.uid),
            )
            .await
            .is_err()
            {
                tracing::warn!("verification snapshot purge deferred");
            }
        }
    }
    Ok(Json(json!({"revision":row.get::<i64,_>("revision")})))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Visibility {
    pub mode: String,
    pub discoverable: bool,
}
pub async fn visibility(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<Visibility>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    if !["public", "incognito", "hidden"].contains(&input.mode.as_str()) {
        return Err(ApiError::invalid("รูปแบบการแสดงโปรไฟล์ไม่ถูกต้อง"));
    }
    let mut tx = state.db.begin().await?;
    crate::auth::lock_business_session(&mut tx, &headers, &principal.uid).await?;
    sqlx::query("SELECT user_id FROM profiles WHERE user_id=$1 FOR UPDATE")
        .bind(&principal.uid)
        .fetch_one(&mut *tx)
        .await?;
    let record = sqlx::query_scalar::<_, Value>(
        "SELECT record FROM entitlements WHERE user_id=$1 FOR SHARE",
    )
    .bind(&principal.uid)
    .fetch_optional(&mut *tx)
    .await?;
    if input.mode == "incognito"
        && !policy::has_plan_feature(
            record.as_ref(),
            "incognito",
            chrono::Utc::now().timestamp_millis(),
        )
    {
        return Err(ApiError::plus_required("incognito"));
    }
    sqlx::query("UPDATE profiles SET visibility=$2,discoverable=$3,revision=revision+1,updated_at=now() WHERE user_id=$1")
        .bind(&principal.uid).bind(&input.mode).bind(input.discoverable).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"mode":input.mode,"discoverable":input.discoverable}),
    ))
}

pub async fn block(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    if id == principal.uid
        || id.is_empty()
        || id.chars().count() > 128
        || id.chars().any(char::is_control)
    {
        return Err(ApiError::invalid("ผู้ใช้ไม่ถูกต้อง"));
    }
    crate::throttle(&state.db, "blocks", &principal.uid, 30).await?;
    let mut tx = state.db.begin().await?;
    crate::matching::lock_pair(&mut tx, &principal.uid, &id).await?;
    crate::auth::lock_business_session(&mut tx, &headers, &principal.uid).await?;
    let exists = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM accounts WHERE id=$1 AND deleted_at IS NULL)",
    )
    .bind(&id)
    .fetch_one(&mut *tx)
    .await?;
    if !exists {
        return Err(ApiError::new("not-found", "ไม่พบผู้ใช้"));
    }
    sqlx::query("INSERT INTO blocks(actor_id,target_id) VALUES($1,$2) ON CONFLICT DO NOTHING")
        .bind(&principal.uid)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"blocked":true})))
}
pub async fn unblock(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    if id == principal.uid
        || id.is_empty()
        || id.chars().count() > 128
        || id.chars().any(char::is_control)
    {
        return Err(ApiError::invalid("ผู้ใช้ไม่ถูกต้อง"));
    }
    crate::throttle(&state.db, "blocks", &principal.uid, 30).await?;
    let mut tx = state.db.begin().await?;
    crate::matching::lock_pair(&mut tx, &principal.uid, &id).await?;
    crate::auth::lock_business_session(&mut tx, &headers, &principal.uid).await?;
    sqlx::query("DELETE FROM blocks WHERE actor_id=$1 AND target_id=$2")
        .bind(&principal.uid)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"blocked":false})))
}
pub async fn membership(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let principal = authenticate(&state, &headers).await?;
    let record = sqlx::query_scalar::<_, Value>("SELECT record FROM entitlements WHERE user_id=$1")
        .bind(&principal.uid)
        .fetch_optional(&state.db)
        .await?;
    let now = chrono::Utc::now().timestamp_millis();
    Ok(Json(
        json!({"plan":if policy::is_plus_active(record.as_ref(),now){"plus"}else{"free"},"features":{
        "advancedFilters":policy::has_plan_feature(record.as_ref(),"advancedFilters",now),"incognito":policy::has_plan_feature(record.as_ref(),"incognito",now)}}),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn server_flags_cannot_be_written() {
        for field in [
            "isFaceVerified",
            "role",
            "isAdmin",
            "emailVerified",
            "entitlements",
            "encryptionDevices",
        ] {
            assert!(validate_profile(&json!({field:true})).is_err());
        }
        assert!(
            validate_profile(&json!({"name":"A","age":21,"privacy":{"showLocation":false}}))
                .is_ok()
        );
        assert!(validate_profile(&json!({"age":17})).is_err());
        assert!(validate_profile(&json!({"privacy":{"showAge":"false"}})).is_err());
        assert!(validate_profile(&json!({"privacy":{"showLocation":{"hidden":true}}})).is_err());
    }
}
