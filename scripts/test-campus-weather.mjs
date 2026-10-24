import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

// Loads the pure weather helpers from WeatherContext.js without React Native.
const require = createRequire(import.meta.url), babel = require('@babel/core');
const presetRequire = createRequire(require.resolve('babel-preset-expo'));
const source = readFileSync('src/context/WeatherContext.js', 'utf8')
  .replace(/^import .*$/gm, '')
  .replace(/^export (?=(function|const))/gm, '');
const code = babel.transformSync(source, { configFile: false, babelrc: false, plugins: [presetRequire('@babel/plugin-transform-react-jsx')] }).code;
const context = vm.createContext({ React: { createElement() {} }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) }, createContext: () => ({}), Date, Math, Number });
vm.runInContext(`${code}\nglobalThis.api = { sunTimes, isDaytime, describeWeather, WEATHER_THEMES };`, context);
const { sunTimes, isDaytime, describeWeather, WEATHER_THEMES } = context.api;

// 24 Oct 2026 at PSU Hat Yai, from Open-Meteo: sunrise 06:04:43, sunset 17:59:47 (+07:00).
const SUNRISE = 1792796683000;
const SUNSET = 1792839587000;
const at = (hhmm) => Date.parse(`2026-10-24T${hhmm}:00+07:00`);

test('the computed sun times for campus are within two minutes of the forecast', () => {
  const { sunrise, sunset } = sunTimes(at('12:00'));
  assert.ok(Math.abs(sunrise - SUNRISE) < 120000, `sunrise off by ${(sunrise - SUNRISE) / 1000}s`);
  assert.ok(Math.abs(sunset - SUNSET) < 120000, `sunset off by ${(sunset - SUNSET) / 1000}s`);
});

test('night starts at the real sunset, not at a fixed hour', () => {
  const days = [{ sunrise: SUNRISE, sunset: SUNSET }, { sunrise: SUNRISE + 86400000, sunset: SUNSET + 86400000 }];
  assert.equal(isDaytime(at('17:58'), days), true);
  assert.equal(isDaytime(at('18:01'), days), false, 'after a 18:00 sunset it is night, even before 18:30');
  assert.equal(isDaytime(at('23:30'), days), false);
  assert.equal(isDaytime(at('05:50'), days), false);
  assert.equal(isDaytime(at('06:10'), days), true);
  // Offline the sun is computed instead.
  assert.equal(isDaytime(at('18:10')), false);
  assert.equal(isDaytime(at('09:00')), true);
});

test('scenes stay within the four the backdrops draw, with precise labels', () => {
  const cases = [
    [{ code: 3, isDay: false, cloud: 98 }, 'night', 'คืนนี้ฟ้าครึ้ม'],
    [{ code: 0, isDay: false, cloud: 5 }, 'night', 'คืนฟ้าโปร่ง'],
    [{ code: 95, isDay: true }, 'rainy', 'ฝนฟ้าคะนอง'],
    [{ code: 63, isDay: false }, 'rainy', 'ฝนตกยามค่ำ'],
    [{ code: 3, isDay: true, cloud: 40, precipitation: 0.6 }, 'rainy', 'ฝนพรำ'],
    [{ code: 51, isDay: true }, 'rainy', 'ฝนปรอย'],
    [{ code: 45, isDay: true }, 'cloudy', 'หมอกลง'],
    [{ code: 0, isDay: true, cloud: 10 }, 'sunny', 'แดดสดใส'],
    [{ code: 1, isDay: true, cloud: 40 }, 'sunny', 'แดดปนเมฆ'],
    [{ code: 0, isDay: true, cloud: 10, nearSunset: true }, 'sunny', 'แดดยามเย็น'],
    [{ code: 2, isDay: true, cloud: 65 }, 'cloudy', 'เมฆเยอะ'],
    [{ code: 3, isDay: true, cloud: 95, wind: 30 }, 'cloudy', 'ฟ้าครึ้ม ลมแรง'],
  ];
  for (const [reading, condition, label] of cases) {
    const result = describeWeather(reading);
    assert.equal(result.condition, condition, JSON.stringify(reading));
    assert.equal(result.label, label, JSON.stringify(reading));
    assert.ok(WEATHER_THEMES[result.condition]);
  }
});
