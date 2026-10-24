//! In-app feedback and the maintenance switch, end to end over the RPC
//! router. The maintenance cache is process-wide, so everything that touches
//! it lives in this one test binary and one test.
use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use campusmate_backend::{new_state, router};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

async fn seed(pool: &PgPool, id: &str, role: &str) -> String {
    sqlx::query("INSERT INTO accounts(id,email,email_verified,role) VALUES($1,$2,true,$3)")
        .bind(id)
        .bind(format!("{id}@psu.ac.th"))
        .bind(role)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO profiles(user_id,raw,face_verified,discoverable,is_new) VALUES($1,'{}',true,true,false)")
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    let access = hex::encode(Sha256::digest(format!("status-access:{id}")));
    sqlx::query("INSERT INTO sessions(user_id,family_id,access_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')")
        .bind(id)
        .bind(Uuid::new_v4())
        .bind(Sha256::digest(access.as_bytes()).to_vec())
        .bind(Sha256::digest(format!("status-refresh:{id}").as_bytes()).to_vec())
        .execute(pool)
        .await
        .unwrap();
    access
}

async fn rpc(app: &Router, token: &str, name: &str, data: Value) -> (StatusCode, Value) {
    let mut request = Request::builder()
        .method("POST")
        .uri(format!("/v1/rpc/{name}"))
        .header("content-type", "application/json");
    if !token.is_empty() {
        request = request.header("authorization", format!("Bearer {token}"));
    }
    let response = app
        .clone()
        .oneshot(
            request
                .body(Body::from(json!({ "data": data }).to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let value: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    if status == StatusCode::OK {
        (status, value["result"].clone())
    } else {
        (status, value)
    }
}

async fn ok(app: &Router, token: &str, name: &str, data: Value) -> Value {
    let (status, body) = rpc(app, token, name, data).await;
    assert_eq!(status, StatusCode::OK, "{name}: {body}");
    body
}

fn png() -> String {
    let image = image::RgbImage::from_pixel(48, 96, image::Rgb([40, 110, 220]));
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgb8(image)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    STANDARD.encode(bytes)
}

#[sqlx::test(migrations = "./migrations")]
async fn feedback_reaches_admins_and_maintenance_stops_everyone_else(pool: PgPool) {
    let app = router(new_state(pool.clone(), vec![64; 32]).await.unwrap());
    let alice = seed(&pool, "alice", "user").await;
    let admin = seed(&pool, "boss", "admin").await;

    // ---- Feedback ---------------------------------------------------------
    for (data, why) in [
        (
            json!({"kind":"rant","message":"แอปค้างตอนเปิดแชต"}),
            "unknown kind",
        ),
        (json!({"kind":"bug","message":"ค้าง"}), "too short"),
        (
            json!({"kind":"bug","message":"แอปค้างตอนเปิดแชต","screenshot":"not-an-image"}),
            "bad screenshot",
        ),
    ] {
        let (status, body) = rpc(&app, &alice, "submitAppFeedback", data).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{why}: {body}");
    }
    let (status, _) = rpc(
        &app,
        "",
        "submitAppFeedback",
        json!({"kind":"bug","message":"แอปค้างตอนเปิดแชต"}),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "reports need an account");
    let bug = ok(&app, &alice, "submitAppFeedback", json!({
        "kind":"bug","message":"แอปค้างตอนเปิดแชต\nกดส่งแล้วหมุนไม่หยุด","screenshot":png(),
        "appVersion":"3.1.8","appBuild":"98","platform":"ios","osVersion":"26.1","screen":"chat-room",
    })).await;
    ok(
        &app,
        &alice,
        "submitAppFeedback",
        json!({"kind":"feedback","message":"อยากให้มีโหมดมืดในแผนที่"}),
    )
    .await;

    // Only admins read the inbox.
    let (status, _) = rpc(&app, &alice, "adminConsole", json!({"op":"feedback"})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let list = ok(&app, &admin, "adminConsole", json!({"op":"feedback"})).await;
    assert_eq!(list["rows"].as_array().unwrap().len(), 2);
    assert!(
        list["rows"][0].get("screenshot").is_none(),
        "lists never carry images"
    );
    let bugs = ok(
        &app,
        &admin,
        "adminConsole",
        json!({"op":"feedback","kind":"bug"}),
    )
    .await;
    assert_eq!(bugs["rows"].as_array().unwrap().len(), 1);
    let detail = ok(
        &app,
        &admin,
        "adminConsole",
        json!({"op":"feedbackDetail","id":bug["id"]}),
    )
    .await;
    assert_eq!(
        detail["feedback"]["message"],
        "แอปค้างตอนเปิดแชต\nกดส่งแล้วหมุนไม่หยุด"
    );
    assert_eq!(detail["feedback"]["platform"], "ios");
    assert_eq!(detail["reporter"]["uid"], "alice");
    assert!(
        detail["feedback"]["screenshot"]
            .as_str()
            .unwrap()
            .starts_with("data:image/jpeg;base64,"),
        "re-encoded as JPEG"
    );
    // Closing a report drops its screenshot.
    ok(
        &app,
        &admin,
        "adminConsole",
        json!({"op":"updateFeedback","id":bug["id"],"status":"resolved","note":"แก้แล้วใน 3.1.9"}),
    )
    .await;
    let detail = ok(
        &app,
        &admin,
        "adminConsole",
        json!({"op":"feedbackDetail","id":bug["id"]}),
    )
    .await;
    assert_eq!(detail["feedback"]["status"], "resolved");
    assert!(detail["feedback"]["screenshot"].is_null());
    let audited: i64 =
        sqlx::query_scalar("SELECT count(*) FROM admin_audit WHERE action='updateFeedback'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(audited, 1);

    // ---- Maintenance ------------------------------------------------------
    assert!(ok(&app, "", "getServiceStatus", json!({})).await["notice"].is_null());
    let status = ok(&app, &admin, "adminConsole", json!({"op":"serviceStatus"})).await;
    assert_eq!(status["feedback"]["new"], 1);
    let (refused, body) = rpc(&app, &admin, "adminConsole", json!({"op":"saveMaintenance","revision":status["revision"],"maintenance":{"enabled":"yes"}})).await;
    assert_eq!(refused, StatusCode::BAD_REQUEST, "{body}");
    ok(&app, &admin, "adminConsole", json!({"op":"saveMaintenance","revision":status["revision"],"maintenance":{
        "enabled":true,"title":"ปิดปรับปรุงฐานข้อมูล","message":"กลับมาใช้ได้ประมาณ 10 นาที","endsAt":"2026-10-24T10:00:00+07:00",
    }})).await;

    // Users are refused with the notice; the notice and config stay readable.
    let (refused, body) = rpc(&app, &alice, "getAppPreferences", json!({})).await;
    assert_eq!(refused, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    let notice = &body["error"]["details"]["maintenance"];
    assert_eq!(notice["kind"], "maintenance", "{body}");
    assert_eq!(notice["title"], "ปิดปรับปรุงฐานข้อมูล");
    assert_eq!(notice["endsAt"], "2026-10-24T10:00:00+07:00");
    assert_eq!(
        ok(&app, "", "getServiceStatus", json!({})).await["notice"]["kind"],
        "maintenance"
    );
    assert_eq!(
        ok(&app, &alice, "getServiceStatus", json!({})).await["notice"]["kind"],
        "maintenance"
    );
    ok(&app, &alice, "getAppConfig", json!({"id":"version"})).await;
    // Admins keep working to check the fix, and are told they bypass it.
    ok(&app, &admin, "getAppPreferences", json!({})).await;
    let bypass = ok(&app, &admin, "getServiceStatus", json!({})).await;
    assert!(bypass["notice"].is_null());
    assert_eq!(bypass["bypassed"]["kind"], "maintenance");

    let status = ok(&app, &admin, "adminConsole", json!({"op":"serviceStatus"})).await;
    assert_eq!(status["maintenance"]["enabled"], true);
    assert!(
        status["status"]["minutes"]
            .as_array()
            .is_some_and(|m| !m.is_empty()),
        "traffic is counted"
    );
    ok(&app, &admin, "adminConsole", json!({"op":"saveMaintenance","revision":status["revision"],"maintenance":{"enabled":false}})).await;
    ok(&app, &alice, "getAppPreferences", json!({})).await;
    assert!(ok(&app, "", "getServiceStatus", json!({})).await["notice"].is_null());
}
