//! `POST /v1/rpc/{name}` with `{"data": ...}` returns `{"result": ...}`.
//!
//! Legacy Firebase callable names keep their input and output contracts, so
//! the app's existing callable wrapper can switch transport without changing
//! callers. Operations the app used to perform as direct Firestore reads and
//! writes have new names; each one authorizes on the server.
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};

use crate::{
    account, auth, calls, chat, discovery, error::ApiError, matching, media, membership, notify,
    parties, rooms, social, AppState,
};

fn input<T: DeserializeOwned>(data: Value) -> Result<T, ApiError> {
    serde_json::from_value(data).map_err(|_| ApiError::invalid("ข้อมูลคำขอไม่ถูกต้อง"))
}

fn object(data: Value) -> Value {
    if data.is_object() {
        data
    } else {
        json!({})
    }
}

pub async fn call(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    if name.is_empty() || name.len() > 64 || !name.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(ApiError::new("not-found", "ไม่พบบริการนี้"));
    }
    let data = object(body.get("data").cloned().unwrap_or(Value::Null));
    tracing::info!(rpc_name = %name, "RPC call dispatch");
    // Maintenance and incident protection refuse before any work is done.
    crate::service_status::gate(&state, &headers, &name).await?;
    let started = std::time::Instant::now();
    let outcome = dispatch(&state, &headers, &name, data).await;
    crate::service_status::record(outcome.as_ref().err(), started.elapsed());
    let result = outcome.inspect_err(|err| {
        tracing::error!(rpc_name = %name, error_code = %err.code, error_msg = %err.message, "RPC call failed");
    })?;
    Ok(Json(json!({ "result": result })))
}

