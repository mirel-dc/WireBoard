use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    Validation,
    Missing,
    Conflict,
    Persistence,
    Unauthorized,
    Forbidden,
    Limit,
}
#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<serde_json::Value>,
}
impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }
    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Validation, message)
    }
    pub fn missing() -> Self {
        Self::new(ErrorCode::Missing, "Объект или доска не найдены")
    }
    pub fn conflict() -> Self {
        Self::new(
            ErrorCode::Conflict,
            "Доска изменилась. Прочитайте свежую revision и повторите действие",
        )
    }
    pub fn persistence() -> Self {
        Self::new(
            ErrorCode::Persistence,
            "Не удалось прочитать или сохранить данные. Проверьте каталог и права доступа",
        )
    }
    pub fn limit(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::Limit, message)
    }
}
impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for AppError {}
impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = match self.code {
            ErrorCode::Validation => StatusCode::BAD_REQUEST,
            ErrorCode::Missing => StatusCode::NOT_FOUND,
            ErrorCode::Conflict => StatusCode::CONFLICT,
            ErrorCode::Persistence => StatusCode::INTERNAL_SERVER_ERROR,
            ErrorCode::Unauthorized => StatusCode::UNAUTHORIZED,
            ErrorCode::Forbidden => StatusCode::FORBIDDEN,
            ErrorCode::Limit => StatusCode::PAYLOAD_TOO_LARGE,
        };
        (status, Json(self)).into_response()
    }
}
