import Text from './AppText';
/**
 * SpotifyConnectCard.js
 * ─────────────────────
 * UI card for connecting/disconnecting Spotify Premium account.
 * Shows connection status and Premium badge.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FeatureIcon from './FeatureIcon';
import AppAlert from './AppAlert';
import {
  getSpotifyConnectionStatus,
  loginWithSpotify,
  disconnectSpotify,
  fetchSpotifyTopArtists,
} from '../services/spotifyAuthService';
import SpotifyNowPlayingCard from './SpotifyNowPlayingCard';
import { useTheme } from '../theme';

// Spotify brand green
const SPOTIFY_GREEN = '#1DB954';
const SPOTIFY_BLACK = '#191414';

export default function SpotifyConnectCard({ onConnectionChange, onSyncMusic }) {
  const { colors } = useTheme();
  const [status, setStatus] = useState({ connected: false });
  const [loading, setLoading] = useState(true);

  const [alertConfig, setAlertConfig] = useState(null);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    const s = await getSpotifyConnectionStatus();
    setStatus(s);
    setLoading(false);
  }, []);

  const syncTopArtists = useCallback(async (token) => {
    if (!token) return;
    try {
      const artists = await fetchSpotifyTopArtists(token, 5);
      if (artists && artists.length > 0) {
        const allGenres = Array.from(new Set(artists.flatMap((a) => a.genres || []))).slice(0, 5);
        onSyncMusic?.({ topArtists: artists, topGenres: allGenres });
      }
    } catch (_) {}
  }, [onSyncMusic]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (status.connected && status.accessToken) {
      syncTopArtists(status.accessToken);
    }
  }, [status.connected, status.accessToken, syncTopArtists]);

  const hideAlert = () => setAlertConfig(null);

  const handleConnect = useCallback(async () => {
    setLoading(true);
    const result = await loginWithSpotify();
    if (result.success) {
      await checkStatus();
      onConnectionChange?.(true, result.isPremium);
      if (!result.isPremium) {
        setAlertConfig({
          visible: true,
          title: 'Spotify Free Account',
          message: 'บัญชีของคุณไม่ใช่ Spotify Premium\nจะสามารถใช้ฟีเจอร์บางอย่างได้ แต่การเล่นเพลงเต็มต้องใช้ Premium เท่านั้นครับ',
          tone: 'error',
          icon: 'music.note',
          buttonLabel: 'เข้าใจแล้ว',
          onClose: hideAlert,
        });
      }
    } else {
      setLoading(false);
      if (result.error) {
        setAlertConfig({
          visible: true,
          title: 'เชื่อมต่อไม่สำเร็จ',
          message: result.error,
          tone: 'error',
          icon: 'exclamationmark.triangle.fill',
          onClose: hideAlert,
        });
      }
    }
  }, [checkStatus, onConnectionChange]);

  const handleDisconnect = useCallback(() => {
    setAlertConfig({
      visible: true,
      title: 'ยกเลิกการเชื่อมต่อ Spotify',
      message: 'คุณต้องการยกเลิกการเชื่อมต่อบัญชี Spotify หรือไม่?',
      tone: 'error',
      icon: 'trash.fill',
      showCancelButton: true,
      cancelLabel: 'ยกเลิก',
      buttonLabel: 'ยกเลิกการเชื่อมต่อ',
      onCancel: hideAlert,
      onClose: async () => {
        hideAlert();
        await disconnectSpotify();
        setStatus({ connected: false });
        onConnectionChange?.(false, false);
      },
    });
  }, [onConnectionChange]);

  const renderContent = () => {
    if (loading) {
      return (
        <View style={[styles.card, { backgroundColor: colors.surface || '#FFF', borderColor: colors.line || '#E2E8F0' }]}>
          <ActivityIndicator color={SPOTIFY_GREEN} />
          <Text style={[styles.loadingText, { color: colors.inkSoft }]}>กำลังตรวจสอบ Spotify...</Text>
        </View>
      );
    }

    if (status.connected) {
      return (
        <View style={[styles.card, { backgroundColor: SPOTIFY_BLACK, borderColor: '#333' }]}>
          <View style={styles.headerRow}>
            <View style={styles.spotifyBrand}>
              <FontAwesome5 name="spotify" size={20} color={SPOTIFY_GREEN} style={{ marginRight: 6 }} />
              <Text style={[styles.spotifyLabel, { color: '#FFF' }]}>Spotify</Text>
              {status.isPremium ? (
                <View style={styles.premiumBadge}>
                  <Text style={styles.premiumText}>PREMIUM</Text>
                </View>
              ) : (
                <View style={[styles.premiumBadge, { backgroundColor: '#555' }]}>
                  <Text style={styles.premiumText}>FREE</Text>
                </View>
              )}
            </View>
            <Pressable onPress={handleDisconnect} hitSlop={8}>
              <Text style={styles.disconnectText}>ยกเลิก</Text>
            </Pressable>
          </View>

          <View style={styles.userRow}>
            <FeatureIcon color="#FFF" name="person.fill" size={14} />
            <Text style={styles.userName}>{status.displayName}</Text>
          </View>

          {status.isPremium ? (
            <View style={styles.featureRow}>
              <FeatureIcon color={SPOTIFY_GREEN} name="checkmark.circle.fill" size={14} />
              <Text style={styles.featureText}>
                เชื่อมต่อ Spotify Premium · แนะนำเพลงและเทียบรสนิยมดนตรีอัตโนมัติ
              </Text>
            </View>
          ) : (
            <View style={styles.featureRow}>
              <FeatureIcon color="#F59E0B" name="exclamationmark.triangle.fill" size={14} />
              <Text style={[styles.featureText, { color: '#F59E0B' }]}>
                อัปเกรดเป็น Premium เพื่อเทียบรสนิยมเพลงเต็มรูปแบบ
              </Text>
            </View>
          )}

          <View style={{ marginTop: 10 }}>
            <SpotifyNowPlayingCard />
          </View>
        </View>
      );
    }

    return (
      <Pressable
        onPress={handleConnect}
        style={({ pressed }) => [
          styles.card,
          { backgroundColor: colors.surface || '#FFF', borderColor: colors.line || '#E2E8F0' },
          pressed && { opacity: 0.9 },
        ]}
      >
        <View style={styles.connectRow}>
          <FontAwesome5 name="spotify" size={32} color={SPOTIFY_GREEN} style={{ marginRight: 12 }} />
          <View style={styles.connectCopy}>
            <Text style={[styles.connectTitle, { color: colors.ink }]}>เชื่อมต่อ Spotify Premium</Text>
            <Text style={[styles.connectSub, { color: colors.inkSoft }]}>
              เล่นเพลงเต็มคุณภาพสูง 320kbps แทน YouTube
            </Text>
          </View>
          <FeatureIcon color={colors.inkSoft || '#6B7078'} name="chevron.right" size={16} />
        </View>
      </Pressable>
    );
  };

  return (
    <>
      {renderContent()}
      <AppAlert {...alertConfig} />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 26,
    borderCurve: 'continuous',
    borderWidth: 0,
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
  },
  loadingText: {
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  spotifyBrand: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  spotifyDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  spotifyLabel: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
  },
  premiumBadge: {
    backgroundColor: SPOTIFY_GREEN,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  premiumText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  disconnectText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  userRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  userName: {
    color: '#CCC',
    fontSize: 14,
    fontWeight: '500',
  },
  featureRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  featureText: {
    color: SPOTIFY_GREEN,
    fontSize: 12,
    fontWeight: '600',
  },
  connectRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  spotifyIconCircle: {
    alignItems: 'center',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  connectCopy: {
    flex: 1,
  },
  connectTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  connectSub: {
    fontSize: 12,
    marginTop: 2,
  },
});
