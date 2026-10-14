//! Track search (Spotify with an iTunes fallback), Thailand charts and LRCLIB
//! lyrics. Ports of the legacy callables; responses keep the same shapes.
use std::{sync::OnceLock, time::Duration};

use axum::http::HeaderMap;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Map, Value};
use tokio::sync::Mutex;

use crate::{auth, error::ApiError, AppState};

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::limited(3))
            .user_agent("CampusMate/1.0 (https://getcampusmate.app)")
            .build()
            .expect("http client")
    })
}

fn cut(value: &str, max: usize) -> String {
    value.trim().chars().take(max).collect()
}

async fn get_json(url: url::Url, bearer: Option<&str>) -> Result<(u16, Value), ApiError> {
    let mut request = http().get(url).header("Accept", "application/json");
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|_| ApiError::unavailable("เชื่อมต่อบริการเพลงไม่ได้"))?;
    let status = response.status().as_u16();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| ApiError::unavailable("เชื่อมต่อบริการเพลงไม่ได้"))?;
    if bytes.len() > 2_000_000 {
        return Err(ApiError::unavailable("บริการเพลงตอบกลับข้อมูลใหญ่เกินไป"));
    }
    Ok((
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    ))
}

fn spotify_search_url(name: &str, artists: &str) -> String {
    let query = format!("{name} {artists}");
    let mut url = url::Url::parse("https://open.spotify.com/search/").expect("static url");
    url.path_segments_mut()
        .expect("base")
        .pop_if_empty()
        .push(query.trim());
    url.to_string().chars().take(500).collect()
}

fn duration(value: &Value) -> Option<i64> {
    value
        .as_f64()
        .filter(|ms| (1000.0..=86_400_000.0).contains(ms))
        .map(|ms| ms.round() as i64)
}

#[allow(clippy::too_many_arguments)]
fn track(
    id: String,
    name: &str,
    artists: &str,
    art: String,
    album: &str,
    duration_ms: Option<i64>,
    preview: Option<&str>,
    external: String,
) -> Value {
    let mut track = json!({"id": id.chars().take(64).collect::<String>(), "name": cut(name, 200),
        "artists": if artists.trim().is_empty() {"Unknown".to_string()} else {cut(artists, 200)},
        "albumArt": art.chars().take(2000).collect::<String>(), "externalUrl": external});
    if !album.trim().is_empty() {
        track["albumName"] = json!(cut(album, 200));
    }
    if let Some(ms) = duration_ms {
        track["durationMs"] = json!(ms);
    }
    if let Some(preview) = preview.filter(|p| !p.trim().is_empty()) {
        track["previewUrl"] = json!(cut(preview, 2000));
    }
    track
}

fn spotify_track(item: &Value) -> Option<Value> {
    let id = item["id"].as_str()?.trim();
    let name = item["name"].as_str()?.trim();
    if id.is_empty() || name.is_empty() {
        return None;
    }
    let artists = item["artists"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x["name"].as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let art = item["album"]["images"]
        .as_array()
        .and_then(|images| {
            images
                .iter()
                .find(|i| i["url"].as_str().is_some_and(|u| !u.is_empty()))
                .or(images.last())
        })
        .and_then(|i| i["url"].as_str())
        .unwrap_or_default()
        .trim()
        .to_owned();
    let external = item["external_urls"]["spotify"]
        .as_str()
        .map(|u| cut(u, 500))
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| format!("https://open.spotify.com/track/{id}"));
    Some(track(
        id.to_owned(),
        name,
        &artists,
        art,
        item["album"]["name"].as_str().unwrap_or_default(),
        duration(&item["duration_ms"]),
        item["preview_url"].as_str(),
        external,
    ))
}

