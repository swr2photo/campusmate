import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ACTIVITY_CATEGORIES } from '../data/mockData';
import { useApp } from '../context/AppContext';
import { Avatar, Card, Chip, OutlineButton, PrimaryButton, SectionTitle } from '../components/ui';
import { colors, radius, spacing, type } from '../theme';

export default function ProfileScreen({ onLogout, onToast }) {
  const { profile, saveProfile } = useApp();
  const [name, setName] = useState(profile.name);
  const [faculty, setFaculty] = useState(profile.faculty);
  const [year, setYear] = useState(profile.year);
  const [pace, setPace] = useState(profile.pace);
  const [availability, setAvailability] = useState(profile.availability);
  const [bio, setBio] = useState(profile.bio);
  const [interests, setInterests] = useState(profile.interests);

  const toggleInterest = (id) => {
    setInterests((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  const handleSave = () => {
    saveProfile({ name, faculty, year, pace, availability, bio, interests });
    onToast?.('บันทึกโปรไฟล์เรียบร้อยแล้ว');
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={styles.eyebrow}>CampusMate / PROFILE</Text>
        <Text style={styles.title}>โปรไฟล์ของฉัน</Text>
        <Text style={styles.subtitle}>ข้อมูลนี้ช่วยให้ระบบแนะนำเพื่อนที่เข้ากับคุณมากขึ้น</Text>

        <Card style={styles.identityCard}>
          <Avatar color={profile.avatarColor} emoji={profile.avatar} online size={86} />
          <View style={styles.identityCopy}>
            <Text style={styles.identityName}>{name}</Text>
            <Text style={styles.identityEmail}>{profile.email}</Text>
            <View style={styles.verifiedPill}><Text style={styles.verifiedText}>✓ ยืนยันด้วย Google แล้ว</Text></View>
          </View>
          <Pressable onPress={() => onToast?.('การเปลี่ยนรูปโปรไฟล์จะเชื่อมกับ Firebase Storage ในขั้นถัดไป', 'info')} style={styles.cameraButton}>
            <Text style={styles.cameraText}>⌕</Text>
          </Pressable>
        </Card>

        <Card style={styles.formCard}>
          <SectionTitle title="ข้อมูลพื้นฐาน" subtitle="ข้อมูลที่ใช้แสดงบนการ์ดจับคู่" />
          <Field label="ชื่อ-นามสกุล (ชื่อเล่น)" value={name} onChangeText={setName} />
          <View style={styles.twoColumns}>
            <View style={styles.column}><Field label="คณะ" value={faculty} onChangeText={setFaculty} /></View>
            <View style={styles.column}><Field label="ชั้นปี" value={year} onChangeText={setYear} /></View>
          </View>

          <View style={styles.formSectionSpacing}>
            <SectionTitle title="กิจกรรมและไลฟ์สไตล์" subtitle="เลือกได้มากกว่าหนึ่งกิจกรรม" />
          </View>
          <View style={styles.interestRow}>
            {ACTIVITY_CATEGORIES.filter((category) => category.id !== 'all').map((category) => (
              <Chip
                key={category.id}
                active={interests.includes(category.id)}
                color={category.color}
                icon={category.icon}
                label={category.label}
                onPress={() => toggleInterest(category.id)}
                style={styles.interestChip}
              />
            ))}
          </View>

          <Field label="ระดับความเร็ว / ทักษะที่สนใจ" value={pace} onChangeText={setPace} placeholder="เช่น Pace 6:00 - 6:30 นาที/กม." />
          <Field label="ช่วงเวลาว่างสะดวก" value={availability} onChangeText={setAvailability} placeholder="เช่น 17:00 - 19:30 น." />
          <Field label="คำแนะนำตัวสั้น ๆ" value={bio} onChangeText={setBio} multiline inputStyle={styles.bioInput} placeholder="เล่าให้เพื่อนรู้จักคุณมากขึ้น" />
          <PrimaryButton label="บันทึกข้อมูลโปรไฟล์" icon="✓" onPress={handleSave} style={styles.saveButton} />
        </Card>

        <Card style={styles.securityCard}>
          <View style={styles.securityIcon}><Text style={styles.securityIconText}>🔒</Text></View>
          <View style={styles.securityCopy}>
            <Text style={styles.securityTitle}>ความเป็นส่วนตัวของคุณสำคัญ</Text>
            <Text style={styles.securityText}>เราจะแสดงข้อมูลโปรไฟล์กับผู้ใช้ที่จับคู่กันสำเร็จเท่านั้น</Text>
          </View>
        </Card>

        <OutlineButton danger icon="↪" label="ออกจากระบบ" onPress={onLogout} style={styles.logoutButton} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, value, onChangeText, placeholder, multiline = false, inputStyle }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        style={[styles.input, multiline && styles.multilineInput, inputStyle]}
        textAlignVertical={multiline ? 'top' : 'center'}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  eyebrow: { color: colors.primary, fontSize: type.micro, fontWeight: '900', letterSpacing: 1.3, marginBottom: spacing.sm },
  title: { color: colors.ink, fontSize: 25, fontWeight: '900' },
  subtitle: { color: colors.inkMuted, fontSize: type.caption, lineHeight: 18, marginTop: 5 },
  identityCard: { alignItems: 'center', flexDirection: 'row', marginTop: spacing.xl, padding: spacing.lg },
  identityCopy: { flex: 1, marginLeft: spacing.md },
  identityName: { color: colors.ink, fontSize: type.section, fontWeight: '900' },
  identityEmail: { color: colors.inkMuted, fontSize: type.micro, marginTop: 3 },
  verifiedPill: { alignSelf: 'flex-start', backgroundColor: colors.greenSoft, borderRadius: radius.pill, marginTop: spacing.sm, paddingHorizontal: 8, paddingVertical: 5 },
  verifiedText: { color: colors.green, fontSize: 10, fontWeight: '900' },
  cameraButton: { alignItems: 'center', backgroundColor: colors.primarySoft, borderRadius: 17, height: 34, justifyContent: 'center', width: 34 },
  cameraText: { color: colors.primary, fontSize: 22, fontWeight: '900' },
  formCard: { marginTop: spacing.lg, padding: spacing.xl },
  twoColumns: { flexDirection: 'row', justifyContent: 'space-between' },
  column: { width: '48%' },
  formSectionSpacing: { marginTop: spacing.md },
  interestRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md },
  interestChip: { marginBottom: spacing.sm, marginRight: spacing.sm, minHeight: 34, paddingHorizontal: 10 },
  field: { marginBottom: spacing.md },
  label: { color: colors.inkMuted, fontSize: type.caption, fontWeight: '800', marginBottom: 6 },
  input: { backgroundColor: colors.canvas, borderColor: colors.line, borderRadius: radius.sm, borderWidth: 1, color: colors.ink, fontSize: type.body, minHeight: 46, paddingHorizontal: spacing.md, paddingVertical: 10 },
  multilineInput: { minHeight: 90 },
  bioInput: { lineHeight: 20 },
  saveButton: { marginTop: spacing.sm },
  securityCard: { alignItems: 'center', backgroundColor: colors.greenSoft, borderColor: '#CDEFE0', flexDirection: 'row', marginTop: spacing.lg, padding: spacing.lg },
  securityIcon: { alignItems: 'center', backgroundColor: colors.card, borderRadius: 20, height: 40, justifyContent: 'center', marginRight: spacing.md, width: 40 },
  securityIconText: { fontSize: 18 },
  securityCopy: { flex: 1 },
  securityTitle: { color: colors.green, fontSize: type.caption, fontWeight: '900' },
  securityText: { color: '#4B806D', fontSize: type.micro, lineHeight: 16, marginTop: 3 },
  logoutButton: { marginTop: spacing.lg },
});

