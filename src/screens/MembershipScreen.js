import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, Stack, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Text from '../components/AppText';
import FeatureIcon from '../components/FeatureIcon';
import { useMembership } from '../context/MembershipContext';
import { useMembershipPackageAutoload } from '../hooks/useMembershipPackages';
import { PLUS_BENEFITS } from '../data/plans';

const palette = {
  background: '#14110E', text: '#F6F4F2', muted: '#B9B5B0', border: '#35312C',
  gold: '#E8B90B', button: '#F3F0EF', error: '#FF9A92',
};
const descriptions = {
  noAds: 'สนุกกับการหาเพื่อนและกิจกรรมได้อย่างต่อเนื่อง',
  advancedFilters: 'เลือกเพื่อนที่มีความสนใจและเวลาว่างตรงกับคุณ',
  incomingLikeProfiles: 'เห็นคนที่สนใจคุณ แล้วเลือกทำความรู้จักได้ทันที',
  unlimitedRewind: 'เปลี่ยนใจได้ กลับไปดูคนที่คุณเพิ่งข้ามหรือถูกใจ',
  incognito: 'ควบคุมว่าใครเห็นคุณได้ ให้คุณทำความรู้จักได้อย่างสบายใจ',
};

function packageCopy(entry) {
  const annual = entry.packageType === 'ANNUAL';
  const product = entry.product;
  return {
    title: annual ? '1 ปี' : '1 เดือน',
    caption: annual ? 'แพ็กเกจรายปี' : 'แพ็กเกจรายเดือน',
    rate: annual && product.pricePerMonthString
      ? `${product.pricePerMonthString}/เดือน`
      : `${product.priceString}/${annual ? 'ปี' : 'เดือน'}`,
    total: product.priceString,
    billing: annual ? 'เรียกเก็บรายปี' : 'เรียกเก็บรายเดือน',
  };
}

