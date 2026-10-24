import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

// Live weather for PSU Hat Yai, used to tint banners, backdrops and the
// mascot's outfit. Only the fixed campus coordinates are sent (never the
// person's location). Open-Meteo needs no key; offline we estimate from the
// sun's position so the UI still has a sensible mood.
const CAMPUS = { latitude: 7.0069, longitude: 100.4987 };
const ENDPOINT = `https://api.open-meteo.com/v1/forecast?latitude=${CAMPUS.latitude}&longitude=${CAMPUS.longitude}`
  + '&current=temperature_2m,is_day,weather_code,wind_speed_10m,cloud_cover,precipitation'
  + '&daily=sunrise,sunset&forecast_days=2&timeformat=unixtime&timezone=Asia%2FBangkok';
// Open-Meteo's current conditions update every 15 minutes.
const REFRESH_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 8000;
// Day and night follow the real sunrise and sunset, checked this often.
const SUN_CHECK_MS = 60 * 1000;
// A reading older than this no longer describes the sky.
const STALE_MS = 90 * 60 * 1000;

const rad = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;

/** Sunrise and sunset (ms) around `ms` at a place; the usual solar formulas, within a minute or two. */
export function sunTimes(ms, latitude = CAMPUS.latitude, longitude = CAMPUS.longitude) {
  const lw = -longitude * rad;
  const phi = latitude * rad;
  const days = ms / DAY_MS - 0.5 + J1970 - J2000;
  const cycle = Math.round(days - 0.0009 - lw / (2 * Math.PI));
  const approx = 0.0009 + lw / (2 * Math.PI) + cycle;
  const anomaly = rad * (357.5291 + 0.98560028 * approx);
  const center = rad * (1.9148 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly) + 0.0003 * Math.sin(3 * anomaly));
  const ecliptic = anomaly + center + rad * 102.9372 + Math.PI;
  const declination = Math.asin(Math.sin(ecliptic) * Math.sin(rad * 23.4397));
  const correction = 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * ecliptic);
  const transit = J2000 + approx + correction;
  const hourAngle = Math.acos((Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(declination)) / (Math.cos(phi) * Math.cos(declination)));
  const set = J2000 + 0.0009 + (hourAngle + lw) / (2 * Math.PI) + cycle + correction;
  const rise = transit - (set - transit);
  const toMs = (julian) => (julian + 0.5 - J1970) * DAY_MS;
  return { sunrise: toMs(rise), sunset: toMs(set) };
}

/** Whether the sun is up at `now`, from the forecast's times when it has them. */
export function isDaytime(now = Date.now(), days = []) {
  const today = days.find((day) => now >= day.sunrise - DAY_MS / 2 && now < day.sunrise + DAY_MS / 2);
  const { sunrise, sunset } = today || sunTimes(now);
  return now >= sunrise && now < sunset;
}

const isRainCode = (code) => (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;

/**
 * The scene (sunny | rainy | cloudy | night, which the backdrops draw) and a
 * precise label for it, from a WMO weather code plus cloud cover and rain.
 */
export function describeWeather({ code, isDay, wind = 0, cloud = null, precipitation = 0, nearSunset = false }) {
  const clouds = Number.isFinite(cloud) ? cloud : code >= 3 ? 90 : code === 2 ? 60 : code === 1 ? 30 : 10;
  if (isRainCode(code) || precipitation >= 0.2) {
    const label = code >= 95 ? 'ฝนฟ้าคะนอง'
      : [65, 67, 82].includes(code) || precipitation >= 4 ? 'ฝนตกหนัก'
        : code >= 51 && code <= 57 ? 'ฝนปรอย'
          : isDay ? 'ฝนพรำ' : 'ฝนตกยามค่ำ';
    return { condition: 'rainy', label };
  }
  const fog = code === 45 || code === 48;
  if (!isDay) {
    return { condition: 'night', label: fog ? 'หมอกยามค่ำ' : clouds >= 70 ? 'คืนนี้ฟ้าครึ้ม' : clouds >= 35 ? 'คืนนี้มีเมฆ' : 'คืนฟ้าโปร่ง' };
  }
  if (fog) return { condition: 'cloudy', label: 'หมอกลง' };
  if (code <= 1 && clouds < 60 && wind < 30) {
    return { condition: 'sunny', label: nearSunset ? 'แดดยามเย็น' : clouds < 25 ? 'แดดสดใส' : 'แดดปนเมฆ' };
  }
  const windy = wind >= 25 ? ' ลมแรง' : wind >= 12 ? ' ลมเย็น' : '';
  return { condition: 'cloudy', label: `${clouds >= 85 || code >= 3 ? 'ฟ้าครึ้ม' : 'เมฆเยอะ'}${windy}` };
}

/** Kept for callers that only need the scene. */
export function conditionFromWeather(reading) {
  return describeWeather(reading).condition;
}

export const WEATHER_THEMES = {
  sunny: {
    label: 'แดดสดใส', icon: 'sun.max.fill',
    gradient: ['#FFF1C2', '#FFD27A'], gradientDark: ['#4A3612', '#2A1E0B'],
    accent: '#E8A317', ink: '#4A3305', inkDark: '#FFF4D6',
  },
  rainy: {
    label: 'ฝนพรำ', icon: 'cloud.rain.fill',
    gradient: ['#D7E3F1', '#9DB6D3'], gradientDark: ['#1D2B3B', '#111A24'],
    accent: '#3D7BD9', ink: '#15263B', inkDark: '#E3EEFB',
  },
  cloudy: {
    label: 'ฟ้าครึ้ม ลมเย็น', icon: 'cloud.sun.fill',
    gradient: ['#E4F0FF', '#C3DBF6'], gradientDark: ['#1E2C3D', '#142030'],
    accent: '#5B8DEF', ink: '#16294A', inkDark: '#E4EEFF',
  },
  night: {
    label: 'ท้องฟ้ายามค่ำ', icon: 'moon.stars.fill',
    gradient: ['#252B52', '#11152C'], gradientDark: ['#1B2042', '#0B0E1F'],
    accent: '#F5C451', ink: '#F4F2FF', inkDark: '#F4F2FF',
  },
};

// Icons for the precise labels; the scene's icon otherwise.
const LABEL_ICONS = {
  'ฝนฟ้าคะนอง': 'cloud.bolt.rain.fill',
  'หมอกลง': 'cloud.fog.fill',
  'หมอกยามค่ำ': 'cloud.fog.fill',
  'คืนนี้ฟ้าครึ้ม': 'cloud.moon.fill',
  'คืนนี้มีเมฆ': 'cloud.moon.fill',
  'แดดยามเย็น': 'sun.haze.fill',
};

const WeatherContext = createContext(null);

async function fetchCampusWeather(signal) {
  const response = await fetch(ENDPOINT, { signal });
  if (!response.ok) throw new Error(`weather ${response.status}`);
  const data = await response.json();
  const current = data?.current;
  if (!current || typeof current.weather_code !== 'number') throw new Error('weather payload');
  const rises = data?.daily?.sunrise || [];
  const sets = data?.daily?.sunset || [];
  const days = rises.map((sunrise, index) => ({ sunrise: sunrise * 1000, sunset: sets[index] * 1000 }))
    .filter((day) => Number.isFinite(day.sunrise) && Number.isFinite(day.sunset));
  return {
    reading: {
      code: current.weather_code,
      wind: Number(current.wind_speed_10m) || 0,
      cloud: Number.isFinite(current.cloud_cover) ? current.cloud_cover : null,
      precipitation: Number(current.precipitation) || 0,
    },
    days,
    temperature: Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m) : null,
    source: 'live',
    updatedAt: Date.now(),
  };
}

