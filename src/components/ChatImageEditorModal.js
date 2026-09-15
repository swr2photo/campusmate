import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image as RNImage,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import FeatureIcon from './FeatureIcon';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const FILTER_PRESETS = [
  { id: 'normal', name: 'ปกติ', icon: 'sparkles' },
  { id: 'vivid', name: 'สดใส', icon: 'sun.max.fill' },
  { id: 'warm', name: 'โทนอุ่น', icon: 'flame.fill' },
  { id: 'cool', name: 'โทนเย็น', icon: 'snowflake' },
  { id: 'bw', name: 'ขาวดำ', icon: 'circle.lefthalf.filled' },
  { id: 'vintage', name: 'วินเทจ', icon: 'camera.filters' },
];

const CROP_RATIOS = [
  { id: '1:1', name: '1:1', ratio: 1, label: 'จัตุรัส' },
  { id: '4:3', name: '4:3', ratio: 4 / 3, label: 'แนวนอน' },
  { id: '16:9', name: '16:9', ratio: 16 / 9, label: 'ไวด์' },
  { id: '3:4', name: '3:4', ratio: 3 / 4, label: 'แนวตั้ง' },
];

// Headless HTML for fast canvas-based photo filter processing
const FILTER_PROCESSOR_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
  <style>
    html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
    canvas { display: none; }
  </style>
</head>
<body>
  <canvas id="c"></canvas>
  <script>
    function send(obj) {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(obj));
        }
      } catch(e) {}
    }

    function applyFilter(base64Src, filterType, requestId) {
      var img = new Image();
      img.onload = function() {
        try {
          var canvas = document.getElementById('c');
          var maxDim = 1800;
          var w = img.width;
          var h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');

          if (filterType === 'bw') {
            ctx.filter = 'grayscale(100%) contrast(115%) brightness(102%)';
          } else if (filterType === 'vivid') {
            ctx.filter = 'saturate(165%) contrast(115%) brightness(103%)';
          } else if (filterType === 'warm') {
            ctx.filter = 'sepia(35%) saturate(135%) brightness(104%)';
          } else if (filterType === 'cool') {
            ctx.filter = 'hue-rotate(185deg) sepia(18%) hue-rotate(-185deg) saturate(120%) brightness(103%)';
          } else if (filterType === 'vintage') {
            ctx.filter = 'sepia(55%) contrast(92%) brightness(96%) saturate(110%)';
          } else {
            ctx.filter = 'none';
          }

          ctx.drawImage(img, 0, 0, w, h);

          if (filterType === 'cool') {
            ctx.fillStyle = 'rgba(0, 110, 255, 0.07)';
            ctx.fillRect(0, 0, w, h);
          } else if (filterType === 'vintage') {
            ctx.fillStyle = 'rgba(255, 220, 150, 0.05)';
            ctx.fillRect(0, 0, w, h);
          }

          var resultBase64 = canvas.toDataURL('image/jpeg', 0.90);
          send({
            requestId: requestId,
            success: true,
            base64: resultBase64
          });
        } catch(err) {
          send({ requestId: requestId, success: false, error: String(err) });
        }
      };
      img.onerror = function(err) {
        send({ requestId: requestId, success: false, error: 'Image failed to load' });
      };
      img.src = base64Src;
    }

    function onMsg(data) {
      try {
        var payload = typeof data === 'string' ? JSON.parse(data) : data;
        if (payload && payload.action === 'applyFilter') {
          applyFilter(payload.base64, payload.filterType, payload.requestId);
        }
      } catch(e) {}
    }

    window.addEventListener('message', function(e) { onMsg(e.data); });
    document.addEventListener('message', function(e) { onMsg(e.data); });
    send({ type: 'ready' });
  </script>
