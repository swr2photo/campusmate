import Text from './AppText';
import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Image from './CachedImage';
import { useAppFeed } from '../context/AppContext';
import { useTheme } from '../theme';

const DEFAULT_PLACE_PHOTOS = {
  // 1. สนามกีฬา และประเภทกีฬา (Sports & Fitness)
  'spot-gym-complex': require('../assets/images/campus/DSC_5070.jpg'),
  'spot-indoor-stadium': require('../assets/images/campus/DSC_5070.jpg'),
  'spot-tennis-courts': require('../assets/images/campus/DSC_5071.jpg'),
  'spot-swimming-pool': require('../assets/images/campus/DSC_5070.jpg'),
  'spot-fitness-center': require('../assets/images/campus/DSC_5070.jpg'),
  'spot-psu-stadium': require('../assets/images/campus/DSC_5071.jpg'),
  'spot-dorm-sports': require('../assets/images/campus/DSC_5071.jpg'),
  'spot-beach-volleyball-petanque': require('../assets/images/campus/DSC_5071.jpg'),

  // 2. โซนนั่งเล่นและพักผ่อนหย่อนใจ (Chill & Relax Zones)
  'spot-reservoir-heart': require('../assets/images/campus/DSC_3614.jpg'),
  'spot-plaza-dorm': require('../assets/images/campus/DSC_8697.jpg'),
  'spot-rong-chang': require('../assets/images/campus/DSC_8697.jpg'),
  'spot-lan-sai-sci': require('../assets/images/campus/DSC_2415.jpg'),
  'spot-eng-plaza': require('../assets/images/campus/DSC_1217.jpg'),
  'spot-med-garden': require('../assets/images/campus/DSC_2415.jpg'),
  'spot-nursing-pavilion': require('../assets/images/campus/DSC_3614.jpg'),
  'spot-icc-hatyai': require('../assets/images/campus/DSC_1217.jpg'),
  'spot-natural-museum': require('../assets/images/campus/DSC_2460.jpg'),

  // 3. คาเฟ่และร้านกาแฟ (Cafes & Coffee Shops)
  'spot-upstairs-cafe': require('../assets/images/campus/DSC_2460.jpg'),
  'spot-peaberries-pharm': require('../assets/images/campus/DSC_2460.jpg'),
  'spot-chadpedmini-sci': require('../assets/images/campus/DSC_2415.jpg'),
  'spot-black-canyon-hospital': require('../assets/images/campus/DSC_1217.jpg'),
  'spot-cafe-rongchang': require('../assets/images/campus/DSC_8697.jpg'),
  'spot-econ-cafe': require('../assets/images/campus/DSC_2460.jpg'),

  // 4. โซนอ่านหนังสือ / Co-working Space (Study & Co-working Zones)
  'spot-lib-the-forest-24h': require('../assets/images/campus/DSC_2460.jpg'),
  'spot-lib-the-space-24h': require('../assets/images/campus/DSC_2460.jpg'),
  'spot-lib-red-square': require('../assets/images/campus/DSC_1217.jpg'),
  'spot-lib-board-game': require('../assets/images/campus/DSC_8697.jpg'),
  'spot-lrc-learning-center': require('../assets/images/campus/DSC_1217.jpg'),
  'spot-med-library': require('../assets/images/campus/DSC_2460.jpg'),
  'spot-eng-library': require('../assets/images/campus/DSC_1217.jpg'),
  'spot-fms-coworking': require('../assets/images/campus/DSC_2460.jpg'),
};

const CATEGORY_DEFAULT_PHOTOS = {
  sports: require('../assets/images/campus/DSC_5070.jpg'),
  gym: require('../assets/images/campus/DSC_5070.jpg'),
  running: require('../assets/images/campus/DSC_5071.jpg'),
  chill: require('../assets/images/campus/DSC_3614.jpg'),
  cafe: require('../assets/images/campus/DSC_2460.jpg'),
  study: require('../assets/images/campus/DSC_2460.jpg'),
};

const CAMPUS_FALLBACK_PHOTO = require('../assets/images/campus/DSC_1217.jpg');

export default function PlacePhoto({ spot, style, contentFit = 'cover' }) {
  const { colors } = useTheme();
  const { campusSpots = [] } = useAppFeed();
  const current = campusSpots.find((entry) => entry.id === spot?.id) || spot;
  const photo = current?.placePhoto;
  const uri = photo?.thumbnailUrl || photo?.url;

  const localDefault = current?.id && DEFAULT_PLACE_PHOTOS[current.id]
    ? DEFAULT_PLACE_PHOTOS[current.id]
    : (current?.category && CATEGORY_DEFAULT_PHOTOS[current.category]
      ? CATEGORY_DEFAULT_PHOTOS[current.category]
      : CAMPUS_FALLBACK_PHOTO);

  const [failedUri, setFailedUri] = useState(null);
  const [retry, setRetry] = useState(0);

  const activeSource = uri && failedUri !== uri ? { uri } : localDefault;
  const isUsingRemote = Boolean(uri && failedUri !== uri);

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceRaised }, style]}>
      <Image
        key={isUsingRemote ? `${uri}:${retry}` : `local:${current?.id || 'default'}`}
        imageIdentity={`place:${current?.id || 'spot'}`}
        source={activeSource}
        contentFit={contentFit}
        style={StyleSheet.absoluteFill}
        onLoad={() => setFailedUri(null)}
        onError={() => setFailedUri(uri)}
      />
      {photo?.credit && isUsingRemote ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`เครดิตภาพ ${photo.credit} ${photo.license}`}
          onPress={() => {
            if (/^https:\/\//.test(photo.sourceUrl || '')) void Linking.openURL(photo.sourceUrl).catch(() => {});
          }}
          style={styles.credit}
        >
          <Text numberOfLines={1} style={styles.creditText}>
            ภาพ: {photo.credit} · {photo.license}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },
  credit: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 3,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  creditText: { color: '#fff', fontSize: 9 },
});
