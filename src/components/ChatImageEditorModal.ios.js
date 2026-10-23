import { Pressable } from './NativePressable';
import Text from './AppText';
import { AppTextInput as TextInput } from './AppText';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Dimensions, Image as RNImage, Keyboard, KeyboardAvoidingView, Modal, PanResponder, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView } from 'react-native-webview';
import { Host, Image as SwiftUIImage, ZStack } from '@expo/ui/swift-ui';
import {
  aspectRatio,
  brightness,
  clipped,
  contrast,
  frame,
  grayscale,
  overlay,
  resizable,
  saturation,
} from '@expo/ui/swift-ui/modifiers';
import * as Haptics from 'expo-haptics';
import Ionicons from '@expo/vector-icons/Ionicons';
import FeatureIcon from './FeatureIcon';
import { showAlert } from '../utils/appAlert';
import { GlassBackground, GlassIconButton, useLiquidGlass } from './LiquidGlassSurface';

const EMPTY_IMAGE_URIS = [];

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
  { id: 'original', name: 'ต้นฉบับ', ratio: null, label: 'เดิม' },
  { id: 'free', name: 'อิสระ', ratio: 'free', label: 'ปรับเอง' },
  { id: '1:1', name: 'จัตุรัส', ratio: 1, label: '1:1' },
  { id: '4:3', name: '4:3', ratio: 4 / 3, label: 'แนวนอน' },
  { id: '16:9', name: '16:9', ratio: 16 / 9, label: 'ไวด์' },
  { id: '2:3', name: '2:3', ratio: 2 / 3, label: 'โปรไฟล์' },
  { id: '3:4', name: '3:4', ratio: 3 / 4, label: 'แนวตั้ง' },
];

// High-speed pixel canvas processor for baking filters into actual JPEG files
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
    function post(data) {
      try {
        if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
          window.ReactNativeWebView.postMessage(JSON.stringify(data));
        }
      } catch(e) {}
    }

    window.applyFilter = function(base64Src, filterType, requestId) {
      var img = new Image();
      img.onload = function() {
        try {
          var canvas = document.getElementById('c');
          var maxDim = 1440;
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
          ctx.drawImage(img, 0, 0, w, h);

          if (filterType === 'bw') {
            var imgData = ctx.getImageData(0, 0, w, h);
            var d = imgData.data;
            for (var i = 0; i < d.length; i += 4) {
              var gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
              gray = Math.min(255, Math.max(0, ((gray - 128) * 1.18) + 128));
              d[i] = gray;
              d[i + 1] = gray;
              d[i + 2] = gray;
            }
            ctx.putImageData(imgData, 0, 0);
          } else if (filterType === 'vivid') {
            var imgData = ctx.getImageData(0, 0, w, h);
            var d = imgData.data;
            for (var i = 0; i < d.length; i += 4) {
              var r = d[i], g = d[i+1], b = d[i+2];
              var gray = 0.299 * r + 0.587 * g + 0.114 * b;
              r = gray + 1.5 * (r - gray);
              g = gray + 1.5 * (g - gray);
              b = gray + 1.5 * (b - gray);
              d[i] = Math.min(255, Math.max(0, ((r - 128) * 1.12) + 128));
              d[i+1] = Math.min(255, Math.max(0, ((g - 128) * 1.12) + 128));
              d[i+2] = Math.min(255, Math.max(0, ((b - 128) * 1.12) + 128));
            }
            ctx.putImageData(imgData, 0, 0);
          } else if (filterType === 'warm') {
            var imgData = ctx.getImageData(0, 0, w, h);
            var d = imgData.data;
            for (var i = 0; i < d.length; i += 4) {
              d[i] = Math.min(255, d[i] + 18);
              d[i+1] = Math.min(255, d[i+1] + 8);
              d[i+2] = Math.max(0, d[i+2] - 12);
            }
            ctx.putImageData(imgData, 0, 0);
          } else if (filterType === 'cool') {
            var imgData = ctx.getImageData(0, 0, w, h);
            var d = imgData.data;
            for (var i = 0; i < d.length; i += 4) {
              d[i] = Math.max(0, d[i] - 10);
              d[i+1] = Math.min(255, d[i+1] + 4);
              d[i+2] = Math.min(255, d[i+2] + 22);
            }
            ctx.putImageData(imgData, 0, 0);
          } else if (filterType === 'vintage') {
            var imgData = ctx.getImageData(0, 0, w, h);
            var d = imgData.data;
            for (var i = 0; i < d.length; i += 4) {
              var r = d[i], g = d[i+1], b = d[i+2];
              d[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189));
              d[i+1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168));
              d[i+2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131));
            }
            ctx.putImageData(imgData, 0, 0);
          }

          var resultBase64 = canvas.toDataURL('image/jpeg', 0.88);
          post({ requestId: requestId, success: true, base64: resultBase64 });
        } catch(err) {
          post({ requestId: requestId, success: false, error: String(err) });
        }
      };
      img.onerror = function() {
        post({ requestId: requestId, success: false, error: 'Image failed to load' });
      };
      img.src = base64Src;
    };

    post({ type: 'ready' });
  </script>