export default function MembershipScreen() {
  const membership = useMembership();
  const focused = useIsFocused();
  const { offline } = useMembershipPackageAutoload();
  const insets = useSafeAreaInsets();
  const { width, height, fontScale } = useWindowDimensions();
  const [viewportWidth, setViewportWidth] = useState(Math.min(width, 640));
  const [selectedId, setSelectedId] = useState(null);
  const [compactFooter, setCompactFooter] = useState(false);
  const [managementError, setManagementError] = useState('');
  const carousel = useRef(null);
  const plansBottom = useRef(Infinity);
  const storeAction = useRef(false);
  // Resolve the current store object again after offerings refresh.
  const selected = membership.packages.find((entry) => entry.identifier === selectedId) || membership.packages[0];
  const selectedIndex = selected ? membership.packages.indexOf(selected) : 0;
  const cardWidth = Math.round(Math.min(viewportWidth * 0.73, 360));
  const cardStride = cardWidth + 12;
  const selectedCopy = selected ? packageCopy(selected) : null;
  const canPurchase = membership.ready && membership.configured && !membership.plus && !membership.busy && Boolean(selected);
  const shortViewport = height < 650 || fontScale > 1.3;

  useEffect(() => {
    carousel.current?.scrollTo({ x: selectedIndex * cardStride, animated: false });
  }, [selectedIndex, cardStride]);

  function selectPackage(index) {
    const entry = membership.packages[index];
    if (!entry || membership.busy) return;
    setSelectedId(entry.identifier);
  }

  async function purchase() {
    if (!canPurchase || storeAction.current) return;
    storeAction.current = true;
    try {
      await membership.purchase(selected);
    } catch {
      // The context exposes errors and handles store cancellation.
    } finally {
      storeAction.current = false;
    }
  }

  async function restore() {
    if (membership.busy || storeAction.current) return;
    storeAction.current = true;
    try {
      await membership.restore();
    } catch {
      // Keep the selected package available for another attempt.
    } finally {
      storeAction.current = false;
    }
  }

  async function manageMembership() {
    if (!membership.managementUrl) return;
    setManagementError('');
    try {
      await Linking.openURL(membership.managementUrl);
    } catch {
      setManagementError('เปิดหน้าจัดการสมาชิกไม่ได้ กรุณาลองอีกครั้ง');
    }
  }

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/me');
  }

  return <View style={styles.screen}>
    <Stack.Screen options={{ headerShown: false, title: 'CampusMate Plus' }} />
    {focused ? <StatusBar style="light" /> : null}
    <View onLayout={({ nativeEvent }) => setViewportWidth(nativeEvent.layout.width - insets.left - insets.right)}
      style={[styles.page, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="ปิดหน้าสมัครสมาชิก" hitSlop={8}
          onPress={close} style={({ pressed }) => [styles.close, pressed && styles.pressed]}>
          <FeatureIcon name="xmark" size={25} color={palette.text} />
        </Pressable>
        <View accessible accessibilityRole="header" accessibilityLabel="CampusMate Plus" style={styles.brand}>
          <Text maxFontSizeMultiplier={1.15} style={styles.wordmark}>CampusMate</Text>
          <View style={styles.plusBadge}><Text maxFontSizeMultiplier={1.15} style={styles.plusText}>PLUS</Text></View>
        </View>
        <View style={styles.headerBalance} />
      </View>

      <ScrollView style={styles.scroll} contentInsetAdjustmentBehavior="never" indicatorStyle="white"
        contentContainerStyle={styles.content} scrollEventThrottle={32}
        onScroll={({ nativeEvent }) => {
          const compact = nativeEvent.contentOffset.y >= plansBottom.current - 48;
          setCompactFooter((current) => current === compact ? current : compact);
        }}>
        <View style={styles.hero}>
          <Text accessibilityRole="header" style={styles.headline}>
            {membership.plus ? 'สนุกกับทุกสิทธิ์\nของ CampusMate Plus' : 'ดูว่าใครถูกใจคุณ\nแล้วทำความรู้จักกัน\nด้วย CampusMate Plus'}
          </Text>
          {membership.plus ? <View style={styles.activeStatus}>
            <FeatureIcon name="checkmark.seal.fill" size={22} color={palette.gold} />
            <Text style={styles.activeText}>สมาชิก Plus ของคุณเปิดใช้งานแล้ว</Text>
          </View> : null}
        </View>

        {!membership.plus ? <View onLayout={({ nativeEvent }) => { plansBottom.current = nativeEvent.layout.y + nativeEvent.layout.height; }} style={styles.plans}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>เลือกแพ็กเกจ</Text>
          {!membership.configured ? <View style={styles.unavailable}>
            <FeatureIcon name="clock" size={28} color={palette.gold} />
            <Text style={styles.secondary}>ระบบสมัครสมาชิกยังไม่เปิดให้ใช้งาน</Text>
          </View> : membership.packages.length ? <>
            <ScrollView ref={carousel} horizontal contentInsetAdjustmentBehavior="never" showsHorizontalScrollIndicator={false}
              decelerationRate="fast" snapToInterval={cardStride} snapToAlignment="start" disableIntervalMomentum
              scrollEnabled={!membership.busy && membership.packages.length > 1}
              contentContainerStyle={[styles.carousel, { paddingRight: Math.max(16, viewportWidth - cardWidth - 16) }]}
              onMomentumScrollEnd={({ nativeEvent }) => selectPackage(Math.max(0, Math.min(membership.packages.length - 1, Math.round(nativeEvent.contentOffset.x / cardStride))))}>
              {membership.packages.map((entry) => {
                const copy = packageCopy(entry);
                const checked = entry.identifier === selected.identifier;
                return <Pressable key={entry.identifier} accessibilityRole="radio"
                  accessibilityLabel={`${copy.title}, ${copy.billing}, ${copy.total}`}
                  accessibilityState={{ checked, disabled: membership.busy }} disabled={membership.busy}
                  onPress={() => setSelectedId(entry.identifier)}
                  style={({ pressed }) => [styles.planCard, { width: cardWidth }, checked && styles.selectedCard, pressed && styles.pressed]}>
                  <View style={styles.planTop}>
                    <Text style={[styles.planCaption, checked && styles.goldText]}>{copy.caption}</Text>
                    {checked ? <FeatureIcon name="checkmark" size={25} color={palette.gold} /> : null}
                  </View>
                  <Text style={styles.planTitle}>{copy.title}</Text>
                  <View style={styles.planPrice}>
                    <Text selectable style={styles.rate}>{copy.rate}</Text>
                    <Text selectable style={styles.billing}>{copy.billing} {copy.total}</Text>
                  </View>
                </Pressable>;
              })}
            </ScrollView>
            {membership.packages.length > 1 ? <View style={styles.pagination}>
              {membership.packages.map((entry, index) => <Pressable key={entry.identifier} accessibilityRole="button"
                accessibilityLabel={`เลือกแพ็กเกจ ${packageCopy(entry).title}`}
                accessibilityState={{ selected: index === selectedIndex, disabled: membership.busy }} disabled={membership.busy}
                onPress={() => selectPackage(index)} style={styles.dotTarget}>
                <View style={[styles.dot, index === selectedIndex && styles.activeDot]} />
              </Pressable>)}
            </View> : null}
          </> : <PackagesLoading cardWidth={cardWidth} offline={offline} />}
        </View> : <Text selectable style={styles.membershipDate}>
          {membership.isAdmin ? 'สิทธิ์ผู้ดูแลระบบ (สิทธิ์พิเศษถาวร)' : `สิทธิ์สมาชิกถึง ${new Date(membership.activeUntil).toLocaleDateString('th-TH')}`}
        </Text>}

        <View style={styles.benefitsSection}>
          <View style={styles.benefitsHeading}><Text style={styles.benefitsHeadingText}>รวมอยู่ใน CampusMate Plus</Text></View>
          <View style={styles.benefits}>
            {PLUS_BENEFITS.map(({ feature, label }) => <View key={feature} style={styles.benefitRow}>
              <View style={styles.benefitCheck}><FeatureIcon name="checkmark" size={27} color={palette.text} /></View>
              <View style={styles.benefitCopy}>
                <Text style={styles.benefitTitle}>{label}</Text>
                <Text style={styles.benefitDescription}>{descriptions[feature]}</Text>
              </View>
            </View>)}
          </View>
        </View>

        <View style={styles.links}>
          {membership.configured ? <TextAction label="คืนค่าการซื้อ" disabled={membership.busy} onPress={() => void restore()} /> : null}
          <TextAction label="เงื่อนไขการใช้งาน" onPress={() => router.push('/terms')} />
          <TextAction label="ความเป็นส่วนตัว" onPress={() => router.push('/privacy-policy')} />
        </View>
        {shortViewport && !membership.plus ? <View style={styles.scrollTerms}><RenewalTerms /></View> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {membership.error || managementError ? <Text selectable accessibilityRole="alert" style={styles.error}>{membership.error || managementError}</Text> : null}
        {membership.plus ? <PurchaseButton label={membership.managementUrl ? 'จัดการสมาชิกในสโตร์' : 'เริ่มใช้งาน Plus'}
          onPress={membership.managementUrl ? () => void manageMembership() : close} disabled={membership.busy} busy={membership.busy} /> : <>
          {!shortViewport ? <RenewalTerms /> : null}
          {compactFooter && selectedCopy ? <View style={styles.compactPurchase}>
            <FeatureIcon name="sparkles" size={29} color={palette.gold} />
            <View style={styles.purchaseSummary}>
              <Text style={styles.summaryTitle}>{selectedCopy.title}</Text>
              <Text selectable style={styles.summaryTotal}>ทั้งหมด {selectedCopy.total}</Text>
            </View>
            <PurchaseButton label="ต่อไป" accessibilityLabel={`ดำเนินการต่อ ${selectedCopy.title} รวม ${selectedCopy.total}`}
              onPress={() => void purchase()} disabled={!canPurchase} busy={membership.busy} compact />
          </View> : <PurchaseButton label={!membership.configured ? 'ยังไม่เปิดให้สมัคร' : selectedCopy ? `ดำเนินการต่อ · รวม ${selectedCopy.total}` : offline ? 'รอการเชื่อมต่อ…' : 'กำลังโหลดแพ็กเกจ…'}
            onPress={() => void purchase()} disabled={!canPurchase} busy={membership.busy} />}
        </>}
      </View>
    </View>
  </View>;
}

function RenewalTerms() {
  const store = process.env.EXPO_OS === 'ios' ? 'App Store' : process.env.EXPO_OS === 'android' ? 'Google Play' : 'Google Play หรือ App Store';
  return <View style={styles.renewal}>
    <Text style={styles.renewalTitle}>เรียกเก็บเงินอัตโนมัติ ยกเลิกได้ทุกเมื่อ</Text>
    <Text style={styles.renewalCopy}>
      เมื่อแตะดำเนินการต่อ ระบบจะเรียกเก็บเงินผ่าน {store} และต่ออายุแพ็กเกจเดิมอัตโนมัติในราคาที่สโตร์แสดง จนกว่าคุณจะยกเลิกในสโตร์ คุณยังใช้สิทธิ์ได้ถึงวันสิ้นสุดรอบที่ชำระแล้ว และยอมรับ{' '}
      <Text accessibilityRole="link" onPress={() => router.push('/terms')} style={styles.inlineLink}>เงื่อนไขการใช้งาน</Text>
    </Text>
  </View>;
}

function PackagesLoading({ cardWidth, offline }) {
  const label = offline ? 'รอการเชื่อมต่ออินเทอร์เน็ต…' : 'กำลังโหลดแพ็กเกจ…';
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.loading}>
    <View style={styles.skeletonRow}>
      {[0, 1].map((index) => <View key={index} style={[styles.planCard, styles.skeletonCard, { width: cardWidth }]}>
        <View style={[styles.skeletonLine, { width: '40%' }]} />
        <View style={[styles.skeletonLine, { width: '60%', height: 32 }]} />
        <View style={[styles.skeletonLine, { width: '72%', marginTop: 40 }]} />
      </View>)}
    </View>
    <View style={styles.loadingStatus}><ActivityIndicator size="small" color={palette.gold} /><Text style={styles.secondary}>{label}</Text></View>
  </View>;
}

function TextAction({ label, onPress, disabled }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [styles.textAction, (pressed || disabled) && styles.pressed]}>
    <Text style={styles.linkText}>{label}</Text>
  </Pressable>;
}

function PurchaseButton({ label, accessibilityLabel, onPress, disabled, busy, compact }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || label}
    accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(busy) }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => [styles.purchaseButton, compact && styles.compactButton, (pressed || disabled) && styles.pressed]}>
    {busy ? <ActivityIndicator color={palette.background} /> : <Text style={styles.purchaseButtonText}>{label}</Text>}
  </Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  page: { flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { minHeight: 68, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  close: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#302D28', borderWidth: 1, borderColor: '#57534B', alignItems: 'center', justifyContent: 'center' },
  brand: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 7 },
  wordmark: { color: palette.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.8 },
  plusBadge: { backgroundColor: palette.gold, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  plusText: { color: palette.background, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  headerBalance: { width: 42 },
  scroll: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 24, gap: 30 },
  hero: { paddingHorizontal: 16, gap: 20 },
  headline: { color: palette.text, fontSize: 29, lineHeight: 43, fontWeight: '400' },
  activeStatus: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  activeText: { flex: 1, color: palette.gold, fontSize: 15 },
  plans: { gap: 18 },
  sectionTitle: { color: palette.text, fontSize: 18, paddingHorizontal: 16 },
  carousel: { paddingLeft: 16, gap: 12 },
  planCard: { borderWidth: 1.5, borderColor: palette.border, borderRadius: 26, borderCurve: 'continuous', padding: 20, minHeight: 194, justifyContent: 'space-between', gap: 5 },
  selectedCard: { borderColor: palette.gold, borderWidth: 2 },
  planTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  planCaption: { flex: 1, color: palette.muted, fontSize: 14 },
  goldText: { color: palette.gold },
  planTitle: { color: palette.text, fontSize: 30 },
  planPrice: { paddingTop: 24, gap: 2 },
  rate: { color: palette.text, fontSize: 19, fontVariant: ['tabular-nums'] },
  billing: { color: palette.muted, fontSize: 11 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: -12 },
  dotTarget: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#77716B' },
  activeDot: { backgroundColor: palette.text },
  benefitsSection: { marginHorizontal: 16, paddingTop: 12 },
  benefitsHeading: { position: 'absolute', top: 0, alignSelf: 'center', zIndex: 1, backgroundColor: palette.background, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1, borderColor: palette.border },
  benefitsHeadingText: { color: palette.muted, fontSize: 13 },
  benefits: { borderWidth: 1, borderColor: palette.border, borderRadius: 28, borderCurve: 'continuous', paddingHorizontal: 22, paddingTop: 35, paddingBottom: 26, gap: 28 },
  benefitRow: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  benefitCheck: { paddingTop: 4 },
  benefitCopy: { flex: 1, minWidth: 0, gap: 6 },
  benefitTitle: { color: palette.text, fontSize: 18, lineHeight: 28 },
  benefitDescription: { color: palette.muted, fontSize: 14, lineHeight: 23 },
  membershipDate: { color: palette.muted, fontSize: 14, paddingHorizontal: 16 },
  links: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 16, columnGap: 18 },
  textAction: { minHeight: 44, justifyContent: 'center' },
  linkText: { color: palette.muted, fontSize: 12, textDecorationLine: 'underline' },
  footer: { borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.background, paddingHorizontal: 16, paddingTop: 14, gap: 14 },
  renewal: { gap: 2 },
  renewalTitle: { color: palette.text, fontSize: 12 },
  renewalCopy: { color: palette.muted, fontSize: 11, lineHeight: 18 },
  inlineLink: { color: palette.text, textDecorationLine: 'underline' },
  scrollTerms: { paddingHorizontal: 16 },
  compactPurchase: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  purchaseSummary: { flex: 1, minWidth: 0, gap: 1 },
  summaryTitle: { color: palette.text, fontSize: 18 },
  summaryTotal: { color: palette.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  purchaseButton: { backgroundColor: palette.button, borderRadius: 99, minHeight: 52, paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  compactButton: { minWidth: 88, flexShrink: 1 },
  purchaseButtonText: { color: palette.background, fontSize: 18, fontWeight: '500', textAlign: 'center' },
  pressed: { opacity: 0.55 },
  error: { color: palette.error, fontSize: 12 },
  secondary: { color: palette.muted, fontSize: 13 },
  unavailable: { marginHorizontal: 16, minHeight: 194, borderWidth: 1, borderColor: palette.border, borderRadius: 26, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14 },
  loading: { gap: 18 },
  skeletonRow: { flexDirection: 'row', gap: 12, paddingLeft: 16, overflow: 'hidden' },
  skeletonCard: { opacity: 0.65, justifyContent: 'flex-start' },
  skeletonLine: { height: 14, backgroundColor: palette.border, borderRadius: 7 },
  loadingStatus: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
});
