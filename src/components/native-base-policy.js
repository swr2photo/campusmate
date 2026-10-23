// Layout stays in Yoga. Native controls only mount once their real bounds exist.
export function nativeBounds(layout) {
  const width = Number(layout?.width), height = Number(layout?.height);
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height } : null;
}

export function actionLabel(children, explicitLabel) {
  if (explicitLabel) return String(explicitLabel);
  const labels = [], icons = [];
  const symbolLabels = { xmark: 'ปิด', 'xmark.circle.fill': 'ปิด', 'chevron.left': 'ย้อนกลับ',
    'chevron.right': 'ถัดไป', 'chevron.down': 'ย่อรายละเอียด', 'chevron.up': 'ดูรายละเอียด',
    ellipsis: 'ตัวเลือกเพิ่มเติม', 'heart.fill': 'ถูกใจ', 'heart': 'ถูกใจ',
    'play.fill': 'เล่น', 'pause.fill': 'หยุดชั่วคราว', 'arrow.clockwise': 'ลองอีกครั้ง',
    'arrow.counterclockwise': 'ย้อนกลับ', 'trash.fill': 'ลบ', 'plus': 'เพิ่ม',
    'camera.fill': 'เปิดกล้อง', 'photo': 'ดูรูปภาพ', 'paperplane.fill': 'ส่ง',
    'gearshape.fill': 'ตั้งค่า', 'slider.horizontal.3': 'ตัวกรอง', 'magnifyingglass': 'ค้นหา' };
  function visit(child) {
    if (typeof child === 'string' || typeof child === 'number') labels.push(String(child));
    else if (Array.isArray(child)) child.forEach(visit);
    else if (child?.props) {
      if (child.props.accessibilityLabel) labels.push(child.props.accessibilityLabel);
      else {
        if (child.props.name) icons.push(symbolLabels[child.props.name] || child.props.name);
        if (child.props.source || child.props.uri) icons.push('ดูรูปภาพ');
        visit(child.props.children);
      }
    }
  }
  visit(children);
  return labels.join(' ').trim() || icons.join(' ').trim();
}

// These are content/gesture containers, not standalone buttons. Their existing
// responder owns nested actions, recording, coordinate-based tools and drags.
export function needsGestureResponder(props, children) {
  if (props.nativeGestureSurface || props.onPressIn || props.onPressOut
    || props.onLongPress || props.onTouchStart || props.onTouchMove
    || props.onTouchEnd || props.onTouchCancel || props.onStartShouldSetResponder
    || props.onAccessibilityAction || props.accessibilityActions?.length || props.accessible === false
    || typeof children === 'function') return true;
  const visualComponents = /^(?:Text|AppText|RNText|FeatureIcon|Icon|Feather|Ionicons|MaterialIcons|MaterialCommunityIcons|FontAwesome[56]?|Image|CachedImage|ExpoImage|IosLikeAvatar|ActivityIndicator|LinearGradient|SymbolView|Animated\.(?:View|Text|Image))$/;
  function interactive(child) {
    if (Array.isArray(child)) return child.some(interactive);
    if (!child?.props) return false;
    if (child.props.onPress || child.props.onLongPress || child.props.onValueChange
      || child.props.onChangeText || child.props.onTouchStart) return true;
    if (typeof child.type !== 'string' && typeof child.type !== 'symbol') {
      const type = child.type?.render || child.type?.type || child.type;
      const name = child.type?.displayName || type?.displayName || type?.name || '';
      // Unknown custom components can contain controls that are invisible here.
      // Do not place a full-area native button above them.
      if (!visualComponents.test(name) && !/^(?:View|RCTView)$/.test(name)) return true;
    }
    return interactive(child.props.children);
  }
  return interactive(children);
}

export function isActionDisabled(props) {
  return Boolean(props.disabled || props.accessibilityState?.disabled || props.accessibilityState?.busy);
}

export function actionAccessibilityValue(props) {
  if (props.accessibilityValue?.text) return props.accessibilityValue.text;
  const state = props.accessibilityState || {};
  if (state.checked === 'mixed') return 'เลือกบางส่วน';
  if (typeof state.checked === 'boolean') return state.checked ? 'เลือกแล้ว' : 'ยังไม่เลือก';
  if (typeof state.expanded === 'boolean') return state.expanded ? 'ขยายแล้ว' : 'ย่ออยู่';
  if (Number.isFinite(props.accessibilityValue?.now)) return String(props.accessibilityValue.now);
  return null;
}

export function nativeSurfaceColor(style) {
  const color = style?.backgroundColor;
  return typeof color === 'string' && color !== 'transparent' ? color : null;
}