fn itunes_track(item: &Value) -> Option<Value> {
    let id = match &item["trackId"] {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => return None,
    };
    let name = item["trackName"].as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    let artists = item["artistName"].as_str().unwrap_or("Unknown");
    let art = item["artworkUrl100"]
        .as_str()
        .map(|u| u.replace("100x100bb", "300x300bb"))
        .or_else(|| item["artworkUrl60"].as_str().map(str::to_owned))
        .unwrap_or_default();
    let album = item["collectionName"]
        .as_str()
        .or_else(|| item["collectionCensoredName"].as_str())
        .unwrap_or_default();
    let external = item["trackViewUrl"]
        .as_str()
        .map(|u| cut(u, 500))
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| spotify_search_url(name, artists));
    Some(track(
        format!("it-{id}"),
        name,
        artists,
        art,
        album,
        duration(&item["trackTimeMillis"]),
        item["previewUrl"].as_str(),
        external,
    ))
}

struct SpotifyToken {
    token: String,
    expires: tokio::time::Instant,
}

async fn spotify_token() -> Option<String> {
    static CACHE: OnceLock<Mutex<Option<SpotifyToken>>> = OnceLock::new();
    let (id, secret) = (
        std::env::var("SPOTIFY_CLIENT_ID").ok()?,
        std::env::var("SPOTIFY_CLIENT_SECRET").ok()?,
    );
    let mut cache = CACHE.get_or_init(|| Mutex::new(None)).lock().await;
    if let Some(cached) = cache
        .as_ref()
        .filter(|c| c.expires > tokio::time::Instant::now() + Duration::from_secs(60))
    {
        return Some(cached.token.clone());
    }
    let response = http()
        .post("https://accounts.spotify.com/api/token")
        .header(
            "Authorization",
            format!("Basic {}", STANDARD.encode(format!("{id}:{secret}"))),
        )
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body("grant_type=client_credentials")
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        tracing::warn!(
            status = response.status().as_u16(),
            "spotify token request failed"
        );
        return None;
    }
    let data: Value = response.json().await.ok()?;
    let token = data["access_token"].as_str()?.to_owned();
    let lifetime = data["expires_in"].as_u64().unwrap_or(3600).min(7200);
    *cache = Some(SpotifyToken {
        token: token.clone(),
        expires: tokio::time::Instant::now() + Duration::from_secs(lifetime),
    });
    Some(token)
}

async fn itunes_search(
    q: &str,
    limit: usize,
    offset: usize,
) -> Result<(Vec<Value>, bool), ApiError> {
    if offset >= 200 {
        return Ok((Vec::new(), false));
    }
    let mut url = url::Url::parse("https://itunes.apple.com/search").expect("static url");
    url.query_pairs_mut()
        .append_pair("term", q)
        .append_pair("media", "music")
        .append_pair("entity", "song")
        .append_pair("limit", &(offset + limit + 1).min(200).to_string())
        .append_pair("country", "TH")
        .append_pair("lang", "en_us");
    let (status, data) = get_json(url, None).await?;
    if !(200..300).contains(&status) {
        return Err(ApiError::new("internal", "ค้นหาเพลงไม่สำเร็จ"));
    }
    let items = data["results"].as_array().cloned().unwrap_or_default();
    let tracks = items
        .iter()
        .skip(offset)
        .take(limit)
        .filter_map(itunes_track)
        .collect();
    Ok((tracks, items.len() > offset + limit))
}

