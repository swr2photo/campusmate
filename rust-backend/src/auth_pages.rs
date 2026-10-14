//! Same-origin email actions. Links require a user submission; opening a link
//! does not consume its challenge, including mail preview/scanner requests.
use axum::{
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
};

fn asset(content: &'static str, content_type: &'static str) -> Response {
    let mut response = content.into_response();
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("content-security-policy", HeaderValue::from_static("default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"));
    response
}

pub async fn verify() -> Response {
    asset(
        include_str!("../web/verify-email.html"),
        "text/html; charset=utf-8",
    )
}
pub async fn reset() -> Response {
    asset(
        include_str!("../web/reset-password.html"),
        "text/html; charset=utf-8",
    )
}
pub async fn script() -> Response {
    asset(
        include_str!("../web/auth-action.js"),
        "text/javascript; charset=utf-8",
    )
}
pub async fn styles() -> Response {
    asset(
        include_str!("../web/auth-action.css"),
        "text/css; charset=utf-8",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pages_confine_scripts_requests_and_referrers() {
        for response in [verify().await, reset().await] {
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
            assert_eq!(response.headers()["referrer-policy"], "no-referrer");
            let csp = response.headers()["content-security-policy"]
                .to_str()
                .unwrap();
            assert!(csp.contains("connect-src 'self'") && csp.contains("frame-ancestors 'none'"));
            assert!(!csp.contains("unsafe-inline") && !csp.contains("unsafe-eval"));
        }
    }
}
