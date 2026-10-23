import { Pressable } from './NativePressable';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaskedView from '@react-native-masked-view/masked-view';
import Text from './AppText';
import CachedImage from './CachedImage';
import { EmptyPhotoScene } from './illustrations';
import { getImageRequestUri } from '../utils/useRemoteImage';
import { getProfilePhotos } from '../utils/discoveryPresentation';

export default function ProfilePhotoCarousel({ profile, width, height, children, interactive = true, swipePhotos = true, tapToChangePhotos = true, topInset = 0, footerBlurHeight = 0, onPress }) {
  const photos = getProfilePhotos(profile, getImageRequestUri);
  // One photo has nothing to page through. Several photos keep the pager,
  // including side taps, even when the card itself also handles a swipe.
  if (photos.length <= 1) {
    return (
      <StillPhoto
        profile={profile}
        photos={photos}
        width={width}
        height={height}
        footerBlurHeight={footerBlurHeight}
        onPress={onPress}
      >
        {children}
      </StillPhoto>
    );
  }
  // A renewed URL may remount the image, but must not reset the selected photo.
  return <PhotoSet key={profile?.id} profile={profile} photos={photos} width={width} height={height} interactive={interactive} swipePhotos={swipePhotos} tapToChangePhotos={tapToChangePhotos} topInset={topInset} footerBlurHeight={footerBlurHeight} onPress={onPress}>{children}</PhotoSet>;
}

function StillPhoto({ profile, photos, width, height, children, footerBlurHeight = 0, onPress }) {
  const givenWidth = typeof width === 'number' && width > 0 ? width : 0;
  const givenHeight = typeof height === 'number' && height > 0 ? height : 0;
  const [measuredWidth, setMeasuredWidth] = useState(givenWidth);
  const frameWidth = givenWidth || measuredWidth;
  const frameHeight = givenHeight;
  return (
    <View
      collapsable={false}
      onLayout={(event) => {
        const next = Math.round(event?.nativeEvent?.layout?.width || 0);
        if (!givenWidth && next > 0 && next !== measuredWidth) setMeasuredWidth(next);
      }}
      style={{
        width: givenWidth || '100%',
        height: givenHeight || '100%',
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#262B33',
      }}
    >
      <Photo
        key={`${profile?.id || 'profile'}:${photos[0] || 'empty'}:${profile?.avatarRevision || ''}`}
        uri={photos[0] || null}
        identity={`${profile?.id || 'profile'}:${profile?.avatarRevision || ''}`}
        width={frameWidth || undefined}
        height={frameHeight || undefined}
        footerBlurHeight={footerBlurHeight}
        onPress={onPress}
      />
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{children}</View>
    </View>
  );
}

