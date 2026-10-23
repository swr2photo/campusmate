//! End-to-end RPC contracts for the migrated platform: match -> chat ->
//! meetup -> party -> call -> inbox -> deletion, against real PostgreSQL.
use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use campusmate_backend::{events, new_state, router};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgPoolOptions, PgPool};
use tower::ServiceExt;
use uuid::Uuid;

async fn seed(pool: &PgPool, id: &str, profile: Value) -> String {
    sqlx::query("INSERT INTO accounts(id,email,email_verified) VALUES($1,$2,true)")
        .bind(id)
        .bind(format!("{id}@psu.ac.th"))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO profiles(user_id,raw,face_verified,discoverable,is_new) VALUES($1,$2,true,true,false)")
        .bind(id)
        .bind(profile)
        .execute(pool)
        .await
        .unwrap();
    let access = hex::encode(Sha256::digest(format!("platform-access:{id}")));
    sqlx::query("INSERT INTO sessions(user_id,family_id,access_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,now()+interval '15 minutes',now()+interval '30 days')")
        .bind(id)
        .bind(Uuid::new_v4())
        .bind(Sha256::digest(access.as_bytes()).to_vec())
        .bind(Sha256::digest(format!("platform-refresh:{id}").as_bytes()).to_vec())
        .execute(pool)
        .await
        .unwrap();
    access
}

async fn rpc(app: &Router, token: &str, name: &str, data: Value) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/v1/rpc/{name}"))
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
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

fn envelope(device: &str, seed: u8) -> Value {
    json!({"senderDeviceId":device,"senderPublicKey":STANDARD.encode([seed;32]),"nonce":STANDARD.encode([seed;24]),"ciphertext":STANDARD.encode([seed;48])})
}

fn packet(seed: u8) -> Value {
    json!({"encrypted":true,"encryptionVersion":1,"nonce":STANDARD.encode([seed;24]),"ciphertext":STANDARD.encode([seed;40])})
}

fn merge(mut base: Value, extra: Value) -> Value {
    for (key, value) in extra.as_object().unwrap() {
        base[key] = value.clone();
    }
    base
}