</body>
</html>`;

// Helper to detect which handle or region is being touched
const getHandleAtPosition = (locationX, locationY, imageDisplayRect, curBox) => {
  if (!imageDisplayRect?.width || !imageDisplayRect?.height || !curBox?.width || !curBox?.height) {
    return null;
  }
  const boxLeft = imageDisplayRect.x + curBox.x;
  const boxTop = imageDisplayRect.y + curBox.y;
  const boxRight = boxLeft + curBox.width;
  const boxBottom = boxTop + curBox.height;

  const CORNER_RADIUS = 44; // Comfortable 44pt touch zone for corner brackets
  const EDGE_MARGIN = 36;   // 36pt touch zone for edge handles

  // Check 4 corners first (corners take priority)
  if (Math.hypot(locationX - boxLeft, locationY - boxTop) <= CORNER_RADIUS) return 'tl';
  if (Math.hypot(locationX - boxRight, locationY - boxTop) <= CORNER_RADIUS) return 'tr';
  if (Math.hypot(locationX - boxLeft, locationY - boxBottom) <= CORNER_RADIUS) return 'bl';
  if (Math.hypot(locationX - boxRight, locationY - boxBottom) <= CORNER_RADIUS) return 'br';

  // Check 4 edges
  if (
    Math.abs(locationY - boxTop) <= EDGE_MARGIN &&
    locationX >= boxLeft - 16 &&
    locationX <= boxRight + 16
  ) {
    return 't';
  }
  if (
    Math.abs(locationY - boxBottom) <= EDGE_MARGIN &&
    locationX >= boxLeft - 16 &&
    locationX <= boxRight + 16
  ) {
    return 'b';
  }
  if (
    Math.abs(locationX - boxLeft) <= EDGE_MARGIN &&
    locationY >= boxTop - 16 &&
    locationY <= boxBottom + 16
  ) {
    return 'l';
  }
  if (
    Math.abs(locationX - boxRight) <= EDGE_MARGIN &&
    locationY >= boxTop - 16 &&
    locationY <= boxBottom + 16
  ) {
    return 'r';
  }

  // Check inside box for moving/panning
  if (
    locationX >= boxLeft &&
    locationX <= boxRight &&
    locationY >= boxTop &&
    locationY <= boxBottom
  ) {
    return 'move';
  }

  return null;
};

export default function ChatImageEditorModal({
  visible,
  imageUri,
  imageUris = EMPTY_IMAGE_URIS,
  onClose,
  onSend,
  colors,
  initialCaption = '',
  confirmLabel = 'ส่ง',
  showCaption = true,
}) {
  const insets = useSafeAreaInsets();
  const glass = useLiquidGlass();
  const [activeUri, setActiveUri] = useState(null);
  const [originalUri, setOriginalUri] = useState(null);
  const [urisList, setUrisList] = useState([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [caption, setCaption] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState('กำลังประมวลผลรูปภาพ...');
  const [selectedFilter, setSelectedFilter] = useState('normal');
  const [selectedCropRatio, setSelectedCropRatio] = useState('original');
  const [activeTab, setActiveTab] = useState('tools'); // 'tools' | 'crop' | 'filters'
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [hasEdits, setHasEdits] = useState(false);
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const [stageLayout, setStageLayout] = useState({ width: 0, height: 0, x: 0, y: 0 });
  const [cropBox, setCropBox] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [cropOrientation, setCropOrientation] = useState('portrait'); // 'portrait' | 'landscape'
  const [isDraggingCrop, setIsDraggingCrop] = useState(false);

  const cropBoxRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const activeHandleRef = useRef(null);
  const startDragBoxRef = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const baseCropUriRef = useRef(null);
  const baseDimensionsRef = useRef({ width: 1, height: 1 });
  const webViewRef = useRef(null);
  const isWebViewReadyRef = useRef(false);
  const pendingResolvers = useRef({});
  const bakedFilesMap = useRef({});
  const editedUrisMap = useRef({});
  const confirmingRef = useRef(false);

  // Real-time GPU SwiftUI modifiers for 0ms instant filter preview - strictly clipped to prevent bounds overflow
  const filterModifiers = useMemo(() => {
    const base = [resizable(), aspectRatio({ contentMode: 'fit' }), frame({ alignment: 'center' }), clipped()];
    if (selectedFilter === 'bw') {
      return [...base, grayscale(1.0), contrast(1.18)];
    }
    if (selectedFilter === 'vivid') {
      return [...base, saturation(1.65), contrast(1.15)];
    }
    if (selectedFilter === 'warm') {
      return [
        ...base,
        saturation(1.2),
        overlay({ color: 'rgba(255, 170, 70, 0.18)' }),
      ];
    }
    if (selectedFilter === 'cool') {
      return [
        ...base,
        saturation(1.1),
        overlay({ color: 'rgba(50, 130, 255, 0.18)' }),
      ];
    }
    if (selectedFilter === 'vintage') {
      return [
        ...base,
        grayscale(0.4),
        contrast(1.1),
        overlay({ color: 'rgba(220, 160, 90, 0.22)' }),
      ];
    }
    return base;
  }, [selectedFilter]);

  const triggerHaptic = useCallback((type = 'selection') => {
    try {
      if (type === 'selection') {
        Haptics?.selectionAsync?.();
      } else if (type === 'impact') {
        Haptics?.impactAsync?.(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch {}
  }, []);

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
      baseCropUriRef.current = first;
      bakedFilesMap.current = {};
      editedUrisMap.current = {};
      setCaption(initialCaption);
      setSelectedFilter('normal');
      setSelectedCropRatio('original');
      setCropOrientation('portrait');
      setActiveTab('tools');
      setHasEdits(false);

      if (first) {
        RNImage.getSize(
          first,
          (w, h) => {
            baseDimensionsRef.current = { width: w, height: h };
            setDimensions({ width: w, height: h });
          },
          () => {
            baseDimensionsRef.current = { width: 1000, height: 1000 };
            setDimensions({ width: 1000, height: 1000 });
          }
        );
      }
    }
  }, [visible, imageUri, imageUris, initialCaption]);

  // Precise calculation of fitted image bounds inside stageFrame
  const imageDisplayRect = useMemo(() => {
    const stageW = stageLayout.width;
    const stageH = stageLayout.height;
    const baseW = baseDimensionsRef.current?.width || dimensions.width || 1000;
    const baseH = baseDimensionsRef.current?.height || dimensions.height || 1000;

    if (!stageW || !stageH || !baseW || !baseH) {
      return { x: 0, y: 0, width: stageW || 300, height: stageH || 300 };
    }

    const imgRatio = baseW / baseH;
    const stageRatio = stageW / stageH;

    let renderedW = stageW;
    let renderedH = stageH;
    let renderedX = 0;
    let renderedY = 0;

    if (imgRatio > stageRatio) {
      renderedW = stageW;
      renderedH = Math.round(stageW / imgRatio);
      renderedX = 0;
      renderedY = Math.round((stageH - renderedH) / 2);
    } else {
      renderedH = stageH;
      renderedW = Math.round(stageH * imgRatio);
      renderedX = Math.round((stageW - renderedW) / 2);
      renderedY = 0;
    }

    return { x: renderedX, y: renderedY, width: renderedW, height: renderedH };
  }, [stageLayout.width, stageLayout.height, dimensions.width, dimensions.height]);

  // Sync cropBox whenever imageDisplayRect changes or when entering original mode
  useEffect(() => {
    if (imageDisplayRect.width > 0 && imageDisplayRect.height > 0) {
      if (cropBoxRef.current.width === 0 || selectedCropRatio === 'original') {
        const full = { x: 0, y: 0, width: imageDisplayRect.width, height: imageDisplayRect.height };
        setCropBox(full);
        cropBoxRef.current = full;
      }
    }
  }, [imageDisplayRect.width, imageDisplayRect.height, selectedCropRatio]);

  // Interactive PanResponder for freeform drag-resizing & moving crop box.
  // Created once and fed through refs: rebuilding it when the ratio, tab or
  // layout changed swapped the handlers in the middle of a drag (the first
  // resize switches the ratio to "free"), so the box jumped back or stopped.
  const cropGestureStateRef = useRef({ activeTab, imageDisplayRect, selectedCropRatio });
  cropGestureStateRef.current = { activeTab, imageDisplayRect, selectedCropRatio };
  const triggerHapticRef = useRef(triggerHaptic);
  triggerHapticRef.current = triggerHaptic;
  const cropReceiverRef = useRef(null);
  const cropReceiverOriginRef = useRef(null);
  const measureCropReceiver = useCallback(() => {
    cropReceiverRef.current?.measure?.((x, y, width, height, pageX, pageY) => {
      if (Number.isFinite(pageX) && Number.isFinite(pageY)) {
        cropReceiverOriginRef.current = { x: pageX, y: pageY };
      }
    });
  }, []);

  const panResponder = useMemo(() => {
    // Touch point in the receiver's coordinates. Page position minus the
    // receiver's measured page origin does not depend on which native view
    // reported the touch; locationX is only used before the first measure.
    const pointFor = (evt) => {
      const { locationX, locationY, pageX, pageY } = evt.nativeEvent;
      const origin = cropReceiverOriginRef.current;
      if (origin && Number.isFinite(pageX) && Number.isFinite(pageY)) {
        return { x: pageX - origin.x, y: pageY - origin.y };
      }
      return { x: locationX, y: locationY };
    };
    const claim = (evt, keepActive) => {
      const { activeTab: tab, imageDisplayRect: rect } = cropGestureStateRef.current;
      if (tab !== 'crop') return false;
      if (keepActive && activeHandleRef.current) return true;
      const { x, y } = pointFor(evt);
      const handle = getHandleAtPosition(x, y, rect, cropBoxRef.current);
      if (!handle) return false;
      activeHandleRef.current = handle;
      startDragBoxRef.current = { ...cropBoxRef.current };
      return true;
    };
    const finish = () => {
      setIsDraggingCrop(false);
      activeHandleRef.current = null;
      measureCropReceiver();
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: (evt) => claim(evt, false),
      onStartShouldSetPanResponderCapture: (evt) => claim(evt, false),
      onMoveShouldSetPanResponder: (evt) => claim(evt, true),
      onMoveShouldSetPanResponderCapture: (evt) => claim(evt, true),
      onPanResponderGrant: () => {
        setIsDraggingCrop(true);
        // Moving the frame keeps the chosen ratio; resizing by hand is freeform.
        if (activeHandleRef.current !== 'move' && cropGestureStateRef.current.selectedCropRatio !== 'free') {
          setSelectedCropRatio('free');
        }
        triggerHapticRef.current('impact');
      },
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderMove: (evt, gestureState) => {
        const handle = activeHandleRef.current;
        if (!handle) return;
        const init = startDragBoxRef.current;
        const imgW = cropGestureStateRef.current.imageDisplayRect.width;
        const imgH = cropGestureStateRef.current.imageDisplayRect.height;
        const MIN_SIZE = 50;

        const { dx, dy } = gestureState;
        let newX = init.x;
        let newY = init.y;
        let newW = init.width;
        let newH = init.height;

        if (handle === 'move') {
          newX = Math.max(0, Math.min(imgW - init.width, init.x + dx));
          newY = Math.max(0, Math.min(imgH - init.height, init.y + dy));
        } else if (handle === 'tl') {
          newX = Math.max(0, Math.min(init.x + init.width - MIN_SIZE, init.x + dx));
          newY = Math.max(0, Math.min(init.y + init.height - MIN_SIZE, init.y + dy));
          newW = init.width - (newX - init.x);
          newH = init.height - (newY - init.y);
        } else if (handle === 'tr') {
          newY = Math.max(0, Math.min(init.y + init.height - MIN_SIZE, init.y + dy));
          newW = Math.max(MIN_SIZE, Math.min(imgW - init.x, init.width + dx));
          newH = init.height - (newY - init.y);
        } else if (handle === 'bl') {
          newX = Math.max(0, Math.min(init.x + init.width - MIN_SIZE, init.x + dx));
          newW = init.width - (newX - init.x);
          newH = Math.max(MIN_SIZE, Math.min(imgH - init.y, init.height + dy));
        } else if (handle === 'br') {
          newW = Math.max(MIN_SIZE, Math.min(imgW - init.x, init.width + dx));
          newH = Math.max(MIN_SIZE, Math.min(imgH - init.y, init.height + dy));
        } else if (handle === 't') {
          newY = Math.max(0, Math.min(init.y + init.height - MIN_SIZE, init.y + dy));
          newH = init.height - (newY - init.y);
        } else if (handle === 'b') {
          newH = Math.max(MIN_SIZE, Math.min(imgH - init.y, init.height + dy));
        } else if (handle === 'l') {
          newX = Math.max(0, Math.min(init.x + init.width - MIN_SIZE, init.x + dx));
          newW = init.width - (newX - init.x);
        } else if (handle === 'r') {
          newW = Math.max(MIN_SIZE, Math.min(imgW - init.x, init.width + dx));
        }

        const nextBox = {
          x: Math.round(newX),
          y: Math.round(newY),
          width: Math.round(newW),
          height: Math.round(newH),
        };
        cropBoxRef.current = nextBox;
        setCropBox(nextBox);
      },
      onPanResponderRelease: () => {
        finish();
        triggerHapticRef.current('selection');
      },
      onPanResponderTerminate: finish,
    });
  }, [measureCropReceiver]);

  // Handle messages from headless canvas WebView
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
            const fileUri = `${FileSystem.cacheDirectory}baked_filter_${data.requestId}.jpg`;
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

  // Background baking of filter into actual JPEG file
  const bakeFilter = async (sourceUri, filterId) => {
    if (!sourceUri || filterId === 'normal') return sourceUri;
    const cacheKey = `${filterId}_${sourceUri}`;
    if (bakedFilesMap.current[cacheKey]) return bakedFilesMap.current[cacheKey];

    try {
      const manip = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ resize: { width: 1080 } }],
        { compress: 0.80, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      const reqId = `${filterId}_${Date.now()}`;
      const promise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          delete pendingResolvers.current[reqId];
          resolve(manip.uri);
        }, 3000);

        pendingResolvers.current[reqId] = {
          resolve: (fileUri) => {
            clearTimeout(timeout);
            resolve(fileUri);
          },
          reject: (err) => {
            clearTimeout(timeout);
            resolve(manip.uri);
          },
        };
      });

      const jsCode = `window.applyFilter && window.applyFilter("data:image/jpeg;base64,${manip.base64}", "${filterId}", "${reqId}"); true;`;
      webViewRef.current?.injectJavaScript(jsCode);

      const resultUri = await promise;
      bakedFilesMap.current[cacheKey] = resultUri;
      return resultUri;
    } catch (e) {
      console.warn('[ChatImageEditor] Bake filter error:', e);
      return sourceUri;
    }
  };

  // Switch image when tapping thumbnail in multi-photo mode
  const handleSelectImageIndex = (idx) => {
    if (idx === selectedIdx) return;
    if (activeUri) {
      editedUrisMap.current[selectedIdx] = activeUri;
    }

    const nextUri = editedUrisMap.current[idx] || urisList[idx];
    if (nextUri) {
      setSelectedIdx(idx);
      setActiveUri(nextUri);
      setOriginalUri(urisList[idx]);
      baseCropUriRef.current = nextUri;
      bakedFilesMap.current = {};
      setSelectedFilter('normal');
      setSelectedCropRatio('original');
      RNImage.getSize(
        nextUri,
        (w, h) => {
          baseDimensionsRef.current = { width: w, height: h };
          setDimensions({ width: w, height: h });
        },
        () => {
          baseDimensionsRef.current = { width: 1000, height: 1000 };
          setDimensions({ width: 1000, height: 1000 });
        }
      );
    }
  };

  // Helper to cleanly crop a source image to a target ratio without modifying the uncropped base
  const applyCropToSource = async (sourceUri, sourceWidth, sourceHeight, ratio) => {
    if (!ratio || !sourceWidth || !sourceHeight) {
      return { uri: sourceUri, width: sourceWidth, height: sourceHeight };
    }
    let cropW = sourceWidth;
    let cropH = sourceHeight;

    if (ratio === 1) {
      const minSide = Math.min(sourceWidth, sourceHeight);
      cropW = minSide;
      cropH = minSide;
    } else if (sourceWidth / sourceHeight > ratio) {
      cropW = Math.floor(sourceHeight * ratio);
      cropH = sourceHeight;
    } else {
      cropW = sourceWidth;
      cropH = Math.floor(sourceWidth / ratio);
    }

    const originX = Math.max(0, Math.floor((sourceWidth - cropW) / 2));
    const originY = Math.max(0, Math.floor((sourceHeight - cropH) / 2));

    const result = await ImageManipulator.manipulateAsync(
      sourceUri,
      [{ crop: { originX, originY, width: cropW, height: cropH } }],
      { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
    );
    return { uri: result.uri, width: result.width, height: result.height };
  };

  // 1. Rotate 90 degrees clockwise on uncropped base and reapply active crop
  const handleRotate90 = async () => {
    if (!activeUri || isProcessing || !baseCropUriRef.current) return;
    setIsProcessing(true);
    setProcessingLabel('กำลังหมุนรูปภาพ...');
    try {
      const rotatedBase = await ImageManipulator.manipulateAsync(
        baseCropUriRef.current,
        [{ rotate: 90 }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      baseCropUriRef.current = rotatedBase.uri;
      baseDimensionsRef.current = { width: rotatedBase.width, height: rotatedBase.height };
      setHasEdits(true);

      const activeRatioObj = CROP_RATIOS.find((r) => r.id === selectedCropRatio);
      if (activeRatioObj && activeRatioObj.ratio) {
        const cropped = await applyCropToSource(
          rotatedBase.uri,
          rotatedBase.width,
          rotatedBase.height,
          activeRatioObj.ratio
        );
        setActiveUri(cropped.uri);
        setDimensions({ width: cropped.width, height: cropped.height });
        bakedFilesMap.current = {};
        if (selectedFilter !== 'normal') {
          bakeFilter(cropped.uri, selectedFilter);
        }
      } else {
        setActiveUri(rotatedBase.uri);
        setDimensions({ width: rotatedBase.width, height: rotatedBase.height });
        bakedFilesMap.current = {};
        if (selectedFilter !== 'normal') {
          bakeFilter(rotatedBase.uri, selectedFilter);
        }
      }
    } catch (err) {
      console.warn('[ChatImageEditor] Rotate error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Flip Horizontally (Mirror effect) on uncropped base and reapply active crop
  const handleFlipHorizontal = async () => {
    if (!activeUri || isProcessing || !baseCropUriRef.current) return;
    setIsProcessing(true);
    setProcessingLabel('กำลังกลับด้านรูปภาพ...');
    try {
      const flippedBase = await ImageManipulator.manipulateAsync(
        baseCropUriRef.current,
        [{ flip: ImageManipulator.FlipType.Horizontal }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      baseCropUriRef.current = flippedBase.uri;
      setHasEdits(true);

      const activeRatioObj = CROP_RATIOS.find((r) => r.id === selectedCropRatio);
      if (activeRatioObj && activeRatioObj.ratio) {
        const cropped = await applyCropToSource(
          flippedBase.uri,
          baseDimensionsRef.current.width,
          baseDimensionsRef.current.height,
          activeRatioObj.ratio
        );
        setActiveUri(cropped.uri);
        setDimensions({ width: cropped.width, height: cropped.height });
        bakedFilesMap.current = {};
        if (selectedFilter !== 'normal') {
          bakeFilter(cropped.uri, selectedFilter);
        }
      } else {
        setActiveUri(flippedBase.uri);
        bakedFilesMap.current = {};
        if (selectedFilter !== 'normal') {
          bakeFilter(flippedBase.uri, selectedFilter);
        }
      }
    } catch (err) {
      console.warn('[ChatImageEditor] Flip error:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  // Commit current crop box onto uncropped base
  const commitCurrentCropBox = async () => {
    const box = cropBoxRef.current;
    const imgRect = imageDisplayRect;
    if (!box.width || !box.height || !imgRect.width || !imgRect.height) return null;
    const baseUri = baseCropUriRef.current;
    if (!baseUri) return null;

    const baseW = baseDimensionsRef.current?.width || dimensions.width;
    const baseH = baseDimensionsRef.current?.height || dimensions.height;

    const isFullFrame =
      box.x <= 2 &&
      box.y <= 2 &&
      Math.abs(box.width - imgRect.width) <= 4 &&
      Math.abs(box.height - imgRect.height) <= 4;

    if (isFullFrame && selectedCropRatio === 'original') {
      setActiveUri(baseUri);
      setDimensions({ width: baseW, height: baseH });
      return baseUri;
    }

    const scaleX = baseW / imgRect.width;
    const scaleY = baseH / imgRect.height;

    let originX = Math.round(box.x * scaleX);
    let originY = Math.round(box.y * scaleY);
    let cropWidth = Math.round(box.width * scaleX);
    let cropHeight = Math.round(box.height * scaleY);

    originX = Math.max(0, Math.min(baseW - 10, originX));
    originY = Math.max(0, Math.min(baseH - 10, originY));
    cropWidth = Math.max(10, Math.min(baseW - originX, cropWidth));
    cropHeight = Math.max(10, Math.min(baseH - originY, cropHeight));

    setIsProcessing(true);
    setProcessingLabel('กำลังครอบตัดรูปภาพ...');
    try {
      const result = await ImageManipulator.manipulateAsync(
        baseUri,
        [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );
      setActiveUri(result.uri);
      setDimensions({ width: result.width, height: result.height });
      bakedFilesMap.current = {};
      setHasEdits(true);
      if (selectedFilter !== 'normal') {
        bakeFilter(result.uri, selectedFilter);
      }
      return result.uri;
    } catch (err) {
      console.warn('[ChatImageEditor] Commit crop error:', err);
      return null;
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. Crop Preset or Freeform Selection
  const handleCropPreset = async (cropItem) => {
    if (!activeUri || isProcessing || !baseCropUriRef.current) return;
    const targetId = typeof cropItem === 'object' ? cropItem?.id : (CROP_RATIOS.find((r) => r.ratio === cropItem)?.id || 'custom');
    const targetRatio = typeof cropItem === 'object' ? cropItem?.ratio : cropItem;

    setSelectedCropRatio(targetId);

    if (targetId === 'free') {
      const imgW = imageDisplayRect.width;
      const imgH = imageDisplayRect.height;
      const cur = cropBoxRef.current;
      if (
        cur.width === 0 ||
        (cur.x <= 2 && cur.y <= 2 && Math.abs(cur.width - imgW) <= 4 && Math.abs(cur.height - imgH) <= 4)
      ) {
        const insetW = Math.round(imgW * 0.85);
        const insetH = Math.round(imgH * 0.85);
        const insetX = Math.round((imgW - insetW) / 2);
        const insetY = Math.round((imgH - insetH) / 2);
        const nextBox = { x: insetX, y: insetY, width: insetW, height: insetH };
        cropBoxRef.current = nextBox;
        setCropBox(nextBox);
      }
      triggerHaptic('selection');
      return;
    }

    if (targetId === 'original') {
      const full = { x: 0, y: 0, width: imageDisplayRect.width, height: imageDisplayRect.height };
      cropBoxRef.current = full;
      setCropBox(full);
      setActiveUri(baseCropUriRef.current);
      setDimensions(baseDimensionsRef.current);
      bakedFilesMap.current = {};
      triggerHaptic('impact');
      return;
    }

    let ratio = targetRatio;
    if (typeof ratio === 'number') {
      if (cropOrientation === 'landscape' && ratio < 1) {
        ratio = 1 / ratio;
      } else if (cropOrientation === 'portrait' && ratio > 1) {
        ratio = 1 / ratio;
      }
      const imgW = imageDisplayRect.width;
      const imgH = imageDisplayRect.height;
      if (imgW && imgH) {
        let boxW = imgW;
        let boxH = imgH;
        if (imgW / imgH > ratio) {
          boxW = Math.round(imgH * ratio);
          boxH = imgH;
        } else {
          boxW = imgW;
          boxH = Math.round(imgW / ratio);
        }
        const boxX = Math.round((imgW - boxW) / 2);
        const boxY = Math.round((imgH - boxH) / 2);
        const nextBox = { x: boxX, y: boxY, width: boxW, height: boxH };
        cropBoxRef.current = nextBox;
        setCropBox(nextBox);
        triggerHaptic('impact');
      }
    }
  };

  // Switch aspect ratio orientation between portrait and landscape
  const handleToggleOrientation = (targetOrientation) => {
    if (targetOrientation === cropOrientation) return;
    setCropOrientation(targetOrientation);
    triggerHaptic('impact');

    const cur = cropBoxRef.current;
    if (selectedCropRatio === 'free') {
      const imgW = imageDisplayRect.width;
      const imgH = imageDisplayRect.height;
      const newW = Math.min(imgW, cur.height);
      const newH = Math.min(imgH, cur.width);
      const newX = Math.round((imgW - newW) / 2);
      const newY = Math.round((imgH - newH) / 2);
      const swapped = { x: newX, y: newY, width: newW, height: newH };
      cropBoxRef.current = swapped;
      setCropBox(swapped);
      return;
    }

    const activeRatioObj = CROP_RATIOS.find((r) => r.id === selectedCropRatio);
    if (activeRatioObj && typeof activeRatioObj.ratio === 'number') {
      let ratio = activeRatioObj.ratio;
      if (targetOrientation === 'landscape' && ratio < 1) {
        ratio = 1 / ratio;
      } else if (targetOrientation === 'portrait' && ratio > 1) {
        ratio = 1 / ratio;
      }
      const imgW = imageDisplayRect.width;
      const imgH = imageDisplayRect.height;
      if (imgW && imgH) {
        let boxW = imgW;
        let boxH = imgH;
        if (imgW / imgH > ratio) {
          boxW = Math.round(imgH * ratio);
          boxH = imgH;
        } else {
          boxW = imgW;
          boxH = Math.round(imgW / ratio);
        }
        const boxX = Math.round((imgW - boxW) / 2);
        const boxY = Math.round((imgH - boxH) / 2);
        const nextBox = { x: boxX, y: boxY, width: boxW, height: boxH };
        cropBoxRef.current = nextBox;
        setCropBox(nextBox);
      }
    }
  };

  // Immediate Apply crop button
  const handleApplyCropNow = async () => {
    triggerHaptic('impact');
    await commitCurrentCropBox();
  };

  // 4. Instant Filter Selection
  const handleApplyFilter = (filterId) => {
    if (filterId === selectedFilter) return;
    // Instantly update UI with GPU CoreImage rendering in 0ms!
    setSelectedFilter(filterId);
    setHasEdits(true);
    // Bake filter into actual JPEG in background
    if (filterId !== 'normal' && activeUri) {
      bakeFilter(activeUri, filterId);
    }
  };

  // 5. Reset to Original
  const handleReset = () => {
    if (originalUri && hasEdits) {
      baseCropUriRef.current = originalUri;
      setActiveUri(originalUri);
      bakedFilesMap.current = {};
      setSelectedFilter('normal');
      setSelectedCropRatio('original');
      setCropOrientation('portrait');
      setHasEdits(false);
      RNImage.getSize(
        originalUri,
        (w, h) => {
          baseDimensionsRef.current = { width: w, height: h };
          setDimensions({ width: w, height: h });
          const full = { x: 0, y: 0, width: imageDisplayRect.width, height: imageDisplayRect.height };
          cropBoxRef.current = full;
          setCropBox(full);
        },
        () => {
          baseDimensionsRef.current = { width: 1000, height: 1000 };
          setDimensions({ width: 1000, height: 1000 });
        }
      );
    }
  };

  // 6. Final Send - ensures the real filtered JPEG is dispatched
  const handleConfirmSend = async () => {
    if (!activeUri || isProcessing || confirmingRef.current) return;
    confirmingRef.current = true;
    setIsProcessing(true);
    setProcessingLabel('กำลังเตรียมรูปภาพ...');
    try {
      let finalUri = activeUri;

      // If a color filter is active, get the baked JPEG file
      if (selectedFilter !== 'normal') {
        finalUri = await bakeFilter(activeUri, selectedFilter);
      }

      let finalUris = urisList.length > 0 ? [...urisList] : [finalUri];
      Object.keys(editedUrisMap.current).forEach((idx) => {
        if (editedUrisMap.current[idx]) {
          finalUris[Number(idx)] = editedUrisMap.current[idx];
        }
      });
      if (urisList.length > 0 && selectedIdx >= 0) finalUris[selectedIdx] = finalUri;

      await onSend?.(finalUris.length > 1 ? finalUris : finalUri, caption.trim());
      onClose?.();
    } catch (err) {
      console.warn('[ChatImageEditor] Confirm send error:', err);
      showAlert('ใช้รูปภาพไม่สำเร็จ', err?.message || 'กรุณาลองใหม่อีกครั้ง');
    } finally {
      confirmingRef.current = false;
      setIsProcessing(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      animationType="fade"
      hardwareAccelerated
      onRequestClose={() => { if (!isProcessing) onClose?.(); }}
      statusBarTranslucent
      transparent={false}
      visible={visible}
    >
      <View style={styles.root}>
        {/* Top Header Bar */}
        <View style={[styles.headerBar, { paddingTop: Math.max(insets.top, 20) + 6 }]}>
          <GlassIconButton
            accessibilityLabel="ยกเลิกการแก้ไข"
            colorScheme="dark"
            disabled={isProcessing}
            fallbackBackgroundColor="rgba(255, 255, 255, 0.12)"
            hitSlop={10}
            icon="xmark"
            iconColor="#FFFFFF"
            iconSize={18}
            onPress={onClose}
            size={40}
          />

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>ปรับแต่งรูปภาพ</Text>
            {urisList.length > 1 && (
              <View style={styles.counterBadge}>
                <Text style={styles.counterText}>{`${selectedIdx + 1}/${urisList.length}`}</Text>
              </View>
            )}
          </View>

          {hasEdits ? (
            <Pressable
              accessibilityLabel="รีเซ็ตรูปภาพเดิม"
              hitSlop={10}
              onPress={() => {
                triggerHaptic('impact');
                handleReset();
              }}
              style={({ pressed }) => [styles.resetBtn, glass && styles.glassClear, pressed && styles.pressed]}
            >
              <GlassBackground colorScheme="dark" style={{ borderRadius: 14 }} tintColor="rgba(245, 158, 11, 0.28)" />
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
          {/* Center Image Canvas - Strictly bounded framed stage (No edge overflow) */}
          <View style={styles.canvasContainer}>
            <View
              onLayout={(e) => setStageLayout(e.nativeEvent.layout)}
              style={styles.stageFrame}
            >
              {activeUri ? (
                <Host
                  pointerEvents={activeTab === 'crop' ? 'none' : 'auto'}
                  style={styles.swiftUiHost}
                >
                  <ZStack alignment="center" modifiers={[frame({ maxWidth: Infinity, maxHeight: Infinity })]}>
                    <SwiftUIImage
                      uiImage={activeTab === 'crop' && baseCropUriRef.current ? baseCropUriRef.current : activeUri}
                      modifiers={filterModifiers}
                    />
                  </ZStack>
                </Host>
              ) : null}

              {/* Active Interactive Crop Box & Scrim when in crop mode */}
              {activeTab === 'crop' && imageDisplayRect.width > 0 && (
                <>
                  {/* Dimmed Scrim outside crop box */}
                  <View pointerEvents="none" style={[styles.scrim, { top: 0, left: 0, right: 0, height: Math.max(0, imageDisplayRect.y + (cropBox.height > 0 ? cropBox.y : 0)) }]} />
                  <View pointerEvents="none" style={[styles.scrim, { top: imageDisplayRect.y + (cropBox.height > 0 ? cropBox.y : 0) + (cropBox.height > 0 ? cropBox.height : imageDisplayRect.height), left: 0, right: 0, bottom: 0 }]} />
                  <View pointerEvents="none" style={[styles.scrim, { top: imageDisplayRect.y + (cropBox.height > 0 ? cropBox.y : 0), left: 0, width: Math.max(0, imageDisplayRect.x + (cropBox.width > 0 ? cropBox.x : 0)), height: cropBox.height > 0 ? cropBox.height : imageDisplayRect.height }]} />
                  <View pointerEvents="none" style={[styles.scrim, { top: imageDisplayRect.y + (cropBox.height > 0 ? cropBox.y : 0), left: imageDisplayRect.x + (cropBox.width > 0 ? cropBox.x : 0) + (cropBox.width > 0 ? cropBox.width : imageDisplayRect.width), right: 0, height: cropBox.height > 0 ? cropBox.height : imageDisplayRect.height }]} />

                  {/* Active Crop Box Frame with 3x3 Grid and Corner Handles */}
                  <View
                    pointerEvents="none"
                    style={[
                      styles.cropBoxFrame,
                      {
                        left: imageDisplayRect.x + (cropBox.width > 0 ? cropBox.x : 0),
                        top: imageDisplayRect.y + (cropBox.height > 0 ? cropBox.y : 0),
                        width: cropBox.width > 0 ? cropBox.width : imageDisplayRect.width,
                        height: cropBox.height > 0 ? cropBox.height : imageDisplayRect.height,
                      },
                    ]}
                  >
                    {/* 3x3 Rule-of-Thirds Grid Lines */}
                    <View style={[styles.gridLineH, { top: '33.33%' }]} />
                    <View style={[styles.gridLineH, { top: '66.67%' }]} />
                    <View style={[styles.gridLineV, { left: '33.33%' }]} />
                    <View style={[styles.gridLineV, { left: '66.67%' }]} />

                    {/* 4 Corner L-Brackets */}
                    <View style={[styles.cornerHandle, styles.cornerHandleTL]}>
                      <View style={styles.cornerBarH} />
                      <View style={styles.cornerBarV} />
                    </View>
                    <View style={[styles.cornerHandle, styles.cornerHandleTR]}>
                      <View style={[styles.cornerBarH, { right: 0 }]} />
                      <View style={[styles.cornerBarV, { right: 0 }]} />
                    </View>
                    <View style={[styles.cornerHandle, styles.cornerHandleBL]}>
                      <View style={[styles.cornerBarH, { bottom: 0 }]} />
                      <View style={[styles.cornerBarV, { bottom: 0 }]} />
                    </View>
                    <View style={[styles.cornerHandle, styles.cornerHandleBR]}>
                      <View style={[styles.cornerBarH, { right: 0, bottom: 0 }]} />
                      <View style={[styles.cornerBarV, { right: 0, bottom: 0 }]} />
                    </View>

                    {/* 4 Edge Handles */}
                    <View style={[styles.edgeHandleH, { top: -2 }]} />
                    <View style={[styles.edgeHandleH, { bottom: -2 }]} />
                    <View style={[styles.edgeHandleV, { left: -2 }]} />
                    <View style={[styles.edgeHandleV, { right: -2 }]} />
                  </View>

                  {/* Floating Scale Badge */}
                  <View pointerEvents="none" style={styles.cropScaleBadge}>
                    <FeatureIcon color="#60A5FA" name="crop" size={11} />
                    <Text style={styles.cropScaleBadgeText}>
                      {selectedCropRatio === 'free'
                        ? 'ครอบตัดอิสระ (ลากมุม/ขอบ)'
                        : selectedCropRatio === 'original'
                        ? 'สัดส่วนเดิม'
                        : `สเกล ${selectedCropRatio} · ${CROP_RATIOS.find((r) => r.id === selectedCropRatio)?.label || ''}`}
                    </Text>
                  </View>

                  {/* Gesture Receiver */}
                  <View
                    ref={cropReceiverRef}
                    onLayout={measureCropReceiver}
                    {...panResponder.panHandlers}
                    style={styles.cropGestureReceiver}
                  />
                </>
              )}

              {/* Viewfinder corner guides for framing when not in crop mode */}
              {activeTab !== 'crop' && (
                <>
                  <View pointerEvents="none" style={[styles.cornerGuide, styles.cornerTL]} />
                  <View pointerEvents="none" style={[styles.cornerGuide, styles.cornerTR]} />
                  <View pointerEvents="none" style={[styles.cornerGuide, styles.cornerBL]} />
                  <View pointerEvents="none" style={[styles.cornerGuide, styles.cornerBR]} />
                </>
              )}

              {isProcessing && (
                <View style={styles.processingOverlay}>
                  <BlurView intensity={35} style={StyleSheet.absoluteFill} tint="dark" />
                  <ActivityIndicator color="#3B5AFE" size="large" />
                  <Text style={styles.processingText}>{processingLabel}</Text>
                </View>
              )}
            </View>
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
                      onPress={() => {
                        triggerHaptic('selection');
                        handleSelectImageIndex(idx);
                      }}
                      style={[
                        styles.thumbItem,
                        isCurrent && styles.thumbItemActive,
                      ]}
                    >
                      <ExpoImage
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

          {/* Editor Controls & Sub-Tools */}
          {!isKeyboardOpen && (
            <View style={styles.controlsContainer}>
              {/* Liquid Glass Segmented Tab Selector: เครื่องมือ / ครอบตัด / ฟิลเตอร์ */}
              <View style={styles.tabBar}>
                <Pressable
                  accessibilityLabel="เลือกโหมดเครื่องมือ"
                  onPress={() => {
                    triggerHaptic('selection');
                    setActiveTab('tools');
                  }}
                  style={[styles.tabBtn, activeTab === 'tools' && styles.tabBtnActive]}
                >
                  <FeatureIcon
                    color={activeTab === 'tools' ? '#60A5FA' : '#94A3B8'}
                    name="slider.horizontal.3"
                    size={14}
                  />
                  <Text style={[styles.tabText, activeTab === 'tools' && styles.tabTextActive]}>
                    เครื่องมือ
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="เลือกโหมดครอบตัด"
                  onPress={() => {
                    triggerHaptic('selection');
                    setActiveTab('crop');
                    if (selectedCropRatio === 'original') {
                      setSelectedCropRatio('free');
                      const imgW = imageDisplayRect.width;
                      const imgH = imageDisplayRect.height;
                      if (imgW > 0 && imgH > 0) {
                        const insetW = Math.round(imgW * 0.85);
                        const insetH = Math.round(imgH * 0.85);
                        const insetX = Math.round((imgW - insetW) / 2);
                        const insetY = Math.round((imgH - insetH) / 2);
                        const nextBox = { x: insetX, y: insetY, width: insetW, height: insetH };
                        cropBoxRef.current = nextBox;
                        setCropBox(nextBox);
                      }
                    }
                  }}
                  style={[styles.tabBtn, activeTab === 'crop' && styles.tabBtnActive]}
                >
                  <FeatureIcon
                    color={activeTab === 'crop' ? '#60A5FA' : '#94A3B8'}
                    name="crop"
                    size={14}
                  />
                  <Text style={[styles.tabText, activeTab === 'crop' && styles.tabTextActive]}>
                    ครอบตัด
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityLabel="เลือกโหมดฟิลเตอร์"
                  onPress={() => {
                    triggerHaptic('selection');
                    setActiveTab('filters');
                  }}
                  style={[styles.tabBtn, activeTab === 'filters' && styles.tabBtnActive]}
                >
                  <FeatureIcon
                    color={activeTab === 'filters' ? '#60A5FA' : '#94A3B8'}
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
                      onPress={() => {
                        triggerHaptic('impact');
                        handleRotate90();
                      }}
                      style={({ pressed }) => [styles.actionPillBtn, pressed && styles.pressed]}
                    >
                      <FeatureIcon color="#FFFFFF" name="rotate.right.fill" size={16} />
                      <Text style={styles.actionPillText}>หมุน 90°</Text>
                    </Pressable>

                    <Pressable
                      accessibilityLabel="กลับด้านรูปภาพแนวนอน"
                      disabled={isProcessing}
                      onPress={() => {
                        triggerHaptic('impact');
                        handleFlipHorizontal();
                      }}
                      style={({ pressed }) => [styles.actionPillBtn, pressed && styles.pressed]}
                    >
                      <FeatureIcon color="#FFFFFF" name="arrow.left.and.right.righttriangle.left.righttriangle.right.fill" size={16} />
                      <Text style={styles.actionPillText}>กลับด้าน</Text>
                    </Pressable>
                  </View>
                )}

                {activeTab === 'crop' && (
                  <View style={styles.cropToolsContainer}>
                    {/* Top subheader: Orientation toggles & Apply button */}
                    <View style={styles.cropSubHeaderRow}>
                      <View style={styles.orientationSwitchGroup}>
                        <Pressable
                          accessibilityLabel="ครอบตัดแนวตั้ง"
                          onPress={() => handleToggleOrientation('portrait')}
                          style={[
                            styles.orientationBtn,
                            cropOrientation === 'portrait' && styles.orientationBtnActive,
                          ]}
                        >
                          <View
                            style={[
                              styles.orientationIconV,
                              cropOrientation === 'portrait' && styles.orientationIconActive,
                            ]}
                          />
                        </Pressable>

                        <Pressable
                          accessibilityLabel="ครอบตัดแนวนอน"
                          onPress={() => handleToggleOrientation('landscape')}
                          style={[
                            styles.orientationBtn,
                            cropOrientation === 'landscape' && styles.orientationBtnActive,
                          ]}
                        >
                          <View
                            style={[
                              styles.orientationIconH,
                              cropOrientation === 'landscape' && styles.orientationIconActive,
                            ]}
                          />
                        </Pressable>
                      </View>

                      <Pressable
                        accessibilityLabel="นำการครอบตัดไปใช้"
                        disabled={isProcessing}
                        onPress={handleApplyCropNow}
                        style={({ pressed }) => [styles.applyCropPillBtn, pressed && styles.pressed]}
                      >
                        <Ionicons color="#FFFFFF" name="checkmark-sharp" size={13} />
                        <Text style={styles.applyCropPillText}>นำไปใช้</Text>
                      </Pressable>
                    </View>

                    {/* Ratio Presets Horizontal Scroll */}
                    <ScrollView
                      contentContainerStyle={styles.cropPresetsContent}
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {CROP_RATIOS.map((item) => {
                        const isSelected = selectedCropRatio === item.id;
                        return (
                          <Pressable
                            accessibilityLabel={`ครอบตัดสัดส่วน ${item.label}`}
                            disabled={isProcessing}
                            key={item.id}
                            onPress={() => {
                              triggerHaptic('impact');
                              handleCropPreset(item);
                            }}
                            style={({ pressed }) => [
                              styles.cropPresetBtn,
                              isSelected && styles.cropPresetBtnActive,
                              pressed && styles.pressed,
                            ]}
                          >
                            <Text style={[styles.cropPresetRatio, isSelected && styles.cropPresetRatioActive]}>
                              {item.name}
                            </Text>
                            <Text style={[styles.cropPresetLabel, isSelected && styles.cropPresetLabelActive]}>
                              {item.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
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
                          onPress={() => {
                            triggerHaptic('selection');
                            handleApplyFilter(filter.id);
                          }}
                          style={[
                            styles.filterChip,
                            isSelected && styles.filterChipActive,
                          ]}
                        >
                          <FeatureIcon
                            color={isSelected ? '#FFFFFF' : '#94A3B8'}
                            name={filter.icon}
                            size={14}
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

          {/* Bottom Bar: Caption Input & Send Button */}
          <View style={[styles.bottomBarWrapper, { paddingBottom: isKeyboardOpen ? 10 : Math.max(insets.bottom, 14) }]}>
            <View style={[styles.captionInputRow, !showCaption && { justifyContent: 'flex-end' }]}>
              {showCaption ? (
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
              ) : null}

              <Pressable
                accessibilityLabel={confirmLabel}
                disabled={isProcessing}
                onPress={() => {
                  triggerHaptic('impact');
                  handleConfirmSend();
                }}
                style={({ pressed }) => [styles.sendBtn, pressed && styles.pressed]}
              >
                {isProcessing ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <Ionicons color="#FFFFFF" name={showCaption ? 'send' : 'checkmark'} size={15} style={{ marginRight: 2 }} />
                    <Text style={styles.sendBtnText}>{confirmLabel}</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>

        {/* Headless Offscreen Canvas WebView for Baking Filter into Real JPEG File */}
        <View
          pointerEvents="none"
          style={{
            height: 200,
            left: -2000,
            opacity: 0.99,
            overflow: 'hidden',
            position: 'absolute',
            top: 0,
            width: 200,
          }}
        >
          <WebView
            allowFileAccess
            allowUniversalAccessFromFileURLs
            domStorageEnabled
            javaScriptEnabled
            onLoadEnd={() => {
              isWebViewReadyRef.current = true;
            }}
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
    backgroundColor: '#07090E',
    flex: 1,
  },
  keyboardBody: {
    flex: 1,
  },
  headerBar: {
    alignItems: 'center',
    backgroundColor: 'rgba(7, 9, 14, 0.92)',
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 10,
    paddingHorizontal: 16,
    zIndex: 20,
  },
  headerCenter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 16.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  counterBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  counterText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  glassClear: { backgroundColor: 'transparent', borderColor: 'transparent' },
  headerBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 20,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  resetBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 12,
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    position: 'relative',
    width: '100%',
  },
  stageFrame: {
    alignItems: 'center',
    backgroundColor: '#090B10',
    borderColor: 'rgba(255, 255, 255, 0.09)',
    borderRadius: 22,
    borderWidth: 1,
    height: '100%',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    width: '100%',
  },
  swiftUiHost: {
    alignItems: 'center',
    height: '100%',
    justifyContent: 'center',
    width: '100%',
  },
  cropGridOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 10,
  },
  cropGestureReceiver: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.001)',
    zIndex: 999,
    elevation: 999,
  },
  scrim: {
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    position: 'absolute',
    zIndex: 12,
  },
  cropBoxFrame: {
    borderColor: 'rgba(255, 255, 255, 0.85)',
    borderWidth: 1,
    position: 'absolute',
    zIndex: 15,
  },
  cornerHandle: {
    height: 24,
    position: 'absolute',
    width: 24,
    zIndex: 25,
  },
  cornerHandleTL: { left: -2, top: -2 },
  cornerHandleTR: { right: -2, top: -2 },
  cornerHandleBL: { bottom: -2, left: -2 },
  cornerHandleBR: { bottom: -2, right: -2 },
  cornerBarH: {
    backgroundColor: '#FFFFFF',
    borderRadius: 1.5,
    height: 3.5,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    width: 22,
  },
  cornerBarV: {
    backgroundColor: '#FFFFFF',
    borderRadius: 1.5,
    height: 22,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    width: 3.5,
  },
  edgeHandleH: {
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    height: 3.5,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    width: 28,
  },
  edgeHandleV: {
    backgroundColor: '#FFFFFF',
    borderRadius: 2,
    height: 28,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.8,
    shadowRadius: 2,
    top: '50%',
    marginTop: -14,
    width: 3.5,
  },
  cropToolsContainer: {
    gap: 8,
    width: '100%',
  },
  cropSubHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    width: '100%',
  },
  orientationSwitchGroup: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    padding: 3,
  },
  orientationBtn: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 36,
  },
  orientationBtnActive: {
    backgroundColor: 'rgba(59, 90, 254, 0.3)',
    borderColor: '#3B82F6',
    borderWidth: 1,
  },
  orientationIconV: {
    borderColor: '#94A3B8',
    borderRadius: 2.5,
    borderWidth: 1.5,
    height: 18,
    width: 12,
  },
  orientationIconH: {
    borderColor: '#94A3B8',
    borderRadius: 2.5,
    borderWidth: 1.5,
    height: 12,
    width: 18,
  },
  orientationIconActive: {
    borderColor: '#60A5FA',
  },
  applyCropPillBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  applyCropPillText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  gridLineH: {
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    height: 1,
    left: 0,
    position: 'absolute',
    right: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.5,
    shadowRadius: 1,
  },
  gridLineV: {
    backgroundColor: 'rgba(255, 255, 255, 0.42)',
    bottom: 0,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 1, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 1,
    top: 0,
    width: 1,
  },
  gridDot: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(0, 0, 0, 0.45)',
    borderRadius: 3,
    borderWidth: 0.8,
    height: 6,
    marginLeft: -3,
    marginTop: -3,
    position: 'absolute',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 2,
    width: 6,
  },
  cropScaleBadge: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    borderColor: 'rgba(96, 165, 250, 0.45)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
  cropScaleBadgeText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  cornerGuideActive: {
    borderColor: '#3B82F6',
    borderWidth: 2.5,
  },
  cornerGuide: {
    borderColor: 'rgba(255, 255, 255, 0.24)',
    height: 14,
    position: 'absolute',
    width: 14,
    zIndex: 5,
  },
  cornerTL: {
    borderLeftWidth: 2,
    borderTopLeftRadius: 6,
    borderTopWidth: 2,
    left: 8,
    top: 8,
  },
  cornerTR: {
    borderRightWidth: 2,
    borderTopRightRadius: 6,
    borderTopWidth: 2,
    right: 8,
    top: 8,
  },
  cornerBL: {
    borderBottomLeftRadius: 6,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
    bottom: 8,
    left: 8,
  },
  cornerBR: {
    borderBottomRightRadius: 6,
    borderBottomWidth: 2,
    borderRightWidth: 2,
    bottom: 8,
    right: 8,
  },
  processingOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    gap: 12,
    justifyContent: 'center',
    ...StyleSheet.absoluteFill,
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
    borderRadius: 12,
    borderWidth: 2,
    height: 54,
    overflow: 'hidden',
    position: 'relative',
    width: 54,
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
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
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
    fontSize: 9.5,
    fontWeight: '700',
  },
  controlsContainer: {
    backgroundColor: 'rgba(12, 15, 22, 0.96)',
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  tabBar: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 16,
    padding: 3,
  },
  tabBtn: {
    alignItems: 'center',
    borderRadius: 16,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.22)',
    borderColor: '#2563EB',
    borderWidth: 1,
  },
  tabText: {
    color: '#94A3B8',
    fontSize: 12.5,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#60A5FA',
    fontWeight: '700',
  },
  subToolsRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    paddingVertical: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'center',
  },
  actionPillBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 18,
    paddingVertical: 9,
  },
  actionPillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  cropPresetsContent: {
    gap: 10,
    paddingHorizontal: 16,
  },
  cropPresetBtn: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 14,
    borderWidth: 1,
    minWidth: 64,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  cropPresetBtnActive: {
    backgroundColor: 'rgba(37, 99, 235, 0.35)',
    borderColor: '#3B82F6',
  },
  cropPresetRatio: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  cropPresetRatioActive: {
    color: '#60A5FA',
  },
  cropPresetLabel: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 2,
  },
  cropPresetLabelActive: {
    color: '#93C5FD',
  },
  filtersContent: {
    gap: 8,
    paddingHorizontal: 16,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 15,
    paddingVertical: 8,
  },
  filterChipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#3B82F6',
  },
  filterChipText: {
    color: '#94A3B8',
    fontSize: 12.5,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  bottomBarWrapper: {
    backgroundColor: 'rgba(10, 13, 19, 0.96)',
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
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 22,
    borderWidth: 1,
    color: '#FFFFFF',
    flex: 1,
    fontSize: 14,
    height: 44,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sendBtn: {
    alignItems: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 22,
    elevation: 4,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    paddingHorizontal: 20,
    shadowColor: '#2563EB',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.97 }],
  },
});
