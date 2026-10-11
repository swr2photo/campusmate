import React, { useEffect, useRef, useState } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import ProfileScreen from '../src/screens/ProfileScreen';
import { useToast } from '../src/context/ToastContext';

export default function ProfileRoute() {
  const { showToast } = useToast();
  const params = useLocalSearchParams();
  const closeGuardRef = useRef(null);
  const [activeTab, setActiveTab] = useState(() => {
    if (params?.tab === 'preview') return 'preview';
    return 'edit';
  });

  useEffect(() => {
    if (params?.tab && ['edit', 'preview'].includes(params.tab)) {
      setActiveTab(params.tab);
    }
  }, [params?.tab]);

  const getTitle = () => {
    if (activeTab === 'preview') return 'ตัวอย่างโปรไฟล์';
    return 'แก้ไขโปรไฟล์';
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerBackTitle: 'โปรไฟล์',
          title: getTitle(),
        }}
      />
      <ProfileScreen
        activeTab={activeTab}
        initialSection={params?.section || 'basic'}
        onCloseGuardReady={(handler) => {
          closeGuardRef.current = handler;
        }}
        onClose={() => {
          if (router.canGoBack()) router.back();
          else router.replace('/me');
        }}
        onTabChange={setActiveTab}
        onToast={showToast}
        tabs={['edit', 'preview']}
      />
    </>
  );
}