</body>
</html>`;

export default function ChatImageEditorModal({
  visible,
  imageUri,
  imageUris = [],
  onClose,
  onSend,
  colors,
  initialCaption = '',
  confirmLabel = 'ส่ง',
}) {
  const insets = useSafeAreaInsets();
  const [activeUri, setActiveUri] = useState(null);
  const [originalUri, setOriginalUri] = useState(null);
  const [urisList, setUrisList] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [caption, setCaption] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('กำลังประมวลผลรูปภาพ...');
  const [selectedFilter, setSelectedFilter] = useState('normal');
  const [activeTab, setActiveTab] = useState('tools'); // 'tools' | 'crop' | 'filters'
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [hasEdits, setHasEdits] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  const webViewRef = useRef(null);
  const isWebViewReadyRef = useRef(false);
  const pendingResolvers = useRef({});
  const baseBeforeFilterUri = useRef(null);
  const cachedFilterUris = useRef({});
  const editedUrisMap = useRef({});

  // Track keyboard state for clean non-floating layout
  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setIsKeyboardOpen(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setIsKeyboardOpen(false)
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Initialize or reset image when opened
  useEffect(() => {
    if (visible) {
      const list = imageUris && imageUris.length > 0 ? imageUris : (imageUri ? [imageUri] : []);
      const startIndex = Math.max(0, list.indexOf(imageUri));
      const first = list[startIndex] || imageUri || null;
      setUrisList(list);
      setSelectedIdx(startIndex);
      setActiveUri(first);
      setOriginalUri(first);
      baseBeforeFilterUri.current = first;
      cachedFilterUris.current = {};
      editedUrisMap.current = {};
      setCaption(initialCaption);
      setSelectedFilter('normal');
      setActiveTab('tools');
      setHasEdits(false);

      if (first) {
        RNImage.getSize(
          first,
          (w, h) => setDimensions({ width: w, height: h }),
          () => setDimensions({ width: 1000, height: 1000 })
        );
      }
    }
  }, [visible, imageUri, imageUris, initialCaption]);

  // Handle messages from headless WebView
  const handleWebViewMessage = useCallback(async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'ready') {
        isWebViewReadyRef.current = true;
        return;
      }

      if (data.requestId && pendingResolvers.current[data.requestId]) {
        const { resolve, reject } = pendingResolvers.current[data.requestId];
        delete pendingResolvers.current[data.requestId];

        if (data.success && data.base64) {
          try {
            const fileUri = `${FileSystem.cacheDirectory}chat_filter_${data.requestId}.jpg`;
            const cleanBase64 = data.base64.replace(/^data:image\/jpeg;base64,/, '');
            await FileSystem.writeAsStringAsync(fileUri, cleanBase64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            resolve(fileUri);
          } catch (writeErr) {
            reject(writeErr);
          }
        } else {
          reject(new Error(data.error || 'Filter processing failed'));
        }
      }
    } catch (e) {
      console.warn('[ChatImageEditor] Message parse error:', e);
    }
  }, []);

  // Switch image when tapping thumbnail in multi-photo mode
  const handleSelectImageIndex = (idx) => {
    if (idx === selectedIdx) return;
    // Save current active URI for the currently selected photo
    if (activeUri) {
      editedUrisMap.current[selectedIdx] = activeUri;
    }

    const nextUri = editedUrisMap.current[idx] || urisList[idx];
    if (nextUri) {
      setSelectedIdx(idx);
      setActiveUri(nextUri);
      setOriginalUri(urisList[idx]);
      baseBeforeFilterUri.current = nextUri;
      cachedFilterUris.current = {};
      setSelectedFilter('normal');
      RNImage.getSize(
        nextUri,
        (w, h) => setDimensions({ width: w, height: h }),
        () => setDimensions({ width: 1000, height: 1000 })
      );
    }
  };

  // 1. Rotate 90 degrees clockwise
  const handleRotate90 = async () => {
    if (!activeUri || isProcessing) return;
    setIsProcessing(true);
    setProcessingLabel('กำลังหมุนรูปภาพ...');
    try {
      const result = await ImageManipulator.manipulateAsync(
        activeUri,
        [{ rotate: 90 }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      setActiveUri(result.uri);
      baseBeforeFilterUri.current = result.uri;
      cachedFilterUris.current = {};
      setSelectedFilter('normal');
      setDimensions({ width: result.width, height: result.height });
      setHasEdits(true);
    } catch (err) {
      console.warn('[ChatImageEditor] Rotate error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Flip Horizontally (Mirror effect)
  const handleFlipHorizontal = async () => {
    if (!activeUri || isProcessing) return;
    setIsProcessing(true);
    setProcessingLabel('กำลังกลับด้านรูปภาพ...');
    try {
      const result = await ImageManipulator.manipulateAsync(
        activeUri,
        [{ flip: ImageManipulator.FlipType.Horizontal }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      setActiveUri(result.uri);
      baseBeforeFilterUri.current = result.uri;
      cachedFilterUris.current = {};
      setSelectedFilter('normal');
      setHasEdits(true);
    } catch (err) {
      console.warn('[ChatImageEditor] Flip error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Crop Preset (Center crop to ratio)
  const handleCropPreset = async (targetRatio) => {
    if (!activeUri || isProcessing || !dimensions.width) return;
    setIsProcessing(true);
    setProcessingLabel('กำลังครอบตัดรูปภาพ...');
    try {
      const { width: origW, height: origH } = dimensions;
      let cropW = origW;
      let cropH = origH;

      if (targetRatio === 1) {
        const minSide = Math.min(origW, origH);
        cropW = minSide;
        cropH = minSide;
      } else if (origW / origH > targetRatio) {
        cropW = Math.floor(origH * targetRatio);
        cropH = origH;
      } else {
        cropW = origW;
        cropH = Math.floor(origW / targetRatio);
      }

      const originX = Math.max(0, Math.floor((origW - cropW) / 2));
      const originY = Math.max(0, Math.floor((origH - cropH) / 2));

      const result = await ImageManipulator.manipulateAsync(
        activeUri,
        [{ crop: { originX, originY, width: cropW, height: cropH } }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      setActiveUri(result.uri);
      baseBeforeFilterUri.current = result.uri;
      cachedFilterUris.current = {};
      setSelectedFilter('normal');
      setDimensions({ width: result.width, height: result.height });
      setHasEdits(true);
    } catch (err) {
      console.warn('[ChatImageEditor] Crop error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. Apply Real Photo Filter via Canvas Processor
  const handleApplyFilter = async (filterId) => {
    if (filterId === selectedFilter || isProcessing) return;

    if (filterId === 'normal') {
      setSelectedFilter('normal');
      const base = baseBeforeFilterUri.current || originalUri;
      if (base) {
        setActiveUri(base);
        RNImage.getSize(
          base,
          (w, h) => setDimensions({ width: w, height: h }),
          () => {}
        );
      }
      return;
    }

    // If already generated and cached for this current image
    if (cachedFilterUris.current[filterId]) {
      const cached = cachedFilterUris.current[filterId];
      setSelectedFilter(filterId);
      setActiveUri(cached);
      setHasEdits(true);
      RNImage.getSize(
        cached,
        (w, h) => setDimensions({ width: w, height: h }),
        () => {}
      );
      return;
    }

    setIsProcessing(true);
    setProcessingLabel('กำลังใส่ฟิลเตอร์...');
    setSelectedFilter(filterId);

    try {
      const baseUri = baseBeforeFilterUri.current || activeUri || originalUri;
      // Get a resized base64 representation using ImageManipulator (super fast ~25ms)
      const manipRes = await ImageManipulator.manipulateAsync(
        baseUri,
        [{ resize: { width: 1400 } }],
        { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      const requestId = `${filterId}_${Date.now()}`;
      const filterPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          delete pendingResolvers.current[requestId];
          reject(new Error('Filter timeout'));
        }, 4000);

        pendingResolvers.current[requestId] = {
          resolve: (uri) => {
            clearTimeout(timeout);
            resolve(uri);
          },
          reject: (err) => {
            clearTimeout(timeout);
            reject(err);
          },
        };
      });

      const payload = JSON.stringify({
        action: 'applyFilter',
        base64: `data:image/jpeg;base64,${manipRes.base64}`,
        filterType: filterId,
        requestId,
      });

      webViewRef.current?.postMessage(payload);
      const filteredUri = await filterPromise;

      cachedFilterUris.current[filterId] = filteredUri;
      setActiveUri(filteredUri);
      setHasEdits(true);
      RNImage.getSize(
        filteredUri,
        (w, h) => setDimensions({ width: w, height: h }),
        () => {}
      );
    } catch (err) {
      console.warn('[ChatImageEditor] Apply filter error:', err);
      setSelectedFilter('normal');
    } finally {
      setIsProcessing(false);
    }
  };

  // 5. Reset to Original
  const handleReset = () => {
    if (originalUri && hasEdits) {
      setActiveUri(originalUri);
      baseBeforeFilterUri.current = originalUri;
      cachedFilterUris.current = {};
      setSelectedFilter('normal');
      setHasEdits(false);
      RNImage.getSize(
        originalUri,
        (w, h) => setDimensions({ width: w, height: h }),
        () => {}
      );
    }
  };

  // 6. Final Send
  const handleConfirmSend = async () => {
    if (!activeUri || isProcessing) return;
    setIsProcessing(true);
    setProcessingLabel('กำลังเตรียมรูปภาพ...');
    try {
      let finalUri = activeUri;

      let finalUris = urisList.length > 0 ? [...urisList] : [finalUri];
      if (urisList.length > 0 && selectedIdx >= 0) {
        finalUris[selectedIdx] = finalUri;
      }
      Object.keys(editedUrisMap.current).forEach((idx) => {
        if (editedUrisMap.current[idx]) {
          finalUris[Number(idx)] = editedUrisMap.current[idx];
        }
      });

      onSend?.(finalUris.length > 1 ? finalUris : finalUri, caption.trim());
      onClose?.();
    } catch (err) {
      console.warn('[ChatImageEditor] Confirm send error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      animationType="fade"
      hardwareAccelerated
      onRequestClose={onClose}
      statusBarTranslucent
      transparent={false}
      visible={visible}
    >
      <View style={styles.root}>
        {/* Top Header Bar */}
        <View style={[styles.headerBar, { paddingTop: Math.max(insets.top, 20) + 6 }]}>
          <Pressable
            accessibilityLabel="ยกเลิกการแก้ไข"
            hitSlop={10}
            onPress={onClose}
            style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
          >
            <FeatureIcon color="#FFFFFF" name="xmark" size={18} />
          </Pressable>

          <Text style={styles.headerTitle}>ปรับแต่งรูปภาพ</Text>

          {hasEdits ? (
            <Pressable
              accessibilityLabel="รีเซ็ตรูปภาพเดิม"
              hitSlop={10}
              onPress={handleReset}
              style={({ pressed }) => [styles.resetBtn, pressed && styles.pressed]}
            >
              <FeatureIcon color="#F59E0B" name="arrow.counterclockwise" size={13} />
              <Text style={styles.resetText}>รีเซ็ต</Text>
            </Pressable>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>

        {/* Main Body wrapped in KeyboardAvoidingView for seamless keyboard support */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
          style={styles.keyboardBody}
        >
          {/* Center Image Canvas */}
          <View style={styles.canvasContainer}>
            {activeUri ? (
              <View style={styles.imageWrapper}>
                <Image
                  cachePolicy="memory-disk"
                  contentFit="contain"
                  source={{ uri: activeUri }}
                  style={styles.mainImage}
                  transition={80}
                />
              </View>
            ) : null}

            {isProcessing && (
              <View style={styles.processingOverlay}>
                <BlurView intensity={35} style={StyleSheet.absoluteFill} tint="dark" />
                <ActivityIndicator color="#3B5AFE" size="large" />
                <Text style={styles.processingText}>{processingLabel}</Text>
              </View>
            )}
          </View>

          {/* Multi-Photo Thumbnail Strip (if 2 or more photos) */}
          {urisList.length > 1 && (
            <View style={styles.multiThumbStrip}>
              <ScrollView
                contentContainerStyle={styles.multiThumbContent}
                horizontal
                showsHorizontalScrollIndicator={false}
              >
                {urisList.map((uri, idx) => {
                  const isCurrent = idx === selectedIdx;
                  const displayUri = editedUrisMap.current[idx] || uri;
                  return (
                    <Pressable
                      accessibilityLabel={`เลือกรูปที่ ${idx + 1}`}
                      key={idx}
                      onPress={() => handleSelectImageIndex(idx)}
                      style={[
                        styles.thumbItem,
                        isCurrent && styles.thumbItemActive,
                      ]}
                    >
                      <Image
                        cachePolicy="memory-disk"
                        contentFit="cover"
                        source={{ uri: displayUri }}
                        style={styles.thumbImage}
                      />
                      <View style={[styles.thumbBadge, isCurrent && styles.thumbBadgeActive]}>
                        <Text style={styles.thumbBadgeText}>{idx + 1}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Editor Controls & Sub-Tools (hidden while typing caption for maximum focus & clean layout) */}
          {!isKeyboardOpen && (
            <View style={styles.controlsContainer}>
              {/* Tab Selector: หมุน & ปรับ / ครอบตัด / ฟิลเตอร์ */}
              <View style={styles.tabBar}>
                <Pressable
                  onPress={() => setActiveTab('tools')}
                  style={[styles.tabBtn, activeTab === 'tools' && styles.tabBtnActive]}
                >
                  <FeatureIcon
                    color={activeTab === 'tools' ? '#3B5AFE' : '#94A3B8'}
                    name="slider.horizontal.3"
                    size={14}
                  />
                  <Text style={[styles.tabText, activeTab === 'tools' && styles.tabTextActive]}>
                    หมุน & ปรับ
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('crop')}
                  style={[styles.tabBtn, activeTab === 'crop' && styles.tabBtnActive]}
                >
                  <FeatureIcon
                    color={activeTab === 'crop' ? '#3B5AFE' : '#94A3B8'}
                    name="crop"
                    size={14}
                  />
                  <Text style={[styles.tabText, activeTab === 'crop' && styles.tabTextActive]}>
                    ครอบตัด
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => setActiveTab('filters')}
                  style={[styles.tabBtn, activeTab === 'filters' && styles.tabBtnActive]}
                >
                  <FeatureIcon
                    color={activeTab === 'filters' ? '#3B5AFE' : '#94A3B8'}
                    name="wand.and.stars"
                    size={14}
                  />
                  <Text style={[styles.tabText, activeTab === 'filters' && styles.tabTextActive]}>
                    ฟิลเตอร์
                  </Text>
                </Pressable>
              </View>

              {/* Sub-tools based on activeTab */}
              <View style={styles.subToolsRow}>
                {activeTab === 'tools' && (
                  <View style={styles.actionsRow}>
                    <Pressable
                      accessibilityLabel="หมุนรูป 90 องศา"
                      disabled={isProcessing}
                      onPress={handleRotate90}
                      style={({ pressed }) => [styles.actionPillBtn, pressed && styles.pressed]}
                    >
                      <FeatureIcon color="#FFFFFF" name="rotate.right.fill" size={16} />
                      <Text style={styles.actionPillText}>หมุน 90°</Text>
                    </Pressable>

                    <Pressable
                      accessibilityLabel="กลับด้านรูปภาพแนวนอน"
                      disabled={isProcessing}
                      onPress={handleFlipHorizontal}
                      style={({ pressed }) => [styles.actionPillBtn, pressed && styles.pressed]}
                    >
                      <FeatureIcon color="#FFFFFF" name="arrow.left.and.right.righttriangle.left.righttriangle.right.fill" size={16} />
                      <Text style={styles.actionPillText}>กลับด้าน</Text>
                    </Pressable>
                  </View>
                )}

                {activeTab === 'crop' && (
                  <ScrollView
                    contentContainerStyle={styles.cropPresetsContent}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {CROP_RATIOS.map((item) => (
                      <Pressable
                        accessibilityLabel={`ครอบตัดสัดส่วน ${item.label}`}
                        disabled={isProcessing}
                        key={item.id}
                        onPress={() => handleCropPreset(item.ratio)}
                        style={({ pressed }) => [styles.cropPresetBtn, pressed && styles.pressed]}
                      >
                        <Text style={styles.cropPresetRatio}>{item.name}</Text>
                        <Text style={styles.cropPresetLabel}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}

                {activeTab === 'filters' && (
                  <ScrollView
                    contentContainerStyle={styles.filtersContent}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                  >
                    {FILTER_PRESETS.map((filter) => {
                      const isSelected = selectedFilter === filter.id;
                      return (
                        <Pressable
                          accessibilityLabel={`ฟิลเตอร์ ${filter.name}`}
                          disabled={isProcessing}
                          key={filter.id}
                          onPress={() => handleApplyFilter(filter.id)}
                          style={[
                            styles.filterChip,
                            isSelected && styles.filterChipActive,
                          ]}
                        >
                          <FeatureIcon
                            color={isSelected ? '#FFFFFF' : '#94A3B8'}
                            name={filter.icon}
                            size={13}
                          />
                          <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                            {filter.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            </View>
          )}

          {/* Bottom Bar: Caption Input & Send Button - Perfectly anchored without floating */}
          <View style={[styles.bottomBarWrapper, { paddingBottom: isKeyboardOpen ? 10 : Math.max(insets.bottom, 12) }]}>
            <View style={styles.captionInputRow}>
              <TextInput
                keyboardAppearance="dark"
                maxLength={280}
                multiline={false}
                onChangeText={setCaption}
                placeholder="เพิ่มคำบรรยายรูปภาพ..."
                placeholderTextColor="#64748B"
                returnKeyType="done"
                style={styles.captionInput}
                value={caption}
              />

              <Pressable
                accessibilityLabel={confirmLabel}
                disabled={isProcessing}
                onPress={handleConfirmSend}
                style={({ pressed }) => [styles.sendBtn, pressed && styles.pressed]}
              >
                {isProcessing ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons color="#FFFFFF" name="send" size={15} style={{ marginRight: 2 }} />
                    <Text style={styles.sendBtnText}>{confirmLabel}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* Hidden Headless WebView for Fast Real Filter Processing */}
        <View pointerEvents="none" style={styles.hiddenWebView}>
          <WebView
            allowFileAccess
            allowUniversalAccessFromFileURLs
            domStorageEnabled
            javaScriptEnabled
            onMessage={handleWebViewMessage}
            originWhitelist={['*']}
            ref={webViewRef}
            source={{ html: FILTER_PROCESSOR_HTML }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#0A0C10',
    flex: 1,
  },
  keyboardBody: {
    flex: 1,
  },
  headerBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(10, 12, 16, 0.88)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingHorizontal: 16,
    zIndex: 20,
  },
  headerBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 18,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  resetBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  resetText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
  },
  canvasContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  imageWrapper: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
    width: '100%',
  },
  mainImage: {
    height: '100%',
    width: '100%',
  },
  processingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    gap: 12,
    justifyContent: 'center',
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  processingText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  multiThumbStrip: {
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  multiThumbContent: {
    gap: 10,
    paddingHorizontal: 16,
  },
  thumbItem: {
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 1.5,
    height: 52,
    overflow: 'hidden',
    position: 'relative',
    width: 52,
  },
  thumbItemActive: {
    borderColor: '#3B5AFE',
  },
  thumbImage: {
    height: '100%',
    width: '100%',
  },
  thumbBadge: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: 8,
    bottom: 2,
    height: 16,
    justifyContent: 'center',
    position: 'absolute',
    right: 2,
    width: 16,
  },
  thumbBadgeActive: {
    backgroundColor: '#3B5AFE',
  },
  thumbBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '700',
  },
  controlsContainer: {
    backgroundColor: 'rgba(15, 18, 24, 0.95)',
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  tabBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(59, 90, 254, 0.18)',
    borderColor: '#3B5AFE',
    borderWidth: 1,
  },
  tabText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#3B5AFE',
    fontWeight: '700',
  },
  subToolsRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 54,
    paddingVertical: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center',
  },
  actionPillBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 20,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  actionPillText: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '600',
  },
  cropPresetsContent: {
    gap: 10,
    paddingHorizontal: 16,
  },
  cropPresetBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    minWidth: 62,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  cropPresetRatio: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  cropPresetLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  filtersContent: {
    gap: 8,
    paddingHorizontal: 16,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterChipActive: {
    backgroundColor: '#3B5AFE',
  },
  filterChipText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  bottomBarWrapper: {
    backgroundColor: '#0F1218',
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  captionInputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  captionInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    color: '#FFFFFF',
    flex: 1,
    fontSize: 14,
    maxHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sendBtn: {
    alignItems: 'center',
    backgroundColor: '#3B5AFE',
    borderRadius: 20,
    elevation: 4,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 18,
    shadowColor: '#3B5AFE',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.97 }],
  },
  hiddenWebView: {
    height: 1,
    opacity: 0,
    overflow: 'hidden',
    position: 'absolute',
    width: 1,
  },
});
