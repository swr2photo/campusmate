use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

/// Errors mirror Firebase callable codes so the app handles both backends alike.
#[derive(Debug)]
pub struct ApiError {
    pub code: &'static str,
    pub message: String,
    pub details: Option<Value>,
}

impl ApiError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }
    pub fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid-argument", message)
    }
    pub fn plus_required(feature: &str) -> Self {
        Self {
            code: "permission-denied",
            message: "ฟีเจอร์นี้สำหรับ CampusMate Plus".into(),
            details: Some(json!({ "reason": "PLUS_REQUIRED", "feature": feature })),
        }
    }
    pub fn unauthenticated() -> Self {
        Self::new("unauthenticated", "ต้องเข้าสู่ระบบ")
    }
    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::new("unavailable", message)
    }
    pub fn internal() -> Self {
        Self::new("internal", "เกิดข้อผิดพลาด กรุณาลองใหม่")
    }

    fn status(&self) -> StatusCode {
        match self.code {
            "invalid-argument" | "out-of-range" | "deadline-exceeded" => StatusCode::BAD_REQUEST,
            "unauthenticated" => StatusCode::UNAUTHORIZED,
            "permission-denied" => StatusCode::FORBIDDEN,
            "failed-precondition" => StatusCode::PRECONDITION_FAILED,
            "resource-exhausted" => StatusCode::TOO_MANY_REQUESTS,
            "unavailable" => StatusCode::SERVICE_UNAVAILABLE,
            "not-found" => StatusCode::NOT_FOUND,
            "already-exists" | "aborted" => StatusCode::CONFLICT,
            "unimplemented" => StatusCode::NOT_IMPLEMENTED,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        // Parameter values and connection strings must never enter the public response or logs.
        tracing::error!(
            error_kind = match error {
                sqlx::Error::Database(_) => "database",
                _ => "connection",
            },
            "database operation failed"
        );
        Self::internal()
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = self.status();
        let mut body = json!({ "error": { "code": self.code, "message": self.message } });
        if let Some(details) = self.details {
            body["error"]["details"] = details;
        }
        (status, Json(body)).into_response()
    }
}
