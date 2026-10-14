//! Firestore protobuf values -> serde_json, with the same wire shape the
//! Node functions produce (`toWire`): timestamps become epoch milliseconds.

use firestore::FirestoreDocument;
use serde_json::{Map, Number, Value};

use gcloud_sdk::google::firestore::v1::{value::ValueType, Value as FsValue};

pub fn fields_to_json(document: &FirestoreDocument) -> Map<String, Value> {
    document
        .fields
        .iter()
        .map(|(key, value)| (key.clone(), to_json(value)))
        .collect()
}

fn to_json(value: &FsValue) -> Value {
    match &value.value_type {
        None | Some(ValueType::NullValue(_)) => Value::Null,
        Some(ValueType::BooleanValue(flag)) => Value::Bool(*flag),
        Some(ValueType::IntegerValue(number)) => Value::Number((*number).into()),
        Some(ValueType::DoubleValue(number)) => Number::from_f64(*number).map(Value::Number).unwrap_or(Value::Null),
        Some(ValueType::TimestampValue(ts)) => Value::Number((ts.seconds * 1000 + i64::from(ts.nanos) / 1_000_000).into()),
        Some(ValueType::StringValue(text)) => Value::String(text.clone()),
        Some(ValueType::ReferenceValue(path)) => Value::String(path.clone()),
        Some(ValueType::GeoPointValue(point)) => serde_json::json!({ "latitude": point.latitude, "longitude": point.longitude }),
        Some(ValueType::ArrayValue(array)) => Value::Array(array.values.iter().map(to_json).collect()),
        Some(ValueType::MapValue(map)) => Value::Object(map.fields.iter().map(|(k, v)| (k.clone(), to_json(v))).collect()),
        // Raw bytes never appear in public projections; drop them.
        Some(ValueType::BytesValue(_)) => Value::Null,
        #[allow(unreachable_patterns)]
        _ => Value::Null,
    }
}

/// Path segments after `.../documents/`, e.g. `["users", "uid", "blockedUsers", "other"]`.
pub fn document_path(name: &str) -> Vec<&str> {
    match name.split_once("/documents/") {
        Some((_, path)) => path.split('/').collect(),
        None => Vec::new(),
    }
}

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
            if trimmed.is_empty() { Some(0.0) } else { trimmed.parse::<f64>().ok() }
        }
        Value::Bool(flag) => Some(if *flag { 1.0 } else { 0.0 }),
        Value::Null => Some(0.0),
        _ => None,
    }
}

pub fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).map(str::to_owned).collect(),
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
            if float == 0.0 { String::new() } else if float.fract() == 0.0 && float.abs() < 1e15 { format!("{}", float as i64) } else { number.to_string() }
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