function PhotoSet({ profile, photos, width, height, children, interactive = true, swipePhotos = true, tapToChangePhotos = true, topInset = 0, footerBlurHeight = 0, onPress }) {
  const [index, setIndex] = useState(0);
  const scrollRef = useRef(null);
  const [layoutWidth, setLayoutWidth] = useState(typeof width === 'number' && width > 0 ? width : 0);
  const pageWidth = (typeof width === 'number' && width > 0 ? width : layoutWidth) || 0;
  const selected = Math.min(index, Math.max(0, photos.length - 1));
  const selectedPage = useRef(selected);
  selectedPage.current = selected;
  const items = photos.length > 0 ? photos : [null];
  const moveTo = (next) => {
    const target = Math.max(0, Math.min(next, photos.length - 1));
    setIndex(target);
    scrollRef.current?.scrollTo({ x: target * pageWidth, animated: false });
  };
  // Keep the actual page and its label aligned after rotation or a gallery update.
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: selectedPage.current * pageWidth, animated: false });
  }, [pageWidth, photos.length]);

  const handleScroll = (event) => {
    const offsetX = event?.nativeEvent?.contentOffset?.x;
    const measured = event?.nativeEvent?.layoutMeasurement?.width || pageWidth;
    if (typeof offsetX !== 'number' || !measured || measured <= 0) return;
    const nextIndex = Math.max(0, Math.min(Math.round(offsetX / measured), Math.max(0, photos.length - 1)));
    if (nextIndex !== selected) setIndex(nextIndex);
  };

  return (
    <View
      onLayout={(event) => {
        const nextWidth = Math.round(event?.nativeEvent?.layout?.width || 0);
        if (nextWidth > 0 && nextWidth !== layoutWidth) setLayoutWidth(nextWidth);
      }}
      style={{ width: width || '100%', height: height || '100%', backgroundColor: '#262B33', overflow: 'hidden' }}
    >
      {pageWidth > 0 ? <ScrollView
        ref={scrollRef}
        accessibilityLabel="เลื่อนดูรูปโปรไฟล์และแกลเลอรี"
        accessibilityValue={{ text: photos.length ? `รูป ${selected + 1} จาก ${photos.length}` : 'ยังไม่มีรูป' }}
        accessibilityActions={interactive && photos.length > 1 ? [{ name: 'increment', label: 'รูปถัดไป' }, { name: 'decrement', label: 'รูปก่อนหน้า' }] : []}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === 'increment') moveTo(selected + 1);
          if (nativeEvent.actionName === 'decrement') moveTo(selected - 1);
        }}
        bounces={false}
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        onMomentumScrollEnd={handleScroll}
        onScroll={handleScroll}
        pagingEnabled
        scrollEnabled={Boolean(interactive && swipePhotos && photos.length > 1)}
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={StyleSheet.absoluteFill}
      >
        {items.map((uri, itemIndex) => (
          <Pressable
            key={`${uri || 'empty'}-${itemIndex}`}
            collapsable={false}
            disabled={!onPress}
            accessibilityRole={onPress ? 'button' : undefined}
            accessibilityLabel={onPress ? 'ดูรายละเอียดโปรไฟล์' : undefined}
            onPress={onPress}
            style={{ width: pageWidth || width || '100%', height: height || '100%', position: 'relative', overflow: 'hidden' }}
          >
            <Photo
              uri={uri}
              identity={`${profile?.id}:${itemIndex}:${profile?.avatarRevision || ''}`}
              width={pageWidth || width}
              height={height}
              footerBlurHeight={footerBlurHeight}
            />
          </Pressable>
        ))}
      </ScrollView> : null}
      <LinearGradient pointerEvents="none" colors={['rgba(0,0,0,0.22)', 'transparent', 'rgba(0,0,0,0.78)']} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
      {photos.length > 1 ? (
        <View pointerEvents="none" style={[styles.indicatorsRow, { top: topInset + 14 }]}>
          {photos.map((uri, dotIndex) => (
            <View
              key={`dot-${uri}-${dotIndex}`}
              style={[
                styles.indicatorBar,
                dotIndex === selected ? styles.indicatorBarActive : styles.indicatorBarInactive,
              ]}
            />
          ))}
        </View>
      ) : null}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>{children}</View>
      {interactive && tapToChangePhotos && photos.length > 1 ? <>
        <View pointerEvents="box-none" style={[styles.photoControls, { top: topInset + 38 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="รูปก่อนหน้า" accessibilityState={{ disabled: selected === 0 }} disabled={selected === 0} onPress={event => { event?.stopPropagation?.(); moveTo(selected - 1); }} style={styles.photoTapZone} />
          <Pressable accessibilityRole="button" accessibilityLabel="รูปถัดไป" accessibilityState={{ disabled: selected === photos.length - 1 }} disabled={selected === photos.length - 1} onPress={event => { event?.stopPropagation?.(); moveTo(selected + 1); }} style={styles.photoTapZone} />
        </View>
      </> : null}
    </View>
  );
}

function Photo({ uri, identity, width, height, footerBlurHeight = 0, onPress }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showSpinner, setShowSpinner] = useState(false);

  useEffect(() => {
    if (loaded || failed || !uri) {
      setShowSpinner(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setShowSpinner(true);
    }, 180);
    return () => clearTimeout(timer);
  }, [loaded, failed, uri]);

  const sized = width > 0 && height > 0;
  // Pixel size, in normal flow. Absolute fill was leaving the Find Friends
  // card blank on Android even when the photo URL was valid.
  const sizeStyle = sized
    ? { width, height }
    : { width: '100%', height: '100%' };
  return <>
    {uri ? <CachedImage key={attempt} imageIdentity={identity} source={{ uri }} priority="high" contentFit="cover" style={sizeStyle} onLoad={() => { setLoaded(true); setFailed(false); }} onError={() => { setLoaded(false); setFailed(true); }} /> : null}
    {uri && footerBlurHeight > 0 ? (
      <MaskedView
        pointerEvents="none"
        accessible={false}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: footerBlurHeight }}
        maskElement={<LinearGradient colors={['transparent', '#000000', '#000000']} locations={[0, 0.58, 1]} style={StyleSheet.absoluteFill} />}
      >
        <CachedImage
          source={{ uri }}
          contentFit="cover"
          blurRadius={44}
          accessible={false}
          style={{ position: 'absolute', bottom: 0, width: width || '100%', height: height || '100%' }}
        />
        <LinearGradient
          pointerEvents="none"
          colors={['transparent', 'rgba(8,12,20,0.32)', 'rgba(8,12,20,0.9)']}
          locations={[0, 0.46, 1]}
          style={StyleSheet.absoluteFill}
        />
      </MaskedView>
    ) : null}
    {onPress ? <Pressable accessibilityRole="button" accessibilityLabel="ดูรายละเอียดโปรไฟล์" onPress={onPress} style={StyleSheet.absoluteFill} /> : null}
    {!uri || failed ? <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.center, styles.emptyState]}>
      <View pointerEvents="none" style={styles.center}>
        <EmptyPhotoScene size={Math.max(96, Math.min(150, (Math.min(width || 300, height || 300)) * 0.42))} />
        <Text style={styles.white}>{uri ? 'รูปนี้ยังโหลดไม่ขึ้น' : 'ยังไม่มีรูปโปรไฟล์'}</Text>
        {uri ? <Text style={styles.whiteSoft}>อาจเป็นเพราะสัญญาณอินเทอร์เน็ต ลองอีกครั้งได้เลย</Text> : null}
      </View>
      {uri ? <Pressable accessibilityRole="button" accessibilityLabel="ลองโหลดรูปอีกครั้ง" onPress={(event) => { event?.stopPropagation?.(); setLoaded(false); setFailed(false); setAttempt(value => value + 1); }} style={styles.retry}><Text style={styles.white}>ลองอีกครั้ง</Text></Pressable> : null}
    </View> : (!loaded && showSpinner) ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
      <ActivityIndicator color="#FFFFFF" />
    </View> : null}
  </>;
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  white: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  indicatorsRow: {
    position: 'absolute',
    top: 14,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  indicatorBar: {
    height: 4,
    borderRadius: 999,
    maxWidth: 42,
    flex: 1,
  },
  indicatorBarActive: {
    backgroundColor: '#FFFFFF',
  },
  indicatorBarInactive: {
    backgroundColor: 'rgba(255,255,255,0.38)',
  },
  retry: { paddingVertical: 12, paddingHorizontal: 22, minHeight: 48, borderRadius: 24, borderCurve: 'continuous', backgroundColor: '#2259A6', justifyContent: 'center' },
  emptyState: { backgroundColor: '#1F2A3A', paddingHorizontal: 24 },
  whiteSoft: { color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 260 },
  photoControls: { position: 'absolute', top: 38, bottom: '36%', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between' },
  photoTapZone: { width: '28%', minHeight: 48 },
  disabled: { opacity: 0.35 },
});

