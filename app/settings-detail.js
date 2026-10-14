import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Text, { AppTextInput as TextInput } from '../src/components/AppText';
import {
  SettingsDescription,
  SettingsFrame,
  SettingsGroup,
  SettingsRow,
  SettingsSection,
  SettingsToggle,
  useSettingsPalette,
} from '../src/components/settings-primitives';
import { usePreferences } from '../src/context/PreferencesContext';
import { useToast } from '../src/context/ToastContext';

const SECTION_CONFIGS = {
  activity: {
    title: 'สถานะการใช้งาน',
    description: 'จัดการการแสดงสถานะออนไลน์และกิจกรรมล่าสุดของคุณในระบบ',
  },
  autoplay: {
    title: 'เล่นวิดีโออัตโนมัติ',
    description: 'เลือกการเล่นวิดีโอแนะนำตัวและวิดีโอโปรไฟล์โดยอัตโนมัติเมื่อเลื่อนผ่าน',
  },
  username: {
    title: 'ชื่อผู้ใช้สาธารณะ',
    description: 'ชื่อผู้ใช้สำหรับแชร์ลิงก์โปรไฟล์และค้นหาเพื่อนในระบบ',
  },
  email: {
    title: 'การแจ้งเตือนทางอีเมล',
    description: 'เลือกรับข่าวสารและสรุปกิจกรรมประจำสัปดาห์ทางอีเมลมหาวิทยาลัย',
  },
  push: {
    title: 'การแจ้งเตือนแบบ Push',
    description: 'รับการแจ้งเตือนทันทีเมื่อมีข้อความใหม่ การจับคู่ หรือนัดหมายกิจกรรม',
  },
  sms: {
    title: 'การแจ้งเตือนทาง SMS',
    description: 'รับรหัส OTP และการแจ้งเตือนความปลอดภัยของบัญชีผ่านข้อความมือถือ',
  },
  team: {
    title: 'Team CampusMate',
    description: 'รับข่าวสารอัปเดตฟีเจอร์ใหม่ กิจกรรมใน ม.อ. และสิทธิประโยชน์พิเศษ',
  },
  'safety-tips': {
    title: 'เคล็ดลับความปลอดภัย',
    description: 'แนวทางการนัดพบเพื่อนใหม่อย่างปลอดภัยในพื้นที่สาธารณะของมหาวิทยาลัย',
  },
  safety: {
    title: 'ศูนย์กำกับดูแลความปลอดภัย',
    description: 'รายงานพฤติกรรมที่ไม่เหมาะสม จัดการบล็อก และความช่วยเหลือฉุกเฉิน',
  },
  cookies: {
    title: 'นโยบายคุกกี้และข้อมูล',
    description: 'ข้อมูลเกี่ยวกับการจัดเก็บข้อมูลการตั้งค่าและแคชบนอุปกรณ์ของคุณ',
  },
};

