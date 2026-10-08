import React from 'react';
import { Redirect, router } from 'expo-router';
import ProfileScreen from '../src/screens/ProfileScreen';
import { useToast } from '../src/context/ToastContext';
import { useAppActions, useAppProfile } from '../src/context/AppContext';
import { useAuth } from '../src/context/AuthContext';
import { needsCampusEmailMigration } from '../src/utils/campusEmail';
import AppSplashScreen from '../src/components/AppSplashScreen';

export default function SetupRoute() {
  const { showToast } = useToast();
  const { isLoggedIn, user } = useAuth();
  const { profile } = useAppProfile();
  const { saveProfile } = useAppActions();

  if (!isLoggedIn) return <Redirect href="/" />;
  if (needsCampusEmailMigration(user, profile)) return <Redirect href="/verify-campus-email" />;
  if (!profile) return <AppSplashScreen />;

  const handleSave = async (profileData) => {
    await saveProfile({ ...profileData, isNewUser: false });
    showToast('สร้างโปรไฟล์สำเร็จ!');
    router.replace('/home');
  };

  return (
    <ProfileScreen
      onToast={showToast}
      overrideSave={handleSave}
    />
  );
}
