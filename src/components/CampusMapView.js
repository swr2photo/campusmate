import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Platform, StyleSheet, Text, View, Pressable, Linking, useColorScheme, TouchableOpacity } from 'react-native';
import { WebView } from 'react-native-webview';
import { BlurView } from 'expo-blur';
import FeatureIcon from './FeatureIcon';
const PSU_HATYAI_COORDS = {
  latitude: 7.008453,
  longitude: 100.497914,
};

function toCoordinate(value, min, max) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null;
  }
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : null;
}

function getSpotCoordinates(spot) {
  const latitude = toCoordinate(spot?.latitude, -90, 90) ?? toCoordinate(spot?.lat, -90, 90);
  const longitude = toCoordinate(spot?.longitude, -180, 180) ?? toCoordinate(spot?.lng, -180, 180);
  return {
    latitude: latitude ?? PSU_HATYAI_COORDS.latitude,
    longitude: longitude ?? PSU_HATYAI_COORDS.longitude,
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function createHtmlNonce() {
  const randomValues = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(randomValues);
  else randomValues.forEach((_, index) => { randomValues[index] = Math.floor(Math.random() * 256); });
  return Array.from(randomValues, (value) => value.toString(16).padStart(2, '0')).join('');
}

const CATEGORY_COLORS = {
  sports: '#FF7A6B',
  gym: '#FF9500',
  running: '#34C759',
  chill: '#30B0C7',
  cafe: '#AF52DE',
  study: '#5856D6',
  default: '#FF7A6B',
};

/* SF-Symbols-style SVG icon paths per category (simplified for map markers) */
const CATEGORY_ICONS = {
  sports: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 2c1.93 0 3.68.69 5.05 1.83L12 9.17V4zm-6.05 3.83C7.32 6.69 9.07 6 11 6v3.17L5.95 7.83zM4 12c0-1.3.31-2.52.86-3.6L10 12l-5.14 3.6C4.31 14.52 4 13.3 4 12zm2.95 6.17L12 14.83V18c-1.93 0-3.68-.69-5.05-1.83zM13 18v-3.17l5.05 3.34C16.68 19.31 14.93 20 13 20v-2zm6.14-2.4L14 12l5.14-3.6c.55 1.08.86 2.3.86 3.6s-.31 2.52-.86 3.6z" fill="currentColor"/>',
  gym: '<path d="M20.57 14.86L22 13.43 20.57 12 17 15.57 8.43 7 12 3.43 10.57 2 9.14 3.43 7.71 2 5.57 4.14 4.14 2.71 2.71 4.14l1.43 1.43L2 7.71l1.43 1.43L2 10.57 3.43 12 7 8.43 15.57 17 12 20.57 13.43 22l1.43-1.43L16.29 22l2.14-2.14 1.43 1.43 1.43-1.43-1.43-1.43L22 16.29z" fill="currentColor"/>',
  running: '<path d="M13.49 5.48c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-3.6 13.9l1-4.4 2.1 2v6h2v-7.5l-2.1-2 .6-3c1.3 1.5 3.3 2.5 5.5 2.5v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6.09 9.58v5h2v-3.6l1.8-.7" fill="currentColor"/>',
  chill: '<path d="M17 8C8 10 5.9 16.17 3.82 21.34l1.89.66.95-2.3c.48.17.98.3 1.34.3C19 20 22 3 22 3c-1 2-8 2.25-13 3.25S2 11.5 2 13.5s1.75 3.75 1.75 3.75" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  cafe: '<path d="M2 19h18v2H2zM20 3H4v10c0 2.21 1.79 4 4 4h6c2.21 0 4-1.79 4-4v-3h2c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10c0 1.1-.9 2-2 2H8c-1.1 0-2-.9-2-2V5h12v8zm2-5h-2V5h2v3z" fill="currentColor"/>',
  study: '<path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z" fill="currentColor"/>',
  default: '<path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" fill="currentColor"/>',
};

export function openInExternalMaps(spot) {
  if (!spot) return;
  const { latitude: lat, longitude: lng } = getSpotCoordinates(spot);
  const label = encodeURIComponent(spot.name || 'จุดนัดพบ ม.อ.');

  const url = Platform.select({
    ios: `maps:0,0?q=${label}@${lat},${lng}`,
    android: `geo:0,0?q=${lat},${lng}(${label})`,
    default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
  });

  Linking.openURL(url).catch((err) => {
    console.warn('[CampusMapView] Could not open external map:', err);
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`).catch(() => {});
  });
}

function generateMapHtml(spots, selectedSpot, isDark) {
  const spotsJson = serializeForInlineScript(
    spots.map((s) => {
      const { latitude, longitude } = getSpotCoordinates(s);
      return {
        id: s.id,
        name: s.name,
        category: s.category || 'default',
        categoryLabel: s.categoryLabel || s.group || '',
        icon: CATEGORY_ICONS[s.category] || CATEGORY_ICONS.default,
        color: CATEGORY_COLORS[s.category] || CATEGORY_COLORS.default,
        lat: latitude,
        lng: longitude,
        distance: escapeHtml(s.distance || ''),
      };
    })
  );

  // A selected meetup can be an older object saved before a spot's
  // coordinates were corrected. Resolve it against the current list so the
  // map and details card always point to the same pin.
  const currentSelectedSpot = selectedSpot?.id
    ? spots.find((spot) => spot.id === selectedSpot.id) || selectedSpot
    : selectedSpot;
  const { latitude: initialLat, longitude: initialLng } = getSpotCoordinates(currentSelectedSpot);
  const selectedId = currentSelectedSpot?.id || '';
  const selectedIdJson = serializeForInlineScript(String(selectedId));
  const htmlNonce = createHtmlNonce();

  const bg = isDark ? '#14171B' : '#EFE9E1'; // Adjust background for normal map
  const cardBgOpacity = Platform.OS === 'ios' ? '0.97' : '1';
  const cardBg = isDark ? `rgba(30,34,40,${cardBgOpacity})` : `rgba(255,255,255,${cardBgOpacity})`;
  const textColor = isDark ? '#F7F8FA' : '#10203A';
  const subColor = isDark ? '#A0AEC0' : '#64748B';
  const borderColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';

  // Google Maps Standard Roadmap
  const tileUrl = 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${htmlNonce}' https://unpkg.com; style-src 'unsafe-inline' https://unpkg.com; img-src data: https://unpkg.com https://mt1.google.com; connect-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none';" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #map { width: 100%; height: 100%; background: ${bg}; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }

    /* iOS-style pin marker */
    .ios-pin {
      position: relative;
      width: 36px; height: 46px;
      filter: drop-shadow(0 3px 6px rgba(0,0,0,0.28));
      cursor: pointer;
      transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .ios-pin:hover, .ios-pin.active { transform: scale(1.2) translateY(-4px); }
    .ios-pin .pin-head {
      width: 36px; height: 36px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      display: flex; align-items: center; justify-content: center;
      border: 2.5px solid rgba(255,255,255,0.9);
    }
    .ios-pin .pin-head svg {
      width: 16px; height: 16px;
      transform: rotate(45deg);
      color: #FFFFFF;
    }
    .ios-pin .pin-tail {
      width: 2px; height: 8px;
      margin: -2px auto 0;
      border-radius: 0 0 1px 1px;
      opacity: 0.7;
    }
    .ios-pin.active .pin-head { border-color: #FFD60A; }
    .ios-pin.active::after {
      content: '';
      position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%);
      width: 44px; height: 44px;
      border-radius: 50%;
      animation: ripple 1.8s infinite ease-out;
      z-index: -1;
    }
    @keyframes ripple {
      0% { transform: translateX(-50%) scale(0.5); opacity: 0.5; box-shadow: 0 0 0 0 rgba(255,122,107,0.5); }
      100% { transform: translateX(-50%) scale(1.5); opacity: 0; box-shadow: 0 0 0 20px rgba(255,122,107,0); }
    }

    /* Current location blue dot (Apple Maps style) */
    .my-location {
      width: 18px; height: 18px;
      border-radius: 50%;
      background: #007AFF;
      border: 3px solid #FFFFFF;
      box-shadow: 0 0 0 2px rgba(0,122,255,0.3), 0 2px 8px rgba(0,0,0,0.25);
    }
    .my-location-ring {
      position: absolute;
      width: 60px; height: 60px;
      border-radius: 50%;
      background: rgba(0,122,255,0.12);
      border: 1px solid rgba(0,122,255,0.2);
      animation: loc-pulse 3s infinite ease-out;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
    }
    @keyframes loc-pulse {
      0% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
      50% { transform: translate(-50%, -50%) scale(1.2); opacity: 0.6; }
      100% { transform: translate(-50%, -50%) scale(0.8); opacity: 1; }
    }

    /* Leaflet popup override – iOS style */
    .leaflet-popup-content-wrapper {
      background: ${cardBg}; color: ${textColor};
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.22);
      padding: 0; border: 1px solid ${borderColor};
      ${Platform.OS === 'ios' ? 'backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);' : ''}
    }
    .leaflet-popup-tip { background: ${cardBg}; }
    .leaflet-popup-content { margin: 0 !important; }
    .popup-ios {
      padding: 12px 14px; min-width: 180px;
    }
    .popup-ios .popup-header { display: flex; align-items: center; gap: 10px; }
    .popup-ios .popup-icon-wrap {
      width: 32px; height: 32px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .popup-ios .popup-icon-wrap svg { width: 16px; height: 16px; color: #FFF; }
    .popup-ios .popup-name {
      font-size: 13px; font-weight: 700; letter-spacing: -0.2px;
      color: ${textColor}; line-height: 1.3;
    }
    .popup-ios .popup-cat {
      font-size: 11px; font-weight: 600; margin-top: 1px;
    }
    .popup-ios .popup-distance {
      font-size: 10px; font-weight: 500; color: ${subColor};
      margin-top: 6px; display: flex; align-items: center; gap: 4px;
    }
    .popup-ios .popup-distance svg { width: 10px; height: 10px; color: ${subColor}; }

    /* Hide default zoom control styling, show minimal */
    .leaflet-control-zoom { border: none !important; box-shadow: 0 2px 12px rgba(0,0,0,0.15) !important; border-radius: 12px !important; overflow: hidden; }
    .leaflet-control-zoom a { background: ${cardBg} !important; color: ${textColor} !important; border: none !important; width: 36px !important; height: 36px !important; line-height: 36px !important; font-size: 18px !important; }
    .leaflet-control-zoom a:hover { background: ${isDark ? '#333' : '#EEE'} !important; }

    /* Recenter button */
    .recenter-btn {
      position: absolute; bottom: 20px; right: 16px; z-index: 1000;
      width: 40px; height: 40px; border-radius: 12px;
      background: ${cardBg}; border: 1px solid ${borderColor};
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 12px rgba(0,0,0,0.15);
      cursor: pointer; transition: transform 0.15s;
      ${Platform.OS === 'ios' ? 'backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);' : ''}
    }
    .recenter-btn:active { transform: scale(0.9); }
    .recenter-btn svg { width: 18px; height: 18px; color: #007AFF; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="recenter-btn" title="ตำแหน่งของฉัน">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
    </svg>
  </div>
  <script nonce="${htmlNonce}">
    var spots = ${spotsJson};
    var selectedId = ${selectedIdJson};
    var myLocationMarker = null;
    var myLat = null, myLng = null;

    function escapeHtml(value) {
      return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
        return {
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[character];
      });
    }

    var isTablet = window.innerWidth >= 700;
    var map = L.map('map', {
      center: [${initialLat}, ${initialLng}],
      zoom: isTablet ? 15 : 16,
      zoomControl: true,
      attributionControl: false
    });

    L.tileLayer('${tileUrl}', { maxZoom: 19 }).addTo(map);

    // --- SF Symbols-style SVG icon generator ---
    function pinHtml(spot, isActive) {
      return '<div class="ios-pin' + (isActive ? ' active' : '') + '">' +
        '<div class="pin-head" style="background:' + spot.color + ';">' +
          '<svg viewBox="0 0 24 24">' + spot.icon + '</svg>' +
        '</div>' +
        '<div class="pin-tail" style="background:' + spot.color + ';"></div>' +
      '</div>';
    }

    function popupHtml(spot) {
      return '<div class="popup-ios">' +
        '<div class="popup-header">' +
          '<div class="popup-icon-wrap" style="background:' + spot.color + ';">' +
            '<svg viewBox="0 0 24 24">' + spot.icon + '</svg>' +
          '</div>' +
          '<div>' +
          '<div class="popup-name">' + escapeHtml(spot.name) + '</div>' +
          '<div class="popup-cat" style="color:' + spot.color + ';">' + escapeHtml(spot.categoryLabel) + '</div>' +
          '</div>' +
        '</div>' +
        (spot.distance ? '<div class="popup-distance"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>' + spot.distance + '</div>' : '') +
      '</div>';
    }

    var markersMap = {};

    function setActiveMarker(activeId) {
      selectedId = activeId;
      spots.forEach(function(s) {
        if (markersMap[s.id]) {
          markersMap[s.id].setIcon(L.divIcon({
            className: '',
            html: pinHtml(s, s.id === activeId),
            iconSize: [36, 46],
            iconAnchor: [18, 46],
            popupAnchor: [0, -42]
          }));
        }
      });
    }

    function panToSpot(id) {
      if (!markersMap[id]) return;
      var target = spots.find(function(s) { return s.id === id; });
      if (!target) return;
      map.flyTo([target.lat, target.lng], 17, { duration: 0.8 });
      markersMap[id].openPopup();
      setActiveMarker(id);
    }

    window.panToSpot = panToSpot;

    spots.forEach(function(spot) {
      var isActive = spot.id === selectedId;
      var icon = L.divIcon({
        className: '',
        html: pinHtml(spot, isActive),
        iconSize: [36, 46],
        iconAnchor: [18, 46],
        popupAnchor: [0, -42]
      });

      var marker = L.marker([spot.lat, spot.lng], { icon: icon }).addTo(map);
      marker.bindPopup(popupHtml(spot), { closeButton: false, maxWidth: 240 });

      marker.on('click', function() {
        // Deactivate all, activate this one
        setActiveMarker(spot.id);
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SELECT_SPOT', id: spot.id }));
        }
      });

      markersMap[spot.id] = marker;
      if (isActive) { marker.openPopup(); }
    });

    if (!selectedId && spots && spots.length > 1) {
      try {
        var group = L.featureGroup(Object.values(markersMap));
        map.fitBounds(group.getBounds().pad(0.12));
      } catch (e) {}
    }

    // --- My Location (blue dot) ---
    function showMyLocation(lat, lng) {
      myLat = lat; myLng = lng;
      if (myLocationMarker) { map.removeLayer(myLocationMarker); }
      var locIcon = L.divIcon({
        className: '',
        html: '<div style="position:relative;width:60px;height:60px;"><div class="my-location-ring"></div><div class="my-location" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);"></div></div>',
        iconSize: [60, 60],
        iconAnchor: [30, 30]
      });
      myLocationMarker = L.marker([lat, lng], { icon: locIcon, interactive: false, zIndexOffset: -100 }).addTo(map);
    }

    var locationWatchId = null;

    function stopWatchingLocation() {
      if (locationWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
      }
    }

    window.teardownMap = stopWatchingLocation;
    window.addEventListener('pagehide', stopWatchingLocation);
    window.addEventListener('beforeunload', stopWatchingLocation);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        function(pos) { showMyLocation(pos.coords.latitude, pos.coords.longitude); },
        function() {},
        { enableHighAccuracy: true, timeout: 8000 }
      );
      locationWatchId = navigator.geolocation.watchPosition(
        function(pos) { showMyLocation(pos.coords.latitude, pos.coords.longitude); },
        function() {},
        { enableHighAccuracy: true }
      );
    }

    function recenterToMe() {
      if (myLat !== null && myLng !== null) {
        map.flyTo([myLat, myLng], 17, { duration: 0.6 });
      } else {
        map.flyTo([${initialLat}, ${initialLng}], 16, { duration: 0.6 });
      }
    }

    document.querySelector('.recenter-btn').addEventListener('click', recenterToMe);

    // --- Messages from RN ---
    window.addEventListener('message', function(event) {
      try {
        var data = JSON.parse(event.data);
        if (data.type === 'PAN_TO') {
          panToSpot(data.id);
        } else if (data.type === 'TEARDOWN') {
          stopWatchingLocation();
        }
      } catch(e) {}
    });
  <\/script>
</body>
</html>
`;
}

export default function CampusMapView({
  spots = [],
  selectedSpot = null,
  onSelectSpot,
  onScheduleSpot,
  style,
  height = 360,
}) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const webViewRef = useRef(null);

  // null initially → no card shown until user taps a marker
  const [activeSpotId, setActiveSpotId] = useState(null);

  const activeSpot = useMemo(() => {
    if (activeSpotId) {
      return spots.find((s) => s.id === activeSpotId) || null;
    }
    return null;
  }, [activeSpotId, spots]);

  // Changing the selection must not regenerate the HTML: a new `source.html`
  // reloads Leaflet and every marker. Selection is pushed into the live page
  // instead, so the initial spot is only read when the page is first built.
  const initialSelectedSpotRef = useRef(selectedSpot);
  const isMapReadyRef = useRef(false);
  const pendingPanIdRef = useRef('');
  const renderedSelectedIdRef = useRef(String(selectedSpot?.id || ''));

  const htmlContent = useMemo(() => {
    return generateMapHtml(spots, initialSelectedSpotRef.current, isDark);
  }, [spots, isDark]);

  const webViewSource = useMemo(() => ({ html: htmlContent }), [htmlContent]);

  const panToSpotInWebView = useCallback((spotId) => {
    if (!spotId) return;
    if (!isMapReadyRef.current) {
      pendingPanIdRef.current = String(spotId);
      return;
    }
    webViewRef.current?.injectJavaScript(
      `window.panToSpot && window.panToSpot(${serializeForInlineScript(String(spotId))}); true;`
    );
  }, []);

  useEffect(() => {
    if (activeSpot) {
      panToSpotInWebView(activeSpot.id);
    }
  }, [activeSpot?.id, panToSpotInWebView]);

  useEffect(() => {
    const spotId = String(selectedSpot?.id || '');
    if (spotId === renderedSelectedIdRef.current) return;
    renderedSelectedIdRef.current = spotId;
    panToSpotInWebView(spotId);
  }, [selectedSpot?.id, panToSpotInWebView]);

  useEffect(() => () => {
    try {
      webViewRef.current?.injectJavaScript('window.teardownMap && window.teardownMap(); true;');
    } catch (e) {}
  }, []);

  const handleLoadEnd = () => {
    isMapReadyRef.current = true;
    const pendingId = pendingPanIdRef.current;
    if (pendingId) {
      pendingPanIdRef.current = '';
      panToSpotInWebView(pendingId);
    }
  };

  const handleMessage = (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'SELECT_SPOT' && typeof data.id === 'string' && spots.some((spot) => String(spot.id) === data.id)) {
        setActiveSpotId(data.id);
      }
    } catch (e) {
      console.warn('[CampusMapView] Error parsing webview message:', e);
    }
  };

  const handleDismissCard = () => {
    setActiveSpotId(null);
  };

  return (
    <View style={[styles.container, { height }, style]}>
      {Platform.OS === 'web' ? (
        <iframe
          srcDoc={htmlContent}
          sandbox="allow-scripts"
          style={{ width: '100%', height: '100%', border: 'none' }}
          title="Campus Map"
        />
      ) : (
        <WebView
          ref={webViewRef}
          source={webViewSource}
          style={styles.webView}
          onLoadEnd={handleLoadEnd}
          onMessage={handleMessage}
          scrollEnabled={false}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          originWhitelist={['about:blank']}
          geolocationEnabled
          allowsInlineMediaPlayback
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows={false}
          mixedContentMode="never"
          thirdPartyCookiesEnabled={false}
        />
      )}

      {/* Floating Card – only shown after tapping a marker */}
      {activeSpot && (
        <View style={styles.floatingCardContainer}>
          <BlurView
            intensity={isDark ? 50 : 80}
            tint={isDark ? 'dark' : 'light'}
            style={[
              styles.floatingCard,
              {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.06)',
                backgroundColor: Platform.OS === 'android' ? (isDark ? 'rgba(30, 34, 40, 0.98)' : 'rgba(255, 255, 255, 0.98)') : undefined,
              },
            ]}
          >
            {/* Drag indicator */}
            <View style={styles.dragIndicator}>
              <View style={[styles.dragBar, { backgroundColor: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)' }]} />
            </View>

          <View style={styles.cardHeader}>
            <View
              style={[
                styles.cardIconBox,
                { backgroundColor: CATEGORY_COLORS[activeSpot.category] || '#FF7A6B' },
              ]}
            >
              <FeatureIcon
                color="#FFFFFF"
                name={
                  activeSpot.category === 'sports' ? 'sportscourt.fill' :
                  activeSpot.category === 'gym' ? 'dumbbell.fill' :
                  activeSpot.category === 'running' ? 'figure.run' :
                  activeSpot.category === 'chill' ? 'leaf.fill' :
                  activeSpot.category === 'cafe' ? 'cup.and.saucer.fill' :
                  activeSpot.category === 'study' ? 'book.fill' : 'mappin.and.ellipse'
                }
                size={18}
              />
            </View>
            <View style={styles.cardInfo}>
              <Text style={[styles.cardTitle, { color: isDark ? '#FFFFFF' : '#10203A' }]} numberOfLines={1}>
                {activeSpot.name}
              </Text>
              <Text style={[styles.cardCategory, { color: CATEGORY_COLORS[activeSpot.category] || '#FF7A6B' }]}>
                {activeSpot.categoryLabel || activeSpot.group}
              </Text>
              {activeSpot.distance ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
                  <FeatureIcon color={isDark ? '#A0AEC0' : '#64748B'} name="location.fill" size={10} style={{ marginRight: 4 }} />
                  <Text style={[styles.cardDistance, { color: isDark ? '#A0AEC0' : '#64748B' }]}>
                    {activeSpot.distance}
                  </Text>
                </View>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={handleDismissCard}
              style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: isDark ? '#333' : '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}
            >
              <FeatureIcon color={isDark ? '#FFF' : '#333'} name="xmark" size={12} />
            </TouchableOpacity>
          </View>

          {activeSpot.description ? (
            <Text style={[styles.cardDesc, { color: isDark ? '#A0AEC0' : '#64748B' }]} numberOfLines={2}>
              {activeSpot.description}
            </Text>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', gap: 8, marginTop: 8 }}>
            {onSelectSpot && (
              <TouchableOpacity
                onPress={() => onSelectSpot(activeSpot)}
                style={[styles.actionButton, { backgroundColor: CATEGORY_COLORS[activeSpot.category] || '#FF7A6B' }]}
              >
                <FeatureIcon color="#FFFFFF" name="checkmark" size={14} />
                <Text style={styles.actionButtonText}>ปักหมุด</Text>
              </TouchableOpacity>
            )}
            {onScheduleSpot && (
              <TouchableOpacity
                onPress={() => onScheduleSpot(activeSpot)}
                style={[styles.actionButton, { backgroundColor: isDark ? '#333' : '#F1F5F9' }]}
              >
                <FeatureIcon color={isDark ? '#FFF' : '#333'} name="clock.fill" size={14} />
                <Text style={[styles.actionButtonText, { color: isDark ? '#FFF' : '#333' }]}>ตั้งเวลา</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => openInExternalMaps(activeSpot)}
              style={[styles.actionButton, { backgroundColor: isDark ? '#333' : '#F1F5F9' }]}
            >
              <FeatureIcon color="#007AFF" name="map.fill" size={14} />
              <Text style={[styles.actionButtonText, { color: '#007AFF' }]}>Maps</Text>
            </TouchableOpacity>
          </View>
        </BlurView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 22,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  floatingCardContainer: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  floatingCard: {
    borderRadius: 20,
    overflow: 'hidden',
    padding: 14,
    paddingTop: 8,
    borderWidth: 1,
  },
  dragIndicator: {
    alignItems: 'center',
    marginBottom: 8,
  },
  dragBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  cardIconText: {
    fontSize: 18,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  cardCategory: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  cardDistance: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  actionButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFF',
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 6,
  },
  closeBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  cardDesc: {
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 7,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  secondaryBtn: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
});