pub async fn dispatch(
    state: &AppState,
    headers: &HeaderMap,
    name: &str,
    data: Value,
) -> Result<Value, ApiError> {
    let s = || State(state.clone());
    let h = || headers.clone();
    Ok(match name {
        "submitAppFeedback" => crate::feedback::submit(state, headers, data).await?,
        "getServiceStatus" => crate::service_status::public_status(state, headers).await,
        "getAppPreferences" => crate::settings::get(state, headers).await?,
        "saveAppPreferences" => crate::settings::save(state, headers, data).await?,
        "presenceHeartbeat" => crate::settings::heartbeat(state, headers, data).await?,
        "getChatPresence" => crate::settings::presence(state, headers, data).await?,
        // Matching and discovery (legacy secure callables).
        "recordDiscoveryAction" => matching::record(s(), h(), Json(input(data)?)).await?.0,
        "respondToIncomingLike" => matching::respond(s(), h(), Json(input(data)?)).await?.0,
        "rewindDiscoveryAction" => matching::rewind(s(), h(), Json(input(data)?)).await?.0,
        "cancelPendingOutgoingLike" => {
            matching::cancel(
                s(),
                h(),
                Json(input(json!({"targetUserId": data["targetUserId"]}))?),
            )
            .await?
            .0
        }
        "unmatchProfile" => {
            matching::unmatch(
                s(),
                h(),
                Json(input(json!({"targetUserId": data["targetUserId"]}))?),
            )
            .await?
            .0
        }
        "getDiscoveryPage" => {
            let mut request = json!({"filters": data.get("filters").cloned().unwrap_or(json!({}))});
            if let Some(cursor) = data["cursor"].as_str() {
                request["cursor"] = json!(cursor);
            }
            discovery::discover(s(), h(), Json(input(request)?))
                .await?
                .0
        }
        "getVisibleProfiles" => social::visible_profiles(state, headers, data).await?,
        "setProfileVisibility" => social::set_visibility(state, headers, data).await?,
        "getVisibilityState" => social::visibility_state(state, headers, data).await?,
        "getIncomingLikeSummary" => social::incoming_likes(state, headers, data).await?,
        "getMyDecisionState" => social::decision_state(state, headers, data).await?,
        "getConversationEncryptionProfiles" => {
            let id = data["conversationId"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            let request =
                input(json!({"userIds": data.get("userIds").cloned().unwrap_or(json!([]))}))?;
            chat::encryption_profiles(s(), h(), Path(id), Json(request))
                .await?
                .0
        }
        "getPartyEncryptionProfiles" => parties::encryption_profiles(state, headers, data).await?,
        "getPeerDistances" => social::peer_distances(state, headers, data).await?,
        "reportAppVersion" => social::report_app_version(state, headers, data).await?,

        // Profile, blocks and reports.
        "getMyProfile" => social::my_profile(state, headers, data).await?,
        "saveMyProfile" => social::save_profile(state, headers, data).await?,
        "listBlockedUsers" => social::blocked(state, headers, data).await?,
        "blockUser" => social::block(state, headers, data).await?,
        "unblockUser" => social::unblock(state, headers, data).await?,
        "submitReport" => social::report(state, headers, data).await?,
        "listSpots" => social::spots(state, headers, data).await?,
        "getAppConfig" => social::app_config(state, headers, data).await?,
        "getMembershipState" => membership::get_state(state, headers, data).await?,
        "syncMembership" => membership::sync_rpc(state, headers, data).await?,

        // Account.
        "checkCampusEmailAvailability" => {
            account::campus_email_availability(state, headers, data).await?
        }
        "sendCampusEmailChange" => account::send_campus_email_change(state, headers, data).await?,
        "sendBrandedEmailVerification" => {
            let user = auth::authenticate_session(state, headers).await?;
            if user.email_verified {
                json!({"alreadyVerified":true,"email":user.email})
            } else {
                let _ = auth::request_verification(s(), h()).await?;
                json!({"sent":true,"email":user.email,"sender":"noreply@getcampusmate.app"})
            }
        }
        "sendBrandedPasswordReset" => {
            let _ =
                auth::forgot_password(s(), Json(input(json!({"email": data["email"]}))?)).await?;
            json!({"sent":true,"sender":"noreply@getcampusmate.app"})
        }
        "sendAccountDeletionOtp" => account::send_deletion_otp(state, headers).await?,
        "verifyAccountDeletionOtp" => account::verify_deletion_otp(state, headers, data).await?,
        "deleteUserData" => account::delete_account(state, headers).await?,
        "verifyPassword" => account::verify_password(state, headers, data).await?,

        // Direct chat.
        "listConversations" => rooms::list(state, headers, data).await?,
        "getConversation" => rooms::get(state, headers, data).await?,
        "openConversation" => rooms::open(state, headers, data).await?,
        "chatMessages" => rooms::messages(state, headers, data).await?,
        "chatSend" => rooms::send(state, headers, data).await?,
        "chatMarkRead" => rooms::mark_read(state, headers, data).await?,
        "chatSettings" => rooms::settings(state, headers, data).await?,
        "chatUnsend" => rooms::unsend(state, headers, data).await?,
        "chatReact" => rooms::react(state, headers, data).await?,
        "chatHideMessage" => rooms::hide_message(state, headers, data).await?,
        "chatRecordView" => rooms::record_view(state, headers, data).await?,
        "chatViewState" => rooms::view_state(state, headers, data).await?,
        "chatSaveRendition" => rooms::save_rendition(state, headers, data).await?,
        "chatToggleMeetup" => rooms::toggle_meetup(state, headers, data).await?,
        "chatSaveEncryption" => {
            let id = data["conversationId"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            let request =
                input(json!({"revision": data["revision"], "encryption": data["encryption"]}))?;
            chat::save_encryption(s(), h(), Path(id), Json(request))
                .await?
                .0
        }
        "publishEncryptionDevice" => {
            let id = data["deviceId"].as_str().unwrap_or_default().to_owned();
            let request = input(json!({"publicKey": data["publicKey"]}))?;
            chat::publish_device(s(), h(), Path(id), Json(request))
                .await?
                .0
        }
        "listMyEncryptionDevices" => {
            let user = auth::authenticate_session(state, headers).await?;
            let rows: Vec<(String, i64)> = sqlx::query_as(
                "SELECT device_id,(extract(epoch FROM updated_at)*1000)::bigint FROM encryption_devices WHERE user_id=$1 ORDER BY updated_at",
            )
            .bind(&user.uid)
            .fetch_all(&state.db)
            .await?;
            json!({"devices": rows.iter().map(|(id, at)| json!({"deviceId":id,"updatedAt":at})).collect::<Vec<_>>()})
        }
        "removeEncryptionDevice" => {
            let id = data["deviceId"].as_str().unwrap_or_default().to_owned();
            chat::remove_device(s(), h(), Path(id)).await?.0
        }
        "getR2ChatUploadUrl" => media::chat_upload_ticket(state, headers, data).await?,
        "listAppointments" => rooms::appointments(state, headers, data).await?,
        "cancelAppointment" => rooms::cancel_appointment(state, headers, data).await?,
        "ensureAppointmentHistory" => rooms::ensure_appointment(state, headers, data).await?,

        // Notifications.
        "registerPushToken" => notify::register_push_token(state, headers, data).await?,
        "unregisterPushToken" => notify::unregister_push_token(state, headers, data).await?,
        "ensureNotificationInbox" => notify::ensure_inbox(state, headers, data).await?,
        "markAllNotificationInboxRead" => notify::mark_all_read(state, headers, data).await?,
        "listNotifications" => notify::list_notifications(state, headers, data).await?,
        "markNotificationRead" => notify::mark_read(state, headers, data).await?,

        // Parties and group chat.
        "searchCampusPlaces" => parties::search_places(state, headers, data).await?,
        "resolveCampusPlace" => parties::resolve_campus_place(state, headers, data).await?,
        "createParty" => parties::create(state, headers, data).await?,
        "requestJoinParty" => parties::request_join(state, headers, data).await?,
        "withdrawPartyRequest" => parties::withdraw(state, headers, data).await?,
        "rejectPartyRequest" => parties::reject(state, headers, data).await?,
        "cancelParty" => parties::cancel(state, headers, data).await?,
        "approvePartyRequest" => parties::approve(state, headers, data).await?,
        "activateLegacyPartyChat" => parties::activate_legacy(state, headers, data).await?,
        "leaveParty" => parties::leave(state, headers, data).await?,
        "rotatePartyKey" => parties::rotate_key(state, headers, data).await?,
        "listParties" => parties::list(state, headers, data).await?,
        "listPartyRequests" => parties::requests(state, headers, data).await?,
        "listGroupChats" => parties::chats(state, headers, data).await?,
        "groupMessages" => parties::messages(state, headers, data).await?,
        "sendGroupMessage" => parties::send(state, headers, data).await?,
        "markGroupRead" => parties::mark_read(state, headers, data).await?,
        "updateGroupProfile" => parties::update_profile(state, headers, data).await?,

        // Calls.
        "initiateCall" => calls::initiate(state, headers, data).await?,
        "updateCall" => calls::update(state, headers, data).await?,
        "getCall" => calls::get(state, headers, data).await?,
        "getIncomingCall" => calls::incoming(state, headers, data).await?,
        "getLiveKitToken" => calls::livekit(state, headers, data).await?,

        // Music, administration.
        "searchSpotifyTracks" => crate::music::search(state, headers, data).await?,
        "browseMusicTracks" => crate::music::browse(state, headers, data).await?,
        "getMusicLyrics" => crate::music::lyrics(state, headers, data).await?,
        "adminConsole" => crate::admin::console(state, headers, data).await?,
        "switchAdminMode" => crate::admin::switch_mode(state, headers, data).await?,
        "uploadPlacePhoto" => crate::admin::upload_place_photo(state, headers, data).await?,

        // Replaced by raw-body routes or by the photo-verification API.
        "uploadChatMedia"
        | "uploadProfileGalleryImage"
        | "checkImageSafety"
        | "startFaceVerificationSession"
        | "completeFaceVerification"
        | "syncPhotoVerification" => {
            return Err(ApiError::new(
                "unimplemented",
                "บริการนี้ย้ายไปใช้ช่องทางใหม่แล้ว กรุณาอัปเดตแอป",
            ))
        }
        _ => return Err(ApiError::new("not-found", "ไม่พบบริการนี้")),
    })
}
