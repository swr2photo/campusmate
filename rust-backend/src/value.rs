use serde_json::{Map, Value};

// JavaScript-compatible readers used by the ported policy code.

pub fn js_str<'a>(map: &'a Map<String, Value>, key: &str) -> &'a str {
    map.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn js_bool(map: &Map<String, Value>, key: &str) -> Option<bool> {
    map.get(key).and_then(Value::as_bool)
}

/// `Number(value)` for numbers and numeric strings; `None` when it would be NaN.
pub fn js_number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                Some(0.0)
            } else {
                trimmed.parse::<f64>().ok()
            }
        }
        Value::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        Value::Null => Some(0.0),
        _ => None,
    }
}

pub fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

/// `String(value || '')` as used by the JS filters.
pub fn js_string(value: Option<&Value>) -> String {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(Value::Number(number)) => {
            let float = number.as_f64().unwrap_or(0.0);
            if float == 0.0 {
                String::new()
            } else if float.fract() == 0.0 && float.abs() < 1e15 {
                format!("{}", float as i64)
            } else {
                number.to_string()
            }
        }
        Some(Value::Bool(true)) => "true".into(),
        Some(other) => other.to_string(),
    }
}

pub fn is_safe_integer(value: Option<&Value>) -> Option<i64> {
    let number = value?.as_f64()?;
    (number.fract() == 0.0 && number.abs() <= 9_007_199_254_740_991.0).then_some(number as i64)
}

/// Length as JavaScript counts it (UTF-16 code units).
pub fn js_len(text: &str) -> usize {
    text.encode_utf16().count()
}