pub async fn search(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "music-search", &user.uid, 60).await?;
    let q = cut(data["q"].as_str().unwrap_or_default(), 100);
    if q.is_empty() {
        return Err(ApiError::invalid("ต้องระบุคำค้นหา"));
    }
    let limit = data["limit"]
        .as_f64()
        .map(|n| n.floor() as i64)
        .unwrap_or(10)
        .clamp(1, 10) as usize;
    let offset = data["offset"]
        .as_f64()
        .map(|n| n.floor() as i64)
        .unwrap_or(0)
        .clamp(0, 1000) as usize;
    if data["source"] != "itunes" {
        if let Some(token) = spotify_token().await {
            let mut url = url::Url::parse("https://api.spotify.com/v1/search").expect("static url");
            url.query_pairs_mut()
                .append_pair("q", &q)
                .append_pair("type", "track")
                .append_pair("limit", &limit.to_string())
                .append_pair("offset", &offset.to_string())
                .append_pair("market", "TH");
            if let Ok((status, body)) = get_json(url, Some(&token)).await {
                if (200..300).contains(&status) {
                    let items = body["tracks"]["items"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    return Ok(
                        json!({"tracks": items.iter().filter_map(spotify_track).collect::<Vec<_>>(), "source":"spotify",
                        "hasMore": !body["tracks"]["next"].is_null() && !items.is_empty(), "nextOffset": offset + items.len()}),
                    );
                }
                tracing::warn!(status, "spotify search failed; using itunes");
            }
        }
    }
    let (tracks, has_more) = itunes_search(&q, limit, offset).await?;
    Ok(json!({"tracks":tracks,"source":"itunes","hasMore":has_more,"nextOffset":offset+limit}))
}

fn chart_song(item: &Value) -> Option<Value> {
    let id = match &item["id"] {
        Value::String(s) => s.trim().to_owned(),
        Value::Number(n) => n.to_string(),
        _ => return None,
    };
    let name = item["name"].as_str()?.trim();
    if id.is_empty() || name.is_empty() {
        return None;
    }
    let artists = item["artistName"].as_str().unwrap_or("Unknown");
    let art = item["artworkUrl100"]
        .as_str()
        .map(|u| u.replace("100x100bb", "300x300bb"))
        .unwrap_or_default();
    let external = item["url"]
        .as_str()
        .map(|u| cut(u, 500))
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| spotify_search_url(name, artists));
    let mut value = track(
        format!("it-{id}"),
        name,
        artists,
        art,
        item["albumName"].as_str().unwrap_or_default(),
        duration(&item["trackTimeMillis"]),
        None,
        external,
    );
    value["itunesId"] = json!(id);
    Some(value)
}

fn rss_entry(entry: &Value) -> Option<Value> {
    let id = entry["id"]["attributes"]["im:id"]
        .as_str()?
        .trim()
        .to_owned();
    let name = entry["im:name"]["label"].as_str()?.trim();
    if id.is_empty() || name.is_empty() {
        return None;
    }
    let artists = entry["im:artist"]["label"].as_str().unwrap_or("Unknown");
    let art = entry["im:image"]
        .as_array()
        .and_then(|i| i.last())
        .and_then(|i| i["label"].as_str())
        .unwrap_or_default();
    let art = match art.rfind("bb") {
        Some(_) => regex_size(art),
        None => art.to_owned(),
    };
    let mut preview = None;
    let mut external = entry["id"]["label"]
        .as_str()
        .filter(|u| u.starts_with("http"))
        .map(|u| cut(u, 500))
        .unwrap_or_default();
    let links = match &entry["link"] {
        Value::Array(a) => a.clone(),
        Value::Null => Vec::new(),
        other => vec![other.clone()],
    };
    for link in links {
        let href = link["attributes"]["href"].as_str().unwrap_or_default();
        let kind = link["attributes"]["type"].as_str().unwrap_or_default();
        if !href.is_empty() && kind.starts_with("audio") {
            preview = Some(href.to_owned());
        } else if external.is_empty()
            && !href.is_empty()
            && (link["attributes"]["rel"] == "alternate" || href.contains("music.apple.com"))
        {
            external = cut(href, 500);
        }
    }
    if external.is_empty() {
        external = spotify_search_url(name, artists);
    }
    let mut value = track(
        format!("it-{id}"),
        name,
        artists,
        art,
        entry["im:collection"]["im:name"]["label"]
            .as_str()
            .unwrap_or_default(),
        None,
        preview.as_deref(),
        external,
    );
    value["itunesId"] = json!(id);
    Some(value)
}

