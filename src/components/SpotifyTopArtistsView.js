import Text from './AppText';
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

const SPOTIFY_GREEN = '#1DB954';

export default function SpotifyTopArtistsView({
  artists = [],
  title = 'ศิลปินที่ฟังบ่อยที่สุดใน Spotify',
}) {
  const { colors, isDark } = useTheme();

  if (!Array.isArray(artists) || artists.length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <FontAwesome5 name="spotify" size={16} color={SPOTIFY_GREEN} style={{ marginRight: 6 }} />
        <Text style={[styles.title, { color: colors.ink || '#111827' }]}>
          {title}
        </Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollList}
      >
        {artists.map((artist, idx) => (
          <View
            key={artist.id || `artist-${idx}`}
            style={[
              styles.artistCard,
              {
                backgroundColor: colors.surface || '#FFFFFF',
                borderColor: colors.line || '#E2E8F0',
              },
            ]}
          >
            {artist.imageUrl ? (
              <Image
                source={{ uri: artist.imageUrl }}
                style={styles.avatar}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={[styles.avatar, styles.fallbackAvatar, { backgroundColor: colors.primarySoft || '#E0E7FF' }]}>
                <FeatureIcon color={colors.primary || '#3986E8'} name="person.fill" size={24} />
              </View>
            )}
            <Text numberOfLines={1} style={[styles.artistName, { color: colors.ink || '#111827' }]}>
              {artist.name}
            </Text>
            {artist.genres?.[0] ? (
              <Text numberOfLines={1} style={[styles.genreText, { color: colors.inkSoft || '#6B7280' }]}>
                {artist.genres[0]}
              </Text>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 10,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginBottom: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  scrollList: {
    gap: 10,
    paddingVertical: 4,
  },
  artistCard: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    width: 96,
  },
  avatar: {
    borderRadius: 36,
    height: 60,
    marginBottom: 6,
    width: 60,
  },
  fallbackAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artistName: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  genreText: {
    fontSize: 10,
    marginTop: 2,
    textAlign: 'center',
    textTransform: 'capitalize',
    width: '100%',
  },
});
