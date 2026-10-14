//! Port of functions/peerDistance.js: distances are never more precise than
//! the 0.7 km privacy floor and require both people to share location.

use crate::model::UserRecord;

pub const MIN_VISIBLE_DISTANCE_KM: f64 = 0.7;

pub fn haversine_km((lat1, lon1): (f64, f64), (lat2, lon2): (f64, f64)) -> f64 {
    let (d_lat, d_lon) = ((lat2 - lat1).to_radians(), (lon2 - lon1).to_radians());
    let a = (d_lat / 2.0).sin().powi(2) + lat1.to_radians().cos() * lat2.to_radians().cos() * (d_lon / 2.0).sin().powi(2);
    6371.0 * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

pub fn visible_distance_km(from: &UserRecord, to: &UserRecord) -> Option<f64> {
    if !from.location_enabled || !to.location_enabled {
        return None;
    }
    let distance = haversine_km(from.coordinates?, to.coordinates?);
    if !distance.is_finite() || distance < 0.0 {
        return None;
    }
    Some((distance.max(MIN_VISIBLE_DISTANCE_KM) * 1000.0).round() / 1000.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn floors_short_distances() {
        assert!((haversine_km((7.0, 100.5), (7.0, 100.5))).abs() < 1e-9);
        let km = haversine_km((7.0087, 100.4980), (7.0187, 100.4980));
        assert!((km - 1.112).abs() < 0.01);
    }
}