/// `.../55x55bb.png` -> `.../300x300bb.png`
fn regex_size(url: &str) -> String {
    let Some(end) = url.rfind("bb") else {
        return url.to_owned();
    };
    let start = url[..end].rfind('/').map_or(0, |i| i + 1);
    let size = &url[start..end];
    let mut parts = size.split('x');
    let numeric =
        |s: Option<&str>| s.is_some_and(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()));
    if numeric(parts.next()) && numeric(parts.next()) && parts.next().is_none() {
        format!("{}300x300{}", &url[..start], &url[end..])
    } else {
        url.to_owned()
    }
}

async fn enrich(mut tracks: Vec<Value>) -> Vec<Value> {
    let ids: Vec<String> = tracks
        .iter()
        .filter_map(|t| t["itunesId"].as_str().map(str::to_owned))
        .take(25)
        .collect();
    if ids.is_empty() {
        return tracks;
    }
    let mut url = url::Url::parse("https://itunes.apple.com/lookup").expect("static url");
    url.query_pairs_mut()
        .append_pair("id", &ids.join(","))
        .append_pair("country", "TH");
    let Ok((200, data)) = get_json(url, None).await else {
        return tracks;
    };
    let mut by_id = Map::new();
    for item in data["results"].as_array().cloned().unwrap_or_default() {
        if let Some(id) = item["trackId"].as_i64() {
            by_id.insert(id.to_string(), item);
        }
    }
    for track in &mut tracks {
        let Some(hit) = track["itunesId"]
            .as_str()
            .and_then(|id| by_id.get(id))
            .cloned()
        else {
            continue;
        };
        if track["previewUrl"].is_null() {
            if let Some(preview) = hit["previewUrl"].as_str() {
                track["previewUrl"] = json!(cut(preview, 2000));
            }
        }
        if let Some(view) = hit["trackViewUrl"].as_str() {
            track["externalUrl"] = json!(cut(view, 500));
        }
        if track["albumName"].is_null() {
            if let Some(album) = hit["collectionName"].as_str() {
                track["albumName"] = json!(cut(album, 200));
            }
        }
        if track["durationMs"].is_null() {
            if let Some(ms) = duration(&hit["trackTimeMillis"]) {
                track["durationMs"] = json!(ms);
            }
        }
    }
    tracks
}