export default function SettingsDetailRoute() {
  const { section = 'activity' } = useLocalSearchParams();
  const sectionKey = String(section);
  const config = SECTION_CONFIGS[sectionKey] || {
    title: 'การตั้งค่า',
    description: 'จัดการการตั้งค่าระบบของคุณ',
  };

  const { preferences, updatePreferences } = usePreferences();
  const { showToast } = useToast();
  const palette = useSettingsPalette();

  const [usernameInput, setUsernameInput] = useState(preferences.publicUsername || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSaveUsername = async () => {
    if (!usernameInput.trim()) return;
    setIsSaving(true);
    try {
      await updatePreferences({ publicUsername: usernameInput.trim() });
      showToast?.('บันทึกชื่อผู้ใช้เรียบร้อยแล้ว');
      router.back();
    } catch {
      showToast?.('ไม่สามารถบันทึกชื่อผู้ใช้ได้');
    } finally {
      setIsSaving(false);
    }
  };

  const renderContent = () => {
    switch (sectionKey) {
      case 'username':
        return (
          <SettingsSection title="ตั้งชื่อผู้ใช้">
            <SettingsGroup>
              <View style={styles.inputContainer}>
                <TextInput
                  value={usernameInput}
                  onChangeText={setUsernameInput}
                  placeholder="เช่น somchai_psu"
                  placeholderTextColor={palette.muted}
                  style={[styles.input, { color: palette.text }]}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              <SettingsRow
                label="บันทึกชื่อผู้ใช้"
                onPress={handleSaveUsername}
                busy={isSaving}
                last
              />
            </SettingsGroup>
            <SettingsDescription>
              ชื่อผู้ใช้นี้จะใช้สำหรับระบุตัวตนในลิงก์โปรไฟล์และค้นหาใน ม.อ.
            </SettingsDescription>
          </SettingsSection>
        );

      case 'activity':
        return (
          <SettingsSection title="การแสดงสถานะ">
            <SettingsGroup>
              <SettingsToggle
                label="แสดงสถานะออนไลน์"
                value={preferences.showOnlineStatus !== false}
                onValueChange={(val) => updatePreferences({ showOnlineStatus: val })}
                last
              />
            </SettingsGroup>
            <SettingsDescription>
              เมื่อเปิดใช้งาน เพื่อนร่วมมหาวิทยาลัยจะเห็นว่าคุณกำลังใช้งานอยู่ในขณะนี้
            </SettingsDescription>
          </SettingsSection>
        );

      case 'autoplay':
        return (
          <SettingsSection title="การเล่นวิดีโอ">
            <SettingsGroup>
              <SettingsToggle
                label="เล่นอัตโนมัติเมื่อใช้ Wi-Fi"
                value={preferences.autoplayWifiOnly !== false}
                onValueChange={(val) => updatePreferences({ autoplayWifiOnly: val })}
                last={false}
              />
              <SettingsToggle
                label="ปิดเสียงวิดีโอเริ่มต้น"
                value={preferences.muteAutoplayVideo !== false}
                onValueChange={(val) => updatePreferences({ muteAutoplayVideo: val })}
                last
              />
            </SettingsGroup>
            <SettingsDescription>
              ช่วยประหยัดอินเทอร์เน็ตมือถือและป้องกันเสียงดังรบกวนในห้องเรียนหรือห้องสมุด
            </SettingsDescription>
          </SettingsSection>
        );

      case 'email':
      case 'push':
      case 'sms':
      case 'team':
        return (
          <SettingsSection title="ตัวเลือกการแจ้งเตือน">
            <SettingsGroup>
              <SettingsToggle
                label="เปิดรับการแจ้งเตือน"
                value={preferences[`notify_${sectionKey}`] !== false}
                onValueChange={(val) => updatePreferences({ [`notify_${sectionKey}`]: val })}
                last
              />
            </SettingsGroup>
            <SettingsDescription>
              {config.description}
            </SettingsDescription>
          </SettingsSection>
        );

      case 'safety-tips':
      case 'safety':
        return (
          <SettingsSection title="แนวทางปฏิบัติเพื่อความปลอดภัย">
            <SettingsGroup>
              <SettingsRow
                label="1. นัดพบในสถานที่เปิดเผย"
                description="เช่น โรงอาหาร, หอสมุดจอห์น เอฟ เคนเนดี้ หรือลานกิจกรรม ม.อ."
                last={false}
              />
              <SettingsRow
                label="2. แจ้งเพื่อนสนิททราบ"
                description="บอกเพื่อนหรือรูมเมทก่อนออกไปทำกิจกรรมกับเพื่อนใหม่เสมอ"
                last={false}
              />
              <SettingsRow
                label="3. ปรึกษาหรือแจ้งเหตุฉุกเฉิน"
                description="ติดต่อหน่วยรักษาความปลอดภัย ม.อ. หรือทีมงานได้ตลอด 24 ชั่วโมง"
                last
              />
            </SettingsGroup>
          </SettingsSection>
        );

      default:
        return (
          <SettingsSection title={config.title}>
            <SettingsGroup>
              <SettingsRow
                label="เวอร์ชันนโยบาย"
                value="2026.1"
                last
              />
            </SettingsGroup>
            <SettingsDescription>{config.description}</SettingsDescription>
          </SettingsSection>
        );
    }
  };

  return (
    <SettingsFrame
      title={config.title}
      detail
      onClose={() => router.back()}
    >
      {renderContent()}
    </SettingsFrame>
  );
}

const styles = StyleSheet.create({
  inputContainer: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#302C28',
  },
  input: {
    fontSize: 17,
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
});
