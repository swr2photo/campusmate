//! Per-user token bucket. The app refreshes discovery every 30 s plus on
//! signals, so 20 burst / 1 per 2 s leaves headroom while capping scraping.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use parking_lot::Mutex;

const CAPACITY: f64 = 20.0;
const REFILL_PER_SEC: f64 = 0.5;
const IDLE_EVICT: Duration = Duration::from_secs(600);

#[derive(Default)]
pub struct RateLimiter {
    buckets: Mutex<HashMap<String, (f64, Instant)>>,
}

impl RateLimiter {
    pub fn allow(&self, uid: &str) -> bool {
        let now = Instant::now();
        let mut buckets = self.buckets.lock();
        if buckets.len() > 50_000 {
            buckets.retain(|_, (_, last)| now.duration_since(*last) < IDLE_EVICT);
        }
        let (tokens, last) = buckets.entry(uid.to_owned()).or_insert((CAPACITY, now));
        *tokens = (*tokens + now.duration_since(*last).as_secs_f64() * REFILL_PER_SEC).min(CAPACITY);
        *last = now;
        if *tokens >= 1.0 {
            *tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn burst_then_block() {
        let limiter = RateLimiter::default();
        assert!((0..20).all(|_| limiter.allow("u")));
        assert!(!limiter.allow("u"));
        assert!(limiter.allow("other"));
    }
}
