import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, FlatList, Keyboard, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FeatureIcon from './FeatureIcon';
import {
  fetchTrendingGifs,
  fetchTrendingStickers,
  searchGifs,
  searchStickers,
} from '../services/giphyService';
import { EMOJI_CATEGORIES } from '../data/iosEmojiCategories';
import { project, rubberband } from '../utils/motion';

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = 12;
const GAP = 8;
const COLUMN_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GAP) / 2;
const STICKER_COLUMN_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GAP * 2) / 3;

const GIF_CATEGORIES = [
  { id: 'trending', label: 'ยอดนิยม', icon: 'flame.fill', query: '' },
  { id: 'happy', label: 'ขำขัน', icon: 'face.smiling', query: 'lol funny' },
  { id: 'love', label: 'ความรัก', icon: 'heart.fill', query: 'love heart' },
  { id: 'clap', label: 'ปรบมือ', icon: 'hand.wave.fill', query: 'applause' },
  { id: 'sad', label: 'เศร้า', icon: 'exclamationmark.triangle.fill', query: 'sad cry' },
  { id: 'pets', label: 'สัตว์เลี้ยง', icon: 'sparkles', query: 'cute cat dog' },
  { id: 'celebrate', label: 'ฉลอง', icon: 'star.fill', query: 'party celebration' },
  { id: 'yes', label: 'ได้เลย', icon: 'checkmark.circle.fill', query: 'thumbs up yes' },
];

const STICKER_CATEGORIES = [
  { id: 'trending', label: 'ยอดนิยม', icon: 'flame.fill', query: '' },
  { id: 'cute', label: 'น่ารัก', icon: 'sparkles', query: 'cute sticker' },
  { id: 'love', label: 'ความรัก', icon: 'heart.fill', query: 'love sticker' },
  { id: 'funny', label: 'ขำขัน', icon: 'face.smiling', query: 'funny sticker' },
  { id: 'reaction', label: 'รีแอคชั่น', icon: 'hand.wave.fill', query: 'reaction sticker' },
  { id: 'cat', label: 'น้องแมว', icon: 'sparkles', query: 'cute cat sticker' },
  { id: 'hello', label: 'ทักทาย', icon: 'hand.wave.fill', query: 'hello sticker' },
  { id: 'yes', label: 'โอเค', icon: 'checkmark.circle.fill', query: 'yes sticker' },
];

