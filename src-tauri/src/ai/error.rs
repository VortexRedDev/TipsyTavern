use thiserror::Error;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("provider not registered: {0}")]
    NotFound(String),

    #[error("model not registered on provider {provider}: {model}")]
    ModelNotFound { provider: String, model: String },

    #[error("missing API key for provider {0} (please set it via set_api_key())")]
    MissingApiKey(String),

    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("http {status}: {body}")]
    HttpStatus { status: u16, body: String },

    #[error("stream ended unexpectedly")]
    StreamUnexpectedEnd,

    #[error("invalid SSE frame: {0}")]
    InvalidSse(String),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("keyring error: {0}")]
    Keyring(String),

    #[error("request cancelled")]
    Cancelled,

    #[error("upstream error: {0}")]
    Upstream(String),
}

pub type ProviderResult<T> = Result<T, ProviderError>;