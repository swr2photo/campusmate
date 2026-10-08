import Text from './AppText';
import React from 'react';
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import FeatureIcon from './FeatureIcon';
import { useTheme } from '../theme';

const instructions = [
  ['1', 'เตรียมรูปโปรไฟล์หลัก', 'ใช้รูปที่เห็นใบหน้าของคุณชัดเจน ไม่ปิดบังใบหน้า และไม่มีคนอื่นอยู่ในรูป'],
  ['2', 'ถ่ายรูปใบหน้าปัจจุบัน', 'อยู่ในที่สว่าง มองตรงไปที่กล้อง ถอดแว่นกันแดดและหน้ากาก แล้วถ่ายให้เห็นใบหน้าครบ'],
  ['3', 'รอผลการตรวจสอบ', 'ระบบจะเปรียบเทียบรูปที่ถ่ายกับรูปโปรไฟล์หลัก เมื่อผ่าน คุณจะได้รับเครื่องหมายยืนยันบนโปรไฟล์'],
];

export default function FaceVerificationDetails({ step, errorMessage, avatarUri, permissionGranted, onPrimary, onClose }) {
  const { colors, isDark } = useTheme();
  const busy = step === 'capturing' || step === 'verifying';
  const success = step === 'success';
  const failed = step === 'error';
  // Explicit surfaces keep this page readable even inside a camera modal.
  const canvas = isDark ? '#101820' : '#F7F7F8';
  const card = isDark ? '#1B2735' : '#FFFFFF';
  const ink = isDark ? '#F1F5FA' : '#25272B';
  const muted = isDark ? '#B3C2D4' : '#6B7078';
  const title = success ? 'ยืนยันใบหน้าสำเร็จ' : failed ? 'ยังยืนยันใบหน้าไม่ได้' : busy ? 'กำลังตรวจสอบรูปถ่าย' : 'ยืนยันใบหน้าของคุณ';
  const description = success ? 'รูปที่ถ่ายตรงกับรูปโปรไฟล์หลักของคุณ และระบบบันทึกผลการยืนยันแล้ว'
    : failed ? 'อ่านรายละเอียดด้านล่าง แล้วลองถ่ายรูปใหม่ได้เมื่อพร้อม'
      : busy ? (step === 'capturing' ? 'ถ่ายให้เห็นใบหน้าชัดเจน แล้วกดยืนยันรูปเพื่อดำเนินการต่อ' : 'กำลังตรวจสอบรูปที่ถ่ายและเปรียบเทียบกับรูปโปรไฟล์หลัก กรุณารอผลบนหน้านี้')
        : 'ช่วยให้คนที่พบโปรไฟล์มั่นใจว่ารูปที่เห็นเป็นคุณ พร้อมรับเครื่องหมายยืนยันเมื่อผ่านการตรวจสอบ';
  const label = success ? 'เสร็จสิ้น' : failed ? 'ลองถ่ายรูปใหม่' : permissionGranted ? 'เริ่มถ่ายรูปเพื่อยืนยัน' : 'อนุญาตกล้องและเริ่มยืนยัน';
  return <SafeAreaView style={[styles.page, { backgroundColor: canvas }]}>
    <View style={styles.nav}>
      <Text style={[styles.navTitle, { color: ink }]}>การยืนยันใบหน้า</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="ปิดการยืนยันใบหน้า" onPress={onClose} style={[styles.close, { backgroundColor: card }]}>
        <FeatureIcon name="xmark" size={18} color={ink} />
      </Pressable>
    </View>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={[styles.badge, { backgroundColor: isDark ? '#203A59' : '#EEF2F7' }]}>
          {avatarUri && busy ? <Image source={{ uri: avatarUri }} style={styles.avatar} accessibilityLabel="รูปโปรไฟล์หลักที่ใช้ตรวจสอบ" />
            : <FeatureIcon name={success ? 'checkmark.seal.fill' : failed ? 'exclamationmark.triangle.fill' : 'lock.shield.fill'} size={44} color={failed ? '#E27060' : '#2869C7'} />}
          {busy ? <View style={[styles.progressBadge, { backgroundColor: card }]}><ActivityIndicator size="small" color="#2869C7" /></View> : null}
        </View>
        <Text accessibilityRole="header" style={[styles.title, { color: ink }]}>{title}</Text>
        <Text style={[styles.description, { color: muted }]}>{description}</Text>
      </View>
      {!busy && !success && !failed ? <View style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
        <Text style={[styles.sectionTitle, { color: ink }]}>ตรวจสอบอย่างไร</Text>
        {instructions.map(([number, heading, copy]) => <View key={number} style={styles.instruction}>
          <View style={[styles.number, { backgroundColor: isDark ? '#203A59' : '#EEF2F7' }]}><Text style={styles.numberText}>{number}</Text></View>
          <View style={styles.instructionBody}><Text style={[styles.instructionTitle, { color: ink }]}>{heading}</Text><Text style={[styles.copy, { color: muted }]}>{copy}</Text></View>
        </View>)}
      </View> : null}
      {busy ? <View accessibilityLiveRegion="polite" style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
        <Text style={[styles.sectionTitle, { color: ink }]}>{step === 'capturing' ? 'กำลังถ่ายรูป' : 'กำลังเปรียบเทียบรูป'}</Text>
        <Text style={[styles.copy, { color: muted }]}>{step === 'capturing' ? 'มองตรงไปที่กล้องและให้ใบหน้าอยู่ในบริเวณที่มีแสงสม่ำเสมอ' : 'ผลการตรวจสอบจะแสดงบนหน้านี้ หากรูปไม่ชัดเจนหรือยืนยันไม่ผ่าน คุณสามารถลองใหม่ได้'}</Text>
      </View> : null}
      {failed ? <View accessibilityRole="alert" style={[styles.panel, { backgroundColor: card, borderColor: '#E27060' }]}>
        <Text style={[styles.sectionTitle, { color: ink }]}>รายละเอียดการตรวจสอบ</Text>
        <Text style={[styles.copy, { color: muted }]}>{errorMessage || 'ตรวจสอบไม่สำเร็จ กรุณาลองอีกครั้ง'}</Text>
        <Text style={[styles.copy, { color: muted, marginTop: 14 }]}>ตรวจว่ารูปโปรไฟล์หลักเป็นรูปของคุณ เห็นใบหน้าชัดเจน และลองถ่ายใหม่ในที่สว่าง หากเป็นปัญหาการเชื่อมต่อ ให้ลองอีกครั้งเมื่ออินเทอร์เน็ตพร้อม</Text>
      </View> : null}
      {success ? <View style={[styles.panel, { backgroundColor: card, borderColor: colors.line }]}>
        <Text style={[styles.sectionTitle, { color: ink }]}>เครื่องหมายยืนยันของคุณ</Text>
        <Text style={[styles.copy, { color: muted }]}>โปรไฟล์ของคุณจะแสดงเครื่องหมายยืนยันใบหน้า เพื่อบอกว่ารูปโปรไฟล์หลักผ่านการเปรียบเทียบกับรูปที่ถ่ายแล้ว</Text>
      </View> : null}
      <View style={styles.note}>
        <FeatureIcon name="lock.fill" size={17} color={muted} />
        <View style={styles.instructionBody}><Text style={[styles.noteTitle, { color: ink }]}>รูปที่ถ่ายใช้สำหรับการยืนยัน</Text>
          <Text style={[styles.copy, { color: muted }]}>รูปนี้ไม่ถูกเพิ่มเป็นรูปในโปรไฟล์ของคุณ การยืนยันนี้ตรวจสอบความตรงกันของใบหน้า และไม่ได้ยืนยันข้อมูลอื่นในโปรไฟล์</Text></View>
      </View>
    </ScrollView>
    <View style={[styles.actions, { backgroundColor: canvas, borderTopColor: colors.line }]}>
      {busy ? <View style={styles.wait}><ActivityIndicator color="#2869C7" /><Text style={[styles.waitText, { color: ink }]}>{step === 'capturing' ? 'กำลังรอรูปถ่าย' : 'กำลังตรวจสอบ กรุณารอสักครู่'}</Text></View>
        : <Pressable accessibilityRole="button" onPress={success ? onClose : onPrimary} style={({ pressed }) => [styles.primary, { opacity: pressed ? 0.8 : 1 }]}><Text style={styles.primaryText}>{label}</Text></Pressable>}
      {!success ? <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondary}><Text style={[styles.secondaryText, { color: muted }]}>{busy ? 'ยกเลิกและกลับไปโปรไฟล์' : 'ไว้ภายหลัง'}</Text></Pressable> : null}
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: 28 }, nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 12 },
  navTitle: { fontSize: 16, fontWeight: '700' }, close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, width: '100%', maxWidth: 520, alignSelf: 'center', gap: 22 },
  hero: { alignItems: 'center', gap: 14 }, badge: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44 }, progressBadge: { position: 'absolute', right: -3, bottom: 0, padding: 7, borderRadius: 20 },
  title: { fontSize: 25, lineHeight: 34, fontWeight: '800', textAlign: 'center' }, description: { fontSize: 15, lineHeight: 23, textAlign: 'center' },
  panel: { padding: 20, borderWidth: 1, borderRadius: 22, gap: 18 }, sectionTitle: { fontSize: 17, fontWeight: '700' },
  instruction: { flexDirection: 'row', gap: 12 }, instructionBody: { flex: 1 }, number: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
  numberText: { color: '#2869C7', fontWeight: '800', fontSize: 14 }, instructionTitle: { fontSize: 15, lineHeight: 22, fontWeight: '700', marginBottom: 4 }, copy: { fontSize: 14, lineHeight: 22 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, noteTitle: { fontSize: 14, lineHeight: 22, fontWeight: '700', marginBottom: 4 },
  actions: { borderTopWidth: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12 }, primary: { minHeight: 52, borderRadius: 16, backgroundColor: '#2869C7', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 16, lineHeight: 24, fontWeight: '700', textAlign: 'center' }, secondary: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 6 }, secondaryText: { fontSize: 14, lineHeight: 22 },
  wait: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, waitText: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
});