export default function ChatGiphyPickerSheet({
  isOpen,
  onClose,
  onSelectGif,
  onSelectEmoji,
  colors = {},
  isDark = false,
}) {
  const [activeTab, setActiveTab] = useState('gif'); // 'sticker' | 'emoji' | 'gif'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('trending');
  const [mediaItems, setMediaItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const searchDebounceRef = useRef(null);
  const inputRef = useRef(null);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const expandedHeight = Math.max(280, windowHeight - insets.top - 16);
  const collapsedHeight = Math.min(380, expandedHeight);
  const visibleH = useSharedValue(collapsedHeight);
  const dragStartH = useSharedValue(collapsedHeight);
  const closingSv = useSharedValue(0);
  const expandedHSv = useSharedValue(expandedHeight);
  const collapsedHSv = useSharedValue(collapsedHeight);
  const closing = useRef(false);

  useEffect(() => {
    expandedHSv.set(expandedHeight);
    collapsedHSv.set(collapsedHeight);
  }, [collapsedHSv, collapsedHeight, expandedHSv, expandedHeight]);

  useEffect(() => {
    if (isOpen) {
      closing.current = false;
      closingSv.set(0);
      visibleH.set(collapsedHeight);
    }
  }, [isOpen, collapsedHeight, closingSv, visibleH]);

  const handleClosed = useCallback(() => {
    closing.current = false;
    closingSv.set(0);
    onClose?.();
  }, [closingSv, onClose]);

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const closeSheet = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    closingSv.set(1);
    Keyboard.dismiss();
    visibleH.set(withTiming(0, { duration: 200, easing: EASE_OUT }, (finished) => {
      if (finished) scheduleOnRN(handleClosed);
    }));
  }, [closingSv, handleClosed, visibleH]);

  const panGesture = useMemo(() => Gesture.Pan()
    .activeOffsetY([-6, 6])
    .failOffsetX([-24, 24])
    .onStart(() => {
      if (closingSv.get()) return;
      dragStartH.set(visibleH.get());
      scheduleOnRN(dismissKeyboard);
    })
    .onUpdate((event) => {
      if (closingSv.get()) return;
      const maxH = expandedHSv.get();
      const next = dragStartH.get() - event.translationY;
      if (next > maxH) {
        visibleH.set(maxH + rubberband(next - maxH, maxH));
      } else if (next < 0) {
        visibleH.set(-rubberband(-next, collapsedHSv.get() || 1));
      } else {
        visibleH.set(next);
      }
    })
    .onEnd((event) => {
      if (closingSv.get()) return;
      const maxH = expandedHSv.get();
      const collapsedH = collapsedHSv.get();
      const height = Math.max(0, Math.min(maxH, visibleH.get()));
      const projected = height + project(-event.velocityY);
      if (projected < collapsedH - 40) {
        scheduleOnRN(closeSheet);
      } else if (event.translationY > 10 && event.velocityY > 650) {
        if (height > collapsedH + 80) {
          visibleH.set(withSpring(collapsedH, { duration: 300, dampingRatio: 0.8, velocity: -event.velocityY }));
        } else {
          scheduleOnRN(closeSheet);
        }
      } else if (event.velocityY < -450 || projected >= maxH - 40) {
        visibleH.set(withSpring(maxH, { duration: 300, dampingRatio: 0.8, velocity: -event.velocityY }));
      } else if (projected <= collapsedH + 35) {
        visibleH.set(withSpring(collapsedH, { duration: 300, dampingRatio: 0.8, velocity: -event.velocityY }));
      } else {
        visibleH.set(withSpring(height, { duration: 300, dampingRatio: 1, velocity: -event.velocityY, overshootClamping: true }));
      }
    }), [closeSheet, collapsedHSv, closingSv, dismissKeyboard, dragStartH, expandedHSv, visibleH]);

  const spacerStyle = useAnimatedStyle(() => ({
    height: interpolate(visibleH.get(), [0, collapsedHSv.get()], [0, collapsedHSv.get()], Extrapolation.CLAMP),
  }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: expandedHSv.get() - visibleH.get() }],
  }));

  // Palette tokens
  const bg = isDark ? '#121620' : '#FFFFFF';
  const cardBg = isDark ? '#1E2433' : '#F1F5F9';
  const textPrimary = isDark ? '#F8FAFC' : '#0F172A';
  const textSecondary = isDark ? '#94A3B8' : '#64748B';
  const searchInputBg = isDark ? '#1A202C' : '#F1F5F9';
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const activePillBg = '#3B5AFE';
  const activePillText = '#FFFFFF';

  // Fetch GIFs or Stickers based on current tab and query
  const loadMedia = useCallback(
    async (tabToUse, queryToUse, pageOffset = 0, isInitial = false) => {
      if (tabToUse === 'emoji') return;

      if (isInitial) {
        setLoading(true);
        if (pageOffset === 0) {
          setMediaItems([]);
        }
      } else {
        setLoadingMore(true);
      }

      try {
        let result;
        const trimmed = (queryToUse || '').trim();

        if (tabToUse === 'sticker') {
          if (trimmed) {
            result = await searchStickers(trimmed, 24, pageOffset);
          } else {
            result = await fetchTrendingStickers(24, pageOffset);
          }
        } else {
          if (trimmed) {
            result = await searchGifs(trimmed, 24, pageOffset);
          } else {
            result = await fetchTrendingGifs(24, pageOffset);
          }
        }

        const newItems = result.data || [];
        if (isInitial || pageOffset === 0) {
          setMediaItems(newItems);
        } else {
          setMediaItems((prev) => {
            const existingIds = new Set(prev.map((g) => g.id));
            const filtered = newItems.filter((g) => !existingIds.has(g.id));
            return [...prev, ...filtered];
          });
        }

        setOffset(pageOffset + newItems.length);
        setHasMore(newItems.length >= 20);
      } catch (err) {
        console.warn(`[ChatGiphyPickerSheet] Error loading ${tabToUse}:`, err);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  // Initialize and load when sheet opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      if (activeTab === 'emoji') {
        setSelectedCategory(EMOJI_CATEGORIES[0]?.id || 'smileys_people');
      } else {
        setSelectedCategory('trending');
        loadMedia(activeTab, '', 0, true);
      }
    }
  }, [isOpen]);

  // Handle Tab Switch
  const handleTabChange = useCallback(
    (newTab) => {
      if (newTab === activeTab) return;
      setActiveTab(newTab);
      setSearchQuery('');
      if (newTab === 'emoji') {
        setSelectedCategory(EMOJI_CATEGORIES[0]?.id || 'smileys_people');
      } else {
        setSelectedCategory('trending');
        loadMedia(newTab, '', 0, true);
      }
    },
    [activeTab, loadMedia]
  );

  // Handle Search Input Change with Debounce
  const handleQueryChange = useCallback(
    (text) => {
      setSearchQuery(text);
      if (activeTab === 'emoji') return;

      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }

      searchDebounceRef.current = setTimeout(() => {
        if (text.trim()) {
          setSelectedCategory('');
          loadMedia(activeTab, text, 0, true);
        } else {
          setSelectedCategory('trending');
          loadMedia(activeTab, '', 0, true);
        }
      }, 350);
    },
    [activeTab, loadMedia]
  );

  // Clear search query
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    if (activeTab === 'emoji') {
      setSelectedCategory(EMOJI_CATEGORIES[0]?.id || 'smileys_people');
    } else {
      setSelectedCategory('trending');
      loadMedia(activeTab, '', 0, true);
    }
    inputRef.current?.focus();
  }, [activeTab, loadMedia]);

  // Handle Category Pill Tap
  const handleCategorySelect = useCallback(
    (cat) => {
      setSelectedCategory(cat.id);
      setSearchQuery('');
      Keyboard.dismiss();
      if (activeTab !== 'emoji') {
        loadMedia(activeTab, cat.query, 0, true);
      }
    },
    [activeTab, loadMedia]
  );

  // Infinite Scroll: Load More
  const handleEndReached = useCallback(() => {
    if (activeTab === 'emoji') return;
    if (!loading && !loadingMore && hasMore && mediaItems.length > 0) {
      const activeCats = activeTab === 'sticker' ? STICKER_CATEGORIES : GIF_CATEGORIES;
      const activeCat = activeCats.find((c) => c.id === selectedCategory);
      const query = searchQuery || activeCat?.query || '';
      loadMedia(activeTab, query, offset, false);
    }
  }, [activeTab, hasMore, loading, loadingMore, loadMedia, mediaItems.length, offset, searchQuery, selectedCategory]);

  // Split gifs into 2-up rows so the grid stays virtualized while keeping the
  // clean Pinterest/Instagram-style two column layout.
  const gifRows = useMemo(() => {
    if (activeTab !== 'gif') return [];
    const rows = [];
    for (let index = 0; index < mediaItems.length; index += 2) {
      rows.push(mediaItems.slice(index, index + 2));
    }
    return rows;
  }, [activeTab, mediaItems]);

  // Filter Emojis
  const displayEmojis = useMemo(() => {
    if (activeTab !== 'emoji') return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      const cat = EMOJI_CATEGORIES.find((c) => c.id === selectedCategory) || EMOJI_CATEGORIES[0];
      return cat?.emojis || [];
    }
    const matched = [];
    EMOJI_CATEGORIES.forEach((cat) => {
      if (cat.label.toLowerCase().includes(q)) {
        matched.push(...cat.emojis);
      }
    });
    return matched.length > 0 ? matched : EMOJI_CATEGORIES[0]?.emojis || [];
  }, [activeTab, searchQuery, selectedCategory]);

  // Active Categories list depending on activeTab
  const currentCategories = useMemo(() => {
    if (activeTab === 'sticker') return STICKER_CATEGORIES;
    if (activeTab === 'emoji') {
      return EMOJI_CATEGORIES.map((c) => ({
        id: c.id,
        label: c.label,
        emojiIcon: c.icon,
      }));
    }
    return GIF_CATEGORIES;
  }, [activeTab]);

  if (!isOpen) return null;

  const searchPlaceholder =
    activeTab === 'sticker'
      ? 'ค้นหาสติกเกอร์ GIPHY...'
      : activeTab === 'emoji'
      ? 'ค้นหาอิโมจิ...'
      : 'ค้นหา GIPHY...';

  return (
    <View style={styles.sheetWrapper}>
      <Animated.View pointerEvents="none" style={spacerStyle} />
      <Animated.View
        style={[
          styles.sheetContainer,
          {
            height: expandedHeight,
            paddingBottom: insets.bottom,
            backgroundColor: bg,
            borderTopColor: borderColor,
          },
          sheetStyle,
        ]}
      >
        {/* Drag handle / Header */}
        <GestureDetector gesture={panGesture}>
          <View style={styles.header}>
            <View style={[styles.dragHandle, { backgroundColor: isDark ? '#334155' : '#CBD5E1' }]} />
          </View>
        </GestureDetector>

        {/* Search Bar */}
        <View style={styles.searchRow}>
          <View style={[styles.searchPill, { backgroundColor: searchInputBg }]}>
            <FeatureIcon color={textSecondary} name="magnifyingglass" size={16} style={styles.searchIcon} />
            <TextInput
              ref={inputRef}
              placeholder={searchPlaceholder}
              placeholderTextColor={textSecondary}
              value={searchQuery}
              onChangeText={handleQueryChange}
              style={[styles.searchInput, { color: textPrimary }]}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery ? (
              <Pressable
                accessibilityLabel="ล้างคำค้นหา"
                hitSlop={6}
                onPress={handleClearSearch}
                style={styles.clearSearchBtn}
              >
                <FeatureIcon color={textSecondary} name="xmark.circle.fill" size={16} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Category Pills Bar */}
        <View style={styles.categoryContainer}>
          <FlatList
            key={`categories-${activeTab}`}
            data={currentCategories}
            horizontal
            keyExtractor={(item) => item.id}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryContent}
            keyboardShouldPersistTaps="always"
            renderItem={({ item }) => {
              const isSelected = selectedCategory === item.id && !searchQuery;
              return (
                <Pressable
                  accessibilityLabel={`หมวดหมู่ ${item.label}`}
                  onPress={() => handleCategorySelect(item)}
                  style={({ pressed }) => [
                    styles.categoryPill,
                    {
                      backgroundColor: isSelected ? activePillBg : cardBg,
                      borderColor: isSelected ? activePillBg : borderColor,
                    },
                    pressed && styles.pressed,
                  ]}
                >
                  {item.emojiIcon ? (
                    <Text style={styles.categoryEmojiIcon}>{item.emojiIcon}</Text>
                  ) : (
                    <FeatureIcon
                      color={isSelected ? activePillText : textSecondary}
                      name={item.icon}
                      size={13}
                      style={styles.pillIcon}
                    />
                  )}
                  <Text
                    style={[
                      styles.categoryLabel,
                      { color: isSelected ? activePillText : textPrimary },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            }}
          />
        </View>

        {/* Content Area according to activeTab */}
        {activeTab === 'emoji' ? (
          /* EMOJI GRID */
          <FlatList
            key="emoji-flatlist-grid"
            data={displayEmojis}
            numColumns={7}
            keyExtractor={(item, idx) => `${item}-${idx}`}
            contentContainerStyle={styles.emojiGridContent}
            keyboardShouldPersistTaps="always"
            renderItem={({ item }) => (
              <Pressable
                accessibilityLabel={`อิโมจิ ${item}`}
                onPress={() => onSelectEmoji?.(item)}
                style={({ pressed }) => [styles.emojiCell, pressed && styles.emojiCellPressed]}
              >
                <Text style={styles.emojiGlyph}>{item}</Text>
              </Pressable>
            )}
          />
        ) : loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={activePillBg} size="large" />
            <Text style={[styles.loadingText, { color: textSecondary }]}>
              {activeTab === 'sticker' ? 'กำลังโหลดสติกเกอร์...' : 'กำลังโหลด GIF จาก GIPHY...'}
            </Text>
          </View>
        ) : mediaItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <FeatureIcon color={textSecondary} name={activeTab === 'sticker' ? 'sparkles' : 'photo'} size={36} />
            <Text style={[styles.emptyTitle, { color: textPrimary }]}>
              {activeTab === 'sticker' ? 'ไม่พบสติกเกอร์' : 'ไม่พบภาพ GIF'}
            </Text>
            <Text style={[styles.emptySub, { color: textSecondary }]}>ลองค้นหาด้วยคำอื่น เช่น cat, happy, love</Text>
          </View>
        ) : activeTab === 'sticker' ? (
          /* STICKER GRID (3 columns, transparent items) */
          <FlatList
            key="sticker-flatlist-grid"
            data={mediaItems}
            numColumns={3}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.stickerGridContent}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            keyboardShouldPersistTaps="always"
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={activePillBg} size="small" />
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityLabel={`ส่งสติกเกอร์ ${item.title}`}
                onPress={() => onSelectGif?.(item)}
                style={({ pressed }) => [styles.stickerCard, pressed && styles.pressedCard]}
              >
                <Image
                  source={{ uri: item.previewUrl || item.url }}
                  style={styles.stickerImage}
                  contentFit="contain"
                  transition={120}
                  cachePolicy="memory-disk"
                />
              </Pressable>
            )}
          />
        ) : (
          /* GIF GRID (2 columns masonry) */
          <FlatList
            key="gif-flatlist-grid"
            data={gifRows}
            keyExtractor={(row) => row[0].id}
            contentContainerStyle={styles.gridContent}
            initialNumToRender={6}
            onEndReached={handleEndReached}
            onEndReachedThreshold={0.4}
            keyboardShouldPersistTaps="always"
            removeClippedSubviews={Platform.OS === 'android'}
            windowSize={5}
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footerLoader}>
                  <ActivityIndicator color={activePillBg} size="small" />
                </View>
              ) : null
            }
            renderItem={({ item: row }) => (
              <View style={styles.columnsContainer}>
                {row.map((gif) => {
                  const cardHeight = Math.min(
                    Math.max(Math.round(COLUMN_WIDTH / (gif.aspectRatio || 1.33)), 90),
                    180
                  );
                  return (
                    <View key={gif.id} style={styles.column}>
                      <Pressable
                        accessibilityLabel={`ส่งภาพ ${gif.title}`}
                        onPress={() => onSelectGif?.(gif)}
                        style={({ pressed }) => [
                          styles.gifCard,
                          {
                            height: cardHeight,
                            backgroundColor: cardBg,
                            borderColor,
                          },
                          pressed && styles.pressedCard,
                        ]}
                      >
                        <Image
                          source={{ uri: gif.previewUrl || gif.url }}
                          style={StyleSheet.absoluteFill}
                          contentFit="cover"
                          transition={150}
                          cachePolicy="memory-disk"
                        />
                      </Pressable>
                    </View>
                  );
                })}
                {row.length < 2 ? <View style={styles.column} /> : null}
              </View>
            )}
          />
        )}

        {/* GIPHY Attribution (shown on sticker & gif tabs) */}
        {activeTab !== 'emoji' && (
          <View style={styles.attributionRow}>
            <Image
              accessibilityLabel="Powered by GIPHY"
              accessible
              source={require('../../assets/giphy/powered-by-giphy-dark.png')}
              tintColor={isDark ? undefined : '#0F172A'}
              style={styles.attributionMark}
              contentFit="contain"
            />
          </View>
        )}

        {/* Bottom Mode Tabs (Sticker, Emoji, GIF) */}
        <View style={[styles.bottomTabBar, { borderTopColor: borderColor, backgroundColor: bg }]}>
          {/* Tab 1: Sticker */}
          <Pressable
            accessibilityLabel="โหมดสติกเกอร์"
            hitSlop={10}
            onPress={() => handleTabChange('sticker')}
            style={styles.bottomTabBtn}
          >
            <View
              style={[
                styles.tabIconPill,
                activeTab === 'sticker' && {
                  backgroundColor: isDark ? 'rgba(59,90,254,0.25)' : 'rgba(59,90,254,0.12)',
                },
              ]}
            >
              <FeatureIcon
                color={activeTab === 'sticker' ? '#3B5AFE' : textSecondary}
                name="sparkles"
                size={20}
              />
            </View>
          </Pressable>

          {/* Tab 2: Emoji */}
          <Pressable
            accessibilityLabel="โหมดอิโมจิ"
            hitSlop={10}
            onPress={() => handleTabChange('emoji')}
            style={styles.bottomTabBtn}
          >
            <View
              style={[
                styles.tabIconPill,
                activeTab === 'emoji' && {
                  backgroundColor: isDark ? 'rgba(59,90,254,0.25)' : 'rgba(59,90,254,0.12)',
                },
              ]}
            >
              <FeatureIcon
                color={activeTab === 'emoji' ? '#3B5AFE' : textSecondary}
                name="face.smiling"
                size={22}
              />
            </View>
          </Pressable>

          {/* Tab 3: GIF */}
          <Pressable
            accessibilityLabel="โหมด GIF"
            hitSlop={10}
            onPress={() => handleTabChange('gif')}
            style={styles.bottomTabBtn}
          >
            <View
              style={[
                styles.gifBadge,
                {
                  backgroundColor: activeTab === 'gif' ? (isDark ? '#F8FAFC' : '#0F172A') : 'transparent',
                  borderColor: activeTab === 'gif' ? (isDark ? '#F8FAFC' : '#0F172A') : textSecondary,
                },
              ]}
            >
              <Text
                style={[
                  styles.gifBadgeText,
                  { color: activeTab === 'gif' ? (isDark ? '#0F172A' : '#FFFFFF') : textSecondary },
                ]}
              >
                GIF
              </Text>
            </View>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetWrapper: {
    position: 'relative',
    width: '100%',
    flexShrink: 0,
    zIndex: 9999,
  },
  sheetContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 16,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    flexShrink: 0,
    overflow: 'hidden',
    width: '100%',
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 16,
    position: 'relative',
    width: '100%',
  },
  dragHandle: {
    borderRadius: 2.5,
    height: 4,
    width: 36,
  },
  searchRow: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  searchPill: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    height: 40,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    height: '100%',
    padding: 0,
  },
  clearSearchBtn: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  categoryContainer: {
    height: 36,
    marginBottom: 6,
  },
  categoryContent: {
    gap: 6,
    paddingHorizontal: 12,
  },
  categoryPill: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    height: 32,
    paddingHorizontal: 10,
  },
  pillIcon: {
    marginRight: 4,
  },
  categoryEmojiIcon: {
    fontSize: 14,
    marginRight: 4,
  },
  categoryLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  loadingText: {
    fontSize: 13,
    marginTop: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 8,
  },
  emptySub: {
    fontSize: 12,
    marginTop: 4,
  },
  gridContent: {
    paddingBottom: 8,
    paddingHorizontal: GRID_PADDING,
    gap: GAP,
  },
  columnsContainer: {
    flexDirection: 'row',
    gap: GAP,
  },
  column: {
    flex: 1,
    gap: GAP,
  },
  gifCard: {
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
  },
  stickerGridContent: {
    paddingBottom: 8,
    paddingHorizontal: GRID_PADDING,
    gap: GAP,
  },
  stickerCard: {
    width: STICKER_COLUMN_WIDTH,
    height: STICKER_COLUMN_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
  },
  stickerImage: {
    width: '100%',
    height: '100%',
  },
  emojiGridContent: {
    paddingBottom: 16,
    paddingHorizontal: 8,
  },
  emojiCell: {
    flex: 1 / 7,
    alignItems: 'center',
    justifyContent: 'center',
    aspectRatio: 1,
    borderRadius: 8,
  },
  emojiCellPressed: {
    backgroundColor: 'rgba(59, 90, 254, 0.15)',
    transform: [{ scale: 1.18 }],
  },
  emojiGlyph: {
    fontSize: 27,
    textAlign: 'center',
  },
  footerLoader: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  attributionRow: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 30,
    flexShrink: 0,
  },
  attributionMark: {
    width: 120,
    height: 15.6,
  },
  bottomTabBar: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'space-around',
    paddingBottom: Platform.OS === 'ios' ? 8 : 4,
  },
  bottomTabBtn: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 58,
  },
  tabIconPill: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 38,
    height: 30,
    borderRadius: 15,
  },
  gifBadge: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1.5,
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  gifBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  pressed: {
    opacity: 0.7,
  },
  pressedCard: {
    opacity: 0.85,
    transform: [{ scale: 0.95 }],
  },
});
