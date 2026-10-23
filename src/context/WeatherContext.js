import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

// Live weather for PSU Hat Yai, used to tint banners, backdrops and the
// mascot's outfit. Only the fixed campus coordinates are sent (never the
// person's location). Open-Meteo needs no key; offline we estimate from the
// local time so the UI still has a sensible mood.
const CAMPUS = { latitude: 7.0069, longitude: 100.4987 };
const ENDPOINT = `https://api.open-meteo.com/v1/forecast?latitude=${CAMPUS.latitude}&longitude=${CAMPUS.longitude}`
  + '&current=temperature_2m,is_day,weather_code,wind_speed_10m&timezone=Asia%2FBangkok';
const REFRESH_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 8000;

/** sunny | rainy | cloudy | night, from a WMO weather code (Open-Meteo). */
export function conditionFromWeather({ code, isDay, wind = 0 }) {
  const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
  if (rain) return 'rainy';
  if (!isDay) return 'night';
  if (code <= 1 && wind < 25) return 'sunny';
  return 'cloudy';
}

function estimateFromClock(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  return hour >= 18.5 || hour < 6 ? 'night' : 'sunny';
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

const WeatherContext = createContext(null);

async function fetchCampusWeather(signal) {
  const response = await fetch(ENDPOINT, { signal });
  if (!response.ok) throw new Error(`weather ${response.status}`);
  const data = await response.json();
  const current = data?.current;
  if (!current || typeof current.weather_code !== 'number') throw new Error('weather payload');
  return {
    condition: conditionFromWeather({ code: current.weather_code, isDay: current.is_day === 1, wind: current.wind_speed_10m }),
    temperature: Number.isFinite(current.temperature_2m) ? Math.round(current.temperature_2m) : null,
    source: 'live',
    updatedAt: Date.now(),
  };
}

export function WeatherReactiveProvider({ children }) {
  const [weather, setWeather] = useState(() => ({ condition: estimateFromClock(), temperature: null, source: 'estimate', updatedAt: 0 }));
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
        if (active) setWeather(next);
      } catch {
        // Offline or blocked: keep the last live value, else follow the clock.
        if (active) setWeather((current) => (current.source === 'live' ? current : { ...current, condition: estimateFromClock() }));
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

  const value = useMemo(() => ({ ...weather, theme: WEATHER_THEMES[weather.condition] }), [weather]);
  return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}

/** Current campus weather; safe outside the provider (falls back to the clock). */
export function useCampusWeather() {
  const value = useContext(WeatherContext);
  if (value) return value;
  const condition = estimateFromClock();
  return { condition, temperature: null, source: 'estimate', updatedAt: 0, theme: WEATHER_THEMES[condition] };
}