function resolve(observation, now) {
  const days = observation.days || [];
  const isDay = isDaytime(now, days);
  const today = days.find((day) => now >= day.sunrise - DAY_MS / 2 && now < day.sunrise + DAY_MS / 2) || sunTimes(now);
  const fresh = observation.reading && now - observation.updatedAt < STALE_MS;
  if (!fresh) {
    // No usable reading: the sun alone sets the scene.
    const condition = isDay ? 'sunny' : 'night';
    return { condition, label: WEATHER_THEMES[condition].label, source: 'estimate' };
  }
  const nearSunset = isDay && today.sunset - now < 45 * 60 * 1000;
  return { ...describeWeather({ ...observation.reading, isDay, nearSunset }), source: 'live' };
}

export function WeatherReactiveProvider({ children }) {
  const [observation, setObservation] = useState({ reading: null, days: [], temperature: null, updatedAt: 0 });
  // Changes at sunrise, sunset and the last 45 minutes before sunset.
  const [phase, setPhase] = useState(() => phaseAt(Date.now(), []));
  const lastFetch = useRef(0);

  useEffect(() => {
    let active = true;
    let controller = null;
    const refresh = async () => {
      if (Date.now() - lastFetch.current < REFRESH_MS / 2) return;
      lastFetch.current = Date.now();
      controller?.abort();
      controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), TIMEOUT_MS);
      try {
        const next = await fetchCampusWeather(controller.signal);
        if (active) setObservation(next);
      } catch {
        // Offline or blocked: keep the last reading until it goes stale.
      } finally {
        clearTimeout(timer);
      }
    };
    void refresh();
    const interval = setInterval(() => { lastFetch.current = 0; void refresh(); }, REFRESH_MS);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => {
      active = false;
      controller?.abort();
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  // Day/night flips at the real sunset instead of waiting for the next fetch.
  useEffect(() => {
    const check = () => setPhase(phaseAt(Date.now(), observation.days));
    check();
    const timer = setInterval(() => { if (AppState.currentState === 'active') check(); }, SUN_CHECK_MS);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') check(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [observation.days]);

  const value = useMemo(() => {
    const now = Date.now();
    const resolved = resolve(observation, now);
    const base = WEATHER_THEMES[resolved.condition];
    return {
      condition: resolved.condition,
      temperature: resolved.source === 'live' ? observation.temperature : null,
      source: resolved.source,
      updatedAt: observation.updatedAt,
      theme: { ...base, label: resolved.label, icon: LABEL_ICONS[resolved.label] || base.icon },
    };
    // `phase` re-runs this exactly when the time of day changes the answer.
  }, [observation, phase]);
  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}

function phaseAt(now, days) {
  const today = days.find((day) => now >= day.sunrise - DAY_MS / 2 && now < day.sunrise + DAY_MS / 2) || sunTimes(now);
  if (!isDaytime(now, days)) return 'night';
  return today.sunset - now < 45 * 60 * 1000 ? 'evening' : 'day';
}

/** Current campus weather; safe outside the provider (falls back to the sun). */
export function useCampusWeather() {
  const value = useContext(WeatherContext);
  if (value) return value;
  const condition = isDaytime(Date.now()) ? 'sunny' : 'night';
  return { condition, temperature: null, source: 'estimate', updatedAt: 0, theme: WEATHER_THEMES[condition] };
}
