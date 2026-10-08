import Text from './AppText';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

const SPOTIFY_GREEN = '#1DB954';

export default function SpotifyTasteMatchCard({
  matchResult,
  peerName = 'เพื่อน',
}) {
  const { colors, isDark } = useTheme();

  if (!matchResult) return null;

  const { commonArtists = [], commonGenres = [], commonTracks = [], score = 50 } = matchResult;

  // Determine badge color tone based on score
  const isHighMatch = score >= 80;
  const badgeColor = isHighMatch ? SPOTIFY_GREEN : (score >= 65 ? (colors.primary || '#3986E8') : '#8B5CF6');

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark ? 'rgba(29, 185, 84, 0.08)' : '#F0FDF4',
          borderColor: isDark ? 'rgba(29, 185, 84, 0.28)' : '#BBF7D0',
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleWithIcon}>
          <FontAwesome5 name="spotify" size={18} color={SPOTIFY_GREEN} style={{ marginRight: 6 }} />
          <Text style={[styles.cardTitle, { color: isDark ? '#FFFFFF' : '#14532D' }]}>
            ความเข้ากันทางดนตรี
          </Text>
        </View>
        <View style={[styles.scoreBadge, { backgroundColor: badgeColor }]}>
          <Text style={styles.scoreText}>{score}% MATCH</Text>
        </View>
      </View>

      <Text style={[styles.summaryText, { color: isDark ? '#A7F3D0' : '#166534' }]}>
        คุณกับ{peerName} มีรสนิยมการฟังเพลงตรงกัน {score}%
      </Text>

      {commonArtists.length > 0 ? (
        <View style={styles.detailRow}>
          <FeatureIcon color={SPOTIFY_GREEN} name="music.mic" size={13} />
          <Text style={[styles.detailLabel, { color: colors.inkSoft || '#4B5563' }]}>
            ศิลปินที่ชอบเหมือนกัน:
          </Text>
          <Text numberOfLines={1} style={[styles.detailValue, { color: colors.ink || '#111827' }]}>
            {commonArtists.slice(0, 3).join(', ')}
            {commonArtists.length > 3 ? ` +อีก ${commonArtists.length - 3}` : ''}
          </Text>
        </View>
      ) : null}

      {commonGenres.length > 0 ? (
        <View style={styles.genresRow}>
          {commonGenres.slice(0, 4).map((genre) => (
            <View
              key={genre}
              style={[
                styles.genreChip,
                {
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#DCFCE7',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : '#86EFAC',
                },
              ]}
            >
              <Text style={[styles.genreText, { color: isDark ? '#E5E7EB' : '#15803D' }]}>
                {genre}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {commonTracks.length > 0 ? (
        <View style={styles.detailRow}>
          <FeatureIcon color={SPOTIFY_GREEN} name="music.note.list" size={13} />
          <Text style={[styles.detailValue, { color: colors.ink || '#111827' }]}>
            มีเพลงโปรดตรงกัน {commonTracks.length} เพลง
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginVertical: 8,
    padding: 14,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  titleWithIcon: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  scoreBadge: {
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  scoreText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  summaryText: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
  },
  detailRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: 5,
  },
  detailLabel: {
    fontSize: 12,
    marginLeft: 6,
    marginRight: 4,
  },
  detailValue: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  genresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  genreChip: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  genreText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