pub async fn browse(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "music-browse", &user.uid, 30).await?;
    let limit = data["limit"]
        .as_f64()
        .map(|n| n.floor() as i64)
        .unwrap_or(10)
        .clamp(4, 25) as usize;
    let size = limit.max(8);
    let recommended = match get_json(
        url::Url::parse(&format!(
            "https://itunes.apple.com/th/rss/topsongs/limit={size}/json"
        ))
        .expect("url"),
        None,
    )
    .await
    {
        Ok((200, data)) => data["feed"]["entry"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(rss_entry)
            .take(limit)
            .collect(),
        _ => Vec::new(),
    };
    let trending: Vec<Value> = match get_json(
        url::Url::parse(&format!(
            "https://rss.applemarketingtools.com/api/v2/th/music/most-played/{size}/songs.json"
        ))
        .expect("url"),
        None,
    )
    .await
    {
        Ok((200, data)) => data["feed"]["results"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter_map(chart_song)
            .take(limit)
            .collect(),
        _ => Vec::new(),
    };
    let seen: Vec<String> = recommended
        .iter()
        .filter_map(|t: &Value| t["id"].as_str().map(str::to_owned))
        .collect();
    let filtered: Vec<Value> = trending
        .iter()
        .filter(|t| {
            !t["id"]
                .as_str()
                .is_some_and(|id| seen.iter().any(|s| s == id))
        })
        .cloned()
        .collect();
    let strip = |list: Vec<Value>| -> Vec<Value> {
        list.into_iter()
            .map(|mut t| {
                if let Some(o) = t.as_object_mut() {
                    o.remove("itunesId");
                }
                t
            })
            .collect()
    };
    let recommended = strip(enrich(recommended).await);
    let trending = strip(
        enrich(if filtered.is_empty() {
            trending
        } else {
            filtered
        })
        .await,
    );
    Ok(json!({"recommended":recommended,"trending":trending,"source":"apple-th"}))
}

fn is_separator(c: char) -> bool {
    c.is_ascii_punctuation()
        || c.is_whitespace()
        || ('\u{2000}'..='\u{206F}').contains(&c)
        || ('\u{3000}'..='\u{303F}').contains(&c)
        || ('\u{2190}'..='\u{2BFF}').contains(&c)
        || ('\u{1F300}'..='\u{1FAFF}').contains(&c)
        || matches!(c, '«' | '»' | '¡' | '¿' | '·' | '“' | '”' | '‘' | '’')
}

pub fn normalized(value: &str) -> String {
    value
        .to_lowercase()
        .split(is_separator)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn primary_artist(value: &str) -> String {
    let lower = value.to_lowercase();
    let mut end = value.find(',').unwrap_or(value.len());
    for marker in [" feat. ", " feat ", " ft. ", " ft "] {
        if let Some(i) = lower.find(marker) {
            end = end.min(i);
        }
    }
    value[..end].trim().to_owned()
}

fn matches_track(record: &Value, title: &str, artist: &str) -> bool {
    let record_title = normalized(
        record["trackName"]
            .as_str()
            .or_else(|| record["name"].as_str())
            .unwrap_or_default(),
    );
    let record_artist = normalized(record["artistName"].as_str().unwrap_or_default());
    let title = normalized(title);
    let artist = normalized(&primary_artist(artist));
    !record_title.is_empty()
        && !title.is_empty()
        && !record_artist.is_empty()
        && !artist.is_empty()
        && record_title == title
        && (record_artist == artist || record_artist.starts_with(&format!("{artist} ")))
}

fn has_lyrics(record: &Value) -> bool {
    record["instrumental"] != true
        && (record["plainLyrics"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
            || record["syncedLyrics"]
                .as_str()
                .is_some_and(|s| !s.is_empty()))
}

fn difference(record: &Value, duration_ms: Option<f64>) -> Option<f64> {
    let seconds = record["duration"].as_f64().filter(|s| *s >= 1.0)?;
    let ms = duration_ms.filter(|ms| *ms >= 1000.0)?;
    Some((seconds - ms / 1000.0).abs())
}

pub fn select(
    records: &[Value],
    title: &str,
    artist: &str,
    album: &str,
    duration_ms: Option<f64>,
) -> Option<Value> {
    let album = normalized(album);
    let wanted_seconds = duration_ms.filter(|ms| *ms >= 1000.0).map(|ms| ms / 1000.0);
    let mut best: Option<(f64, &Value)> = None;
    for record in records {
        if !matches_track(record, title, artist) || !has_lyrics(record) {
            continue;
        }
        let diff = difference(record, duration_ms);
        if let (Some(diff), Some(seconds)) = (diff, wanted_seconds) {
            if diff > (seconds * 0.08).clamp(20.0, 30.0) {
                continue;
            }
        }
        let mut score = match diff {
            Some(d) if d <= 3.0 => 60.0 - d * 2.0,
            Some(d) if d <= 10.0 => 30.0 - d,
            Some(d) => -d,
            None => 0.0,
        };
        if !album.is_empty()
            && normalized(record["albumName"].as_str().unwrap_or_default()) == album
        {
            score += 15.0;
        }
        if record["syncedLyrics"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
        {
            score += 40.0;
        }
        if best.is_none_or(|(b, _)| score > b) {
            best = Some((score, record));
        }
    }
    best.map(|(_, r)| r.clone())
}

pub fn parse_synced(value: &str) -> Vec<(i64, String)> {
    let mut lines = Vec::new();
    for raw in value.lines() {
        let Some(rest) = raw.strip_prefix('[') else {
            continue;
        };
        let Some((stamp, text)) = rest.split_once(']') else {
            continue;
        };
        let Some((minutes, seconds)) = stamp.split_once(':') else {
            continue;
        };
        let (seconds, fraction) = match seconds.split_once(['.', ':']) {
            Some((s, f)) => (s, f),
            None => (seconds, "0"),
        };
        let (Ok(m), Ok(s)) = (minutes.parse::<i64>(), seconds.parse::<i64>()) else {
            continue;
        };
        if minutes.len() > 3
            || seconds.len() != 2
            || s >= 60
            || fraction.len() > 3
            || !fraction.bytes().all(|b| b.is_ascii_digit())
        {
            continue;
        }
        let fraction: i64 = format!("{fraction:0<3}").parse().unwrap_or(0);
        let text: String = text.trim().chars().take(500).collect();
        if !text.is_empty() {
            lines.push(((m * 60 + s) * 1000 + fraction, text));
        }
        if lines.len() >= 400 {
            break;
        }
    }
    lines.sort_by_key(|(t, _)| *t);
    lines
}

fn repeated(lines: &[(Option<i64>, String)]) -> (Vec<String>, Option<i64>) {
    let usable: Vec<&(Option<i64>, String)> = lines
        .iter()
        .filter(|(_, t)| normalized(t).chars().count() >= 3)
        .collect();
    let keys: Vec<String> = usable.iter().map(|(_, t)| normalized(t)).collect();
    for size in [4, 3, 2] {
        if keys.len() < size {
            continue;
        }
        let mut first = std::collections::HashMap::new();
        for i in 0..=keys.len() - size {
            let key = keys[i..i + size].join("\u{0}");
            match first.get(&key) {
                Some(&start) if i - start >= size + 2 => {
                    return (
                        usable[start..start + size]
                            .iter()
                            .map(|(_, t)| t.clone())
                            .collect(),
                        usable[start].0,
                    );
                }
                Some(_) => {}
                None => {
                    first.insert(key, i);
                }
            }
        }
    }
    (Vec::new(), None)
}

pub fn compact(record: Option<&Value>) -> Value {
    let not_found = json!({"status":"not_found","lines":[],"plainLyrics":"","suggestedLines":[],"suggestedLineStartMs":null,"source":"LRCLIB"});
    let Some(record) = record else {
        return not_found;
    };
    let synced = parse_synced(record["syncedLyrics"].as_str().unwrap_or_default());
    let supplied: String = record["plainLyrics"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .chars()
        .take(24_000)
        .collect();
    let plain = if supplied.is_empty() {
        synced
            .iter()
            .map(|(_, t)| t.as_str())
            .collect::<Vec<_>>()
            .join("\n")
            .chars()
            .take(24_000)
            .collect()
    } else {
        supplied
    };
    if record["instrumental"] == true || (plain.is_empty() && synced.is_empty()) {
        return not_found;
    }
    let source: Vec<(Option<i64>, String)> = if synced.is_empty() {
        plain
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .take(400)
            .map(|l| (None, l.to_owned()))
            .collect()
    } else {
        synced.iter().map(|(t, l)| (Some(*t), l.clone())).collect()
    };
    let (suggested, start) = repeated(&source);
    json!({"status":"found","lines":synced.iter().map(|(t,l)| json!({"timeMs":t,"text":l})).collect::<Vec<_>>(),
        "plainLyrics":plain,"suggestedLines":suggested,"suggestedLineStartMs":start,"source":"LRCLIB"})
}

async fn lrclib(
    path: &str,
    title: &str,
    artist: &str,
    album: &str,
    duration_ms: Option<f64>,
) -> Result<Value, ApiError> {
    let mut url = url::Url::parse(&format!("https://lrclib.net/api/{path}")).expect("static url");
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("track_name", title)
            .append_pair("artist_name", artist);
        if !album.is_empty() {
            query.append_pair("album_name", album);
        }
        if let Some(ms) = duration_ms.filter(|ms| (1000.0..=3_600_000.0).contains(ms)) {
            query.append_pair("duration", &((ms / 1000.0).round() as i64).to_string());
        }
    }
    match get_json(url, None).await? {
        (404, _) => Ok(Value::Null),
        (429, _) => Err(ApiError::new(
            "resource-exhausted",
            "บริการเนื้อเพลงกำลังมีผู้ใช้งานมาก ลองอีกครั้ง",
        )),
        (status, body) if (200..300).contains(&status) => Ok(body),
        _ => Err(ApiError::unavailable("โหลดเนื้อเพลงไม่สำเร็จ ลองอีกครั้ง")),
    }
}

pub async fn lyrics(state: &AppState, headers: &HeaderMap, data: Value) -> Result<Value, ApiError> {
    let user = auth::authenticate_session(state, headers).await?;
    crate::throttle(&state.db, "music-lyrics", &user.uid, 30).await?;
    let title = cut(data["name"].as_str().unwrap_or_default(), 200);
    let artists = cut(data["artists"].as_str().unwrap_or_default(), 200);
    if title.is_empty() || artists.is_empty() || artists == "Unknown" {
        return Err(ApiError::invalid("ต้องระบุชื่อเพลงและศิลปิน"));
    }
    let artist = primary_artist(&artists);
    let album = cut(data["albumName"].as_str().unwrap_or_default(), 200);
    let duration_ms = data["durationMs"].as_f64();
    let exact = lrclib("get", &title, &artist, &album, duration_ms).await?;
    let strong = |record: &Value| {
        let wanted = normalized(&album);
        (wanted.is_empty()
            || normalized(record["albumName"].as_str().unwrap_or_default()) == wanted)
            && (duration_ms.is_none_or(|ms| ms < 1000.0)
                || difference(record, duration_ms).is_some_and(|d| d <= 3.0))
    };
    if matches_track(&exact, &title, &artist)
        && has_lyrics(&exact)
        && strong(&exact)
        && exact["syncedLyrics"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
    {
        return Ok(compact(Some(&exact)));
    }
    tokio::time::sleep(Duration::from_millis(250)).await;
    let candidates = match lrclib("search", &title, &artist, "", None).await {
        Ok(Value::Array(list)) => list,
        Ok(_) => Vec::new(),
        Err(error) => {
            return match select(
                std::slice::from_ref(&exact),
                &title,
                &artist,
                &album,
                duration_ms,
            ) {
                Some(found) => Ok(compact(Some(&found))),
                None => Err(error),
            }
        }
    };
    let mut records = vec![exact];
    records.extend(candidates.into_iter().take(50));
    Ok(compact(
        select(&records, &title, &artist, &album, duration_ms).as_ref(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lyrics_parsing_and_matching() {
        let lines = parse_synced("[00:12.50] Hello\n[01:02] World\nbad\n[00:99.00] skip");
        assert_eq!(
            lines,
            vec![(12_500, "Hello".into()), (62_000, "World".into())]
        );
        assert_eq!(primary_artist("PUN feat. Someone"), "PUN");
        assert_eq!(normalized("Hello, World!"), "hello world");
        let record = json!({"trackName":"Song","artistName":"PUN","plainLyrics":"a","syncedLyrics":"[00:01.00] a","duration":200});
        assert!(select(&[record], "song", "PUN, X", "", Some(200_000.0)).is_some());
        assert_eq!(compact(None)["status"], "not_found");
    }

    #[test]
    fn artwork_sizes_are_upgraded() {
        assert_eq!(
            regex_size("https://x/a/55x55bb.png"),
            "https://x/a/300x300bb.png"
        );
        assert_eq!(regex_size("https://x/a/cover.png"), "https://x/a/cover.png");
    }
}