#[sqlx::test(migrations = "./migrations")]
async fn inbox_preferences_are_per_member_and_do_not_change_receipts(pool: PgPool) {
    let profile = json!({"name":"Student","age":21});
    let alice = seed(&pool, "alice", profile.clone()).await;
    let bob = seed(&pool, "bob", profile.clone()).await;
    let outsider = seed(&pool, "outsider", profile).await;
    sqlx::query("INSERT INTO conversations(id,member_a,member_b) VALUES('c-inbox','alice','bob')")
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO conversation_members(conversation_id,user_id,unread) VALUES('c-inbox','alice',2),('c-inbox','bob',5) ON CONFLICT(conversation_id,user_id) DO UPDATE SET unread=EXCLUDED.unread")
        .execute(&pool).await.unwrap();
    let app = router(new_state(pool.clone(), vec![71; 32]).await.unwrap());
    ok(
        &app,
        &alice,
        "chatSettings",
        json!({"conversationId":"c-inbox","settings":{"isPinned":true,"markedUnread":true}}),
    )
    .await;
    let mine: (bool, bool, i32, bool) = sqlx::query_as("SELECT pinned,marked_unread,unread,read_at IS NULL FROM conversation_members WHERE conversation_id='c-inbox' AND user_id='alice'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(mine, (true, true, 2, true));
    let peer: (bool, bool, i32) = sqlx::query_as("SELECT pinned,marked_unread,unread FROM conversation_members WHERE conversation_id='c-inbox' AND user_id='bob'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(peer, (false, false, 5));
    let (status, _) = rpc(
        &app,
        &outsider,
        "chatSettings",
        json!({"conversationId":"c-inbox","settings":{"isPinned":true}}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let list = ok(&app, &alice, "listConversations", json!({})).await;
    assert_eq!(
        list["conversations"][0]["participantSettings"]["alice"]["isPinned"],
        true
    );
    assert_eq!(
        list["conversations"][0]["participantSettings"]["alice"]["markedUnread"],
        true
    );
    assert!(list["conversations"][0]["participantSettings"]
        .get("bob")
        .is_none());
    ok(
        &app,
        &alice,
        "chatMarkRead",
        json!({"conversationId":"c-inbox"}),
    )
    .await;
    let read: (bool, bool, i32) = sqlx::query_as("SELECT pinned,marked_unread,unread FROM conversation_members WHERE conversation_id='c-inbox' AND user_id='alice'")
        .fetch_one(&pool).await.unwrap();
    assert_eq!(read, (true, false, 0));
    // The peer can set their own reminder without touching Alice's pin.
    ok(
        &app,
        &bob,
        "chatSettings",
        json!({"conversationId":"c-inbox","settings":{"markedUnread":true}}),
    )
    .await;
    let (status, _) = rpc(
        &app,
        &alice,
        "chatSettings",
        json!({"conversationId":"c-inbox","settings":{"isPinned":"yes"}}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[sqlx::test(migrations = "./migrations")]
async fn match_chat_meetup_and_inbox(pool: PgPool) {
    let profile = json!({"name":"Student","age":21,"activities":["running"]});
    let alice = seed(&pool, "alice", profile.clone()).await;
    let bob = seed(&pool, "bob", profile).await;
    let app = router(new_state(pool.clone(), vec![61; 32]).await.unwrap());

    // A one-sided like notifies privately; the mutual like creates the room.
    let first = ok(
        &app,
        &alice,
        "recordDiscoveryAction",
        json!({"targetUserId":"bob","kind":"like","actionId":Uuid::new_v4()}),
    )
    .await;
    assert_eq!(first["status"], "pending");
    let inbox = ok(&app, &bob, "listNotifications", json!({})).await;
    assert_eq!(inbox["unreadCount"], 1);
    assert!(!inbox.to_string().contains("alice"));
    let summary = ok(&app, &bob, "getIncomingLikeSummary", json!({})).await;
    assert_eq!(summary["pendingCount"], 1);
    assert_eq!(summary["identitiesAvailable"], false);
    let matched = ok(
        &app,
        &bob,
        "recordDiscoveryAction",
        json!({"targetUserId":"alice","kind":"like","actionId":Uuid::new_v4()}),
    )
    .await;
    assert_eq!(matched["status"], "accepted");
    let room = matched["conversationId"].as_str().unwrap().to_owned();
    let pushes: i64 = sqlx::query_scalar("SELECT count(*) FROM push_outbox")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pushes, 3, "one like and two match notices");

    for (token, device, seed) in [(&alice, "alice-phone", 7_u8), (&bob, "bob-phone", 8)] {
        ok(
            &app,
            token,
            "publishEncryptionDevice",
            json!({"deviceId":device,"publicKey":STANDARD.encode([seed;32])}),
        )
        .await;
    }
    let encryption = json!({"version":1,"algorithm":"x25519-xsalsa20-poly1305.v1","keyEnvelopes":{
        "alice":{"alice-phone":envelope("alice-phone",7)},"bob":{"bob-phone":envelope("alice-phone",7)}}});
    ok(
        &app,
        &alice,
        "chatSaveEncryption",
        json!({"conversationId":room,"revision":0,"encryption":encryption}),
    )
    .await;

    // Plaintext and unknown metadata are rejected; ciphertext with meta is stored.
    let (status, _) = rpc(
        &app,
        &alice,
        "chatSend",
        merge(
            packet(1),
            json!({"conversationId":room,"messageId":"m-1","meta":{"text":"hi"}}),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let sent = ok(&app, &alice, "chatSend", merge(packet(1), json!({"conversationId":room,"messageId":"m-1","meta":{"forwarded":true},"clientSentAt":chrono::Utc::now().timestamp_millis()}))).await;
    assert_eq!(sent["created"], true);
    let retry = ok(
        &app,
        &alice,
        "chatSend",
        merge(packet(1), json!({"conversationId":room,"messageId":"m-1"})),
    )
    .await;
    assert_eq!(retry["duplicate"], true);

    let rooms = ok(&app, &bob, "listConversations", json!({})).await;
    let card = &rooms["conversations"][0];
    assert_eq!(card["id"], room);
    assert_eq!(card["unreadCounts"]["bob"], 1);
    assert_eq!(card["lastMessageId"], "m-1");
    assert_eq!(card["participantProfiles"]["alice"]["name"], "Student");
    assert!(card["participantSettings"].get("alice").is_none());

    let page = ok(&app, &bob, "chatMessages", json!({"conversationId":room})).await;
    assert_eq!(page["messages"][0]["forwarded"], true);
    assert!(page["messages"][0].get("text").is_none());
    ok(
        &app,
        &bob,
        "chatReact",
        json!({"conversationId":room,"messageId":"m-1","emoji":"❤️"}),
    )
    .await;
    ok(&app, &bob, "chatMarkRead", json!({"conversationId":room})).await;
    let page = ok(&app, &alice, "chatMessages", json!({"conversationId":room})).await;
    assert_eq!(page["messages"][0]["reactions"]["bob"], "❤️");
    let rooms = ok(&app, &bob, "listConversations", json!({})).await;
    assert_eq!(rooms["conversations"][0]["unreadCounts"]["bob"], 0);
    let (status, _) = rpc(
        &app,
        &bob,
        "chatUnsend",
        json!({"conversationId":room,"messageId":"m-1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let page = ok(&app, &alice, "chatMessages", json!({"conversationId":room})).await;
    assert_eq!(
        page["messages"].as_array().unwrap().len(),
        1,
        "only the sender may unsend"
    );

    // The appointment snapshot comes from the host profile, not the client.
    ok(&app, &alice, "saveMyProfile", json!({"patch":{"meetup":{"name":"Library","schedule":{"date":"2099-01-02","startTime":"10:00"}}}})).await;
    let accepted = ok(&app, &bob, "chatToggleMeetup", merge(packet(2), json!({"conversationId":room,"messageId":"m-2","hostUserId":"alice","shouldAccept":true}))).await;
    assert_eq!(accepted["accepted"], true);
    let appointments = ok(&app, &alice, "listAppointments", json!({})).await;
    assert_eq!(appointments["appointments"][0]["meetup"]["name"], "Library");
    assert_eq!(appointments["appointments"][0]["status"], "active");

    // Reports hide the reported message for the reporter only.
    ok(
        &app,
        &alice,
        "chatSend",
        merge(packet(3), json!({"conversationId":room,"messageId":"m-3"})),
    )
    .await;
    ok(
        &app,
        &bob,
        "submitReport",
        json!({"reportedUserId":"alice","conversationId":room,"messageId":"m-3","reason":"spam"}),
    )
    .await;
    let bob_page = ok(&app, &bob, "chatMessages", json!({"conversationId":room})).await;
    assert!(!bob_page.to_string().contains("\"m-3\""));
    let alice_page = ok(&app, &alice, "chatMessages", json!({"conversationId":room})).await;
    assert!(alice_page.to_string().contains("\"m-3\""));

    // Unmatch hides the room and clears both timelines.
    ok(
        &app,
        &alice,
        "unmatchProfile",
        json!({"targetUserId":"bob"}),
    )
    .await;
    let rooms = ok(&app, &bob, "listConversations", json!({})).await;
    assert_eq!(
        rooms["conversations"][0]["participantSettings"]["bob"]["isHidden"],
        true
    );
    let page = ok(&app, &bob, "chatMessages", json!({"conversationId":room})).await;
    assert_eq!(page["messages"].as_array().unwrap().len(), 0);
    let (status, _) = rpc(
        &app,
        &bob,
        "chatSend",
        merge(packet(4), json!({"conversationId":room,"messageId":"m-4"})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let appointments = ok(&app, &bob, "listAppointments", json!({})).await;
    assert_eq!(appointments["appointments"][0]["status"], "cancelled");

    let marked = ok(
        &app,
        &bob,
        "markAllNotificationInboxRead",
        json!({"expectedUid":"bob"}),
    )
    .await;
    assert!(marked["count"].as_u64().unwrap() >= 1);
    let (status, _) = rpc(
        &app,
        &bob,
        "markAllNotificationInboxRead",
        json!({"expectedUid":"alice"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[sqlx::test(migrations = "./migrations")]
async fn parties_group_chat_and_calls(pool: PgPool) {
    let profile = json!({"name":"Student","age":21});
    let host = seed(&pool, "host", profile.clone()).await;
    let guest = seed(&pool, "guest", profile).await;
    let app = router(new_state(pool.clone(), vec![62; 32]).await.unwrap());
    for (token, device, seed) in [(&host, "host-phone", 3_u8), (&guest, "guest-phone", 4)] {
        ok(
            &app,
            token,
            "publishEncryptionDevice",
            json!({"deviceId":device,"publicKey":STANDARD.encode([seed;32])}),
        )
        .await;
    }
    let (status, _) = rpc(
        &app,
        &host,
        "createParty",
        json!({"maxPeople":4,"location":{"kind":"pin","latitude":13.75,"longitude":100.5},
        "schedule":{"date":"2099-01-01","startTime":"10:00","endTime":"11:00"}}),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "outside the campus radius");
    let created = ok(&app, &host, "createParty", json!({"maxPeople":4,"location":{"kind":"pin","latitude":7.0085,"longitude":100.4979,"name":"Court"},
        "schedule":{"date":"2099-01-01","startTime":"10:00","endTime":"11:00"}})).await;
    let party = created["partyId"].as_str().unwrap().to_owned();
    let open = ok(&app, &guest, "listParties", json!({"scope":"open"})).await;
    assert_eq!(open["parties"][0]["memberIds"], json!(["host"]));
    ok(&app, &guest, "requestJoinParty", json!({"partyId":party})).await;
    let hosted = ok(
        &app,
        &host,
        "listPartyRequests",
        json!({"scope":"hosted","partyId":party}),
    )
    .await;
    assert_eq!(hosted["requests"][0]["requesterId"], "guest");
    let (status, _) = rpc(&app, &host, "approvePartyRequest", json!({"partyId":party,"requesterId":"guest","initialGrants":{"host":{"host-phone":envelope("host-phone",3)}}})).await;
    assert_eq!(
        status,
        StatusCode::PRECONDITION_FAILED,
        "every member needs a grant"
    );
    let approved = ok(&app, &host, "approvePartyRequest", json!({"partyId":party,"requesterId":"guest","initialGrants":{
        "host":{"host-phone":envelope("host-phone",3)},"guest":{"guest-phone":envelope("host-phone",3)}}})).await;
    assert_eq!(approved["status"], "approved");

    let record = json!({"type":"text","epoch":0,"encrypted":true,"nonce":STANDARD.encode([5;24]),"ciphertext":STANDARD.encode([5;60])});
    ok(
        &app,
        &guest,
        "sendGroupMessage",
        json!({"partyId":party,"id":"g-1","record":record}),
    )
    .await;
    let audio = json!({"type":"audio","epoch":0,"encrypted":true,"nonce":STANDARD.encode([6;24]),"ciphertext":STANDARD.encode([6;60])});
    ok(
        &app,
        &host,
        "sendGroupMessage",
        json!({"partyId":party,"id":"g-audio","record":audio}),
    )
    .await;
    let (status, _) = rpc(&app, &guest, "sendGroupMessage", json!({"partyId":party,"id":"g-bad","record":{"type":"video","epoch":0,"encrypted":true,"nonce":STANDARD.encode([7;24]),"ciphertext":STANDARD.encode([7;60])}})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let messages = ok(&app, &host, "groupMessages", json!({"partyId":party})).await;
    assert_eq!(messages["messages"][0]["id"], "g-audio");
    assert_eq!(messages["messages"][1]["id"], "g-1");
    assert!(
        messages["epochs"][0]["keyEnvelopes"].get("guest").is_none(),
        "only own envelopes"
    );
    ok(
        &app,
        &host,
        "markGroupRead",
        json!({"partyId":party,"messageId":"g-1"}),
    )
    .await;

    ok(&app, &guest, "leaveParty", json!({"partyId":party})).await;
    let chats = ok(&app, &host, "listGroupChats", json!({})).await;
    assert_eq!(chats["chats"][0]["rekeyRequired"], true);
    let renamed = ok(
        &app,
        &host,
        "updateGroupProfile",
        json!({"partyId":party,"title":"กลุ่มบอล"}),
    )
    .await;
    assert_eq!(renamed["title"], "กลุ่มบอล");
    assert_eq!(renamed["avatarUri"], "");
    let chats = ok(&app, &host, "listGroupChats", json!({})).await;
    assert_eq!(chats["chats"][0]["title"], "กลุ่มบอล");
    let (status, _) = rpc(
        &app,
        &guest,
        "updateGroupProfile",
        json!({"partyId":party,"title":"แอบแก้"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = rpc(
        &app,
        &host,
        "sendGroupMessage",
        json!({"partyId":party,"id":"g-2","record":record}),
    )
    .await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    let (status, _) = rpc(&app, &guest, "groupMessages", json!({"partyId":party})).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Calls require an active direct room.
    let (status, _) = rpc(
        &app,
        &host,
        "initiateCall",
        json!({"receiverId":"guest","callType":"voice"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    sqlx::query("INSERT INTO conversations(id,member_a,member_b) VALUES('c-call','guest','host')")
        .execute(&pool)
        .await
        .unwrap();
    let call = ok(
        &app,
        &host,
        "initiateCall",
        json!({"receiverId":"guest","callType":"video"}),
    )
    .await;
    let id = call["callId"].as_str().unwrap().to_owned();
    let incoming = ok(&app, &guest, "getIncomingCall", json!({})).await;
    assert_eq!(incoming["call"]["id"], id);
    let (status, _) = rpc(
        &app,
        &host,
        "updateCall",
        json!({"callId":id,"action":"accept"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let current = ok(&app, &guest, "getCall", json!({"callId":id})).await;
    assert_eq!(
        current["call"]["status"], "calling",
        "the caller cannot accept"
    );
    ok(
        &app,
        &guest,
        "updateCall",
        json!({"callId":id,"action":"accept"}),
    )
    .await;
    ok(
        &app,
        &host,
        "updateCall",
        json!({"callId":id,"action":"end","durationSeconds":12.7}),
    )
    .await;
    let ended = ok(&app, &guest, "getCall", json!({"callId":id})).await;
    assert_eq!(ended["call"]["status"], "ended");
    assert_eq!(ended["call"]["durationSeconds"], 12);
}

#[sqlx::test(migrations = "./migrations")]
async fn account_deletion_requires_a_verified_code(pool: PgPool) {
    let profile = json!({"name":"Student","age":21});
    let alice = seed(&pool, "alice", profile.clone()).await;
    seed(&pool, "bob", profile).await;
    sqlx::query("INSERT INTO conversations(id,member_a,member_b) VALUES('c-del','alice','bob')")
        .execute(&pool)
        .await
        .unwrap();
    // Exercise the same restricted role as the deployed API. Owner-role tests
    // can hide a denied DELETE/UPDATE midway through this transaction.
    sqlx::raw_sql(include_str!("../operations/runtime-grants.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let login = format!("deletion_{}", Uuid::new_v4().simple());
    sqlx::raw_sql(&format!(
        "CREATE ROLE {login} LOGIN PASSWORD 'disposable-deletion-test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; GRANT campusmate_api TO {login};"
    ))
    .execute(&pool)
    .await
    .unwrap();
    let api = PgPoolOptions::new()
        .max_connections(4)
        .connect_with(
            pool.connect_options()
                .as_ref()
                .clone()
                .username(&login)
                .password("disposable-deletion-test"),
        )
        .await
        .unwrap();
    let app = router(new_state(api.clone(), vec![63; 32]).await.unwrap());
    let (status, _) = rpc(&app, &alice, "deleteUserData", json!({})).await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED);
    ok(&app, &alice, "sendAccountDeletionOtp", json!({})).await;
    let queued: i64 =
        sqlx::query_scalar("SELECT count(*) FROM outbox WHERE kind='delete_account_otp'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(queued, 1);
    sqlx::query("UPDATE account_otps SET code_hash=$1 WHERE user_id='alice'")
        .bind(Sha256::digest(b"123456").to_vec())
        .execute(&pool)
        .await
        .unwrap();
    let (status, _) = rpc(
        &app,
        &alice,
        "verifyAccountDeletionOtp",
        json!({"code":"000000"}),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    ok(
        &app,
        &alice,
        "verifyAccountDeletionOtp",
        json!({"code":"123456"}),
    )
    .await;
    ok(&app, &alice, "deleteUserData", json!({})).await;
    let row: (Option<chrono::DateTime<chrono::Utc>>, String) =
        sqlx::query_as("SELECT deleted_at,email FROM accounts WHERE id='alice'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(row.0.is_some());
    assert!(row.1.ends_with("@deleted.invalid"));
    let rooms: i64 = sqlx::query_scalar("SELECT count(*) FROM conversations")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rooms, 0);
    let (status, _) = rpc(&app, &alice, "getMyProfile", json!({})).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    drop(app);
    api.close().await;
    sqlx::raw_sql(&format!("DROP OWNED BY {login}; DROP ROLE {login};"))
        .execute(&pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = "./migrations")]
async fn signals_are_delivered_only_after_commit(pool: PgPool) {
    let hub = events::Hub::new();
    let mut receiver = hub.subscribe();
    tokio::spawn(events::listen(pool.clone(), hub.clone()));
    // The first message after connecting is a resync.
    let first = tokio::time::timeout(std::time::Duration::from_secs(10), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&*first.topic, "resync");
    assert!(hub.is_listening());
    let mut tx = pool.begin().await.unwrap();
    events::publish(&mut tx, &["alice"], "messages", Some("c-1"))
        .await
        .unwrap();
    tx.rollback().await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    events::publish(&mut tx, &["bob"], "conversations", None)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let signal = tokio::time::timeout(std::time::Duration::from_secs(10), receiver.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&*signal.user, "bob");
    assert_eq!(&*signal.topic, "conversations");
}

#[sqlx::test(migrations = "./migrations")]
async fn the_listener_never_listens_through_a_transaction_pooler(pool: PgPool) {
    // PgBouncer's server connections carry its name; a LISTEN left on one
    // would reach the next unrelated request that commits on it.
    let options = (*pool.connect_options())
        .clone()
        .application_name("pgbouncer");
    let pooled = PgPoolOptions::new()
        .max_connections(1)
        .connect_lazy_with(options);
    let hub = events::Hub::new();
    let mut receiver = hub.subscribe();
    let task = tokio::spawn(events::listen(pooled, hub.clone()));
    let first = tokio::time::timeout(std::time::Duration::from_secs(2), receiver.recv()).await;
    assert!(first.is_err(), "no resync without a direct connection");
    let listening: i64 =
        sqlx::query_scalar("SELECT count(*) FROM pg_stat_activity WHERE query ILIKE 'LISTEN%'")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(listening, 0);
    // Clients are told to poll rather than wait on a silent stream.
    assert!(!hub.is_listening());
    task.abort();
}

#[sqlx::test(migrations = "./migrations")]
async fn view_once_media_and_room_ids(pool: PgPool) {
    let profile = json!({"name":"Student","age":21});
    let alice = seed(&pool, "alice", profile.clone()).await;
    let bob = seed(&pool, "bob", profile).await;
    let app = router(new_state(pool.clone(), vec![64; 32]).await.unwrap());
    ok(
        &app,
        &alice,
        "recordDiscoveryAction",
        json!({"targetUserId":"bob","kind":"like","actionId":Uuid::new_v4()}),
    )
    .await;
    let matched = ok(
        &app,
        &bob,
        "recordDiscoveryAction",
        json!({"targetUserId":"alice","kind":"like","actionId":Uuid::new_v4()}),
    )
    .await;
    assert_eq!(
        matched["conversationId"], "c-alice-bob",
        "the app derives this ID itself"
    );
    let room = "c-alice-bob";
    for (token, device, seed) in [(&alice, "alice-phone", 7_u8), (&bob, "bob-phone", 8)] {
        ok(
            &app,
            token,
            "publishEncryptionDevice",
            json!({"deviceId":device,"publicKey":STANDARD.encode([seed;32])}),
        )
        .await;
    }
    let devices = ok(&app, &alice, "listMyEncryptionDevices", json!({})).await;
    assert_eq!(devices["devices"][0]["deviceId"], "alice-phone");
    let encryption = json!({"version":1,"algorithm":"x25519-xsalsa20-poly1305.v1","keyEnvelopes":{
        "alice":{"alice-phone":envelope("alice-phone",7)},"bob":{"bob-phone":envelope("alice-phone",7)}}});
    ok(
        &app,
        &alice,
        "chatSaveEncryption",
        json!({"conversationId":room,"revision":0,"encryption":encryption}),
    )
    .await;
    ok(
        &app,
        &alice,
        "chatSend",
        merge(
            packet(1),
            json!({"conversationId":room,"messageId":"v-1","meta":{"viewMode":"once"}}),
        ),
    )
    .await;
    ok(
        &app,
        &bob,
        "chatRecordView",
        json!({"conversationId":room,"messageId":"v-1"}),
    )
    .await;
    let (status, _) = rpc(
        &app,
        &bob,
        "chatRecordView",
        json!({"conversationId":room,"messageId":"v-1"}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::PRECONDITION_FAILED,
        "view-once opens a single time"
    );
    let state = ok(
        &app,
        &alice,
        "chatViewState",
        json!({"conversationId":room,"messageId":"v-1"}),
    )
    .await;
    assert_eq!(state["views"]["bob"], 1);
    assert_eq!(state["senderId"], "alice");
    let rendition = json!({"encrypted":true,"encryptionVersion":1,"nonce":STANDARD.encode([2;24]),"ciphertext":STANDARD.encode([2;64])});
    let (status, _) = rpc(
        &app,
        &bob,
        "chatSaveRendition",
        json!({"conversationId":room,"messageId":"v-1","quality":"high","rendition":rendition}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "only the sender adds renditions"
    );
    ok(
        &app,
        &alice,
        "chatSaveRendition",
        json!({"conversationId":room,"messageId":"v-1","quality":"high","rendition":rendition}),
    )
    .await;
    let state = ok(
        &app,
        &bob,
        "chatViewState",
        json!({"conversationId":room,"messageId":"v-1"}),
    )
    .await;
    assert_eq!(state["renditions"]["high"]["senderId"], "alice");
    ok(
        &app,
        &bob,
        "chatSettings",
        json!({"conversationId":room,"settings":{"isHidden":true,"clearHistory":true}}),
    )
    .await;
    let page = ok(&app, &bob, "chatMessages", json!({"conversationId":room})).await;
    assert_eq!(page["messages"].as_array().unwrap().len(), 0);
    let page = ok(&app, &alice, "chatMessages", json!({"conversationId":room})).await;
    assert_eq!(page["messages"].as_array().unwrap().len(), 1);
    let (status, _) = rpc(
        &app,
        &alice,
        "verifyPassword",
        json!({"password":"anything"}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "seeded accounts have no password"
    );
    let membership = ok(&app, &alice, "getMembershipState", json!({})).await;
    assert_eq!(membership["plan"], "free");
    assert_eq!(membership["isAdmin"], false);
}
