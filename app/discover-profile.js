import React from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import DiscoverProfileScreen from '../src/screens/DiscoverProfileScreen';
import { useToast } from '../src/context/ToastContext';

export default function DiscoverProfileRoute() {
  const params = useLocalSearchParams();
  const rawId = params?.profileId || params?.id;
  const normalizedProfileId = Array.isArray(rawId) ? rawId[0] : rawId;
  const isExplicitViewOnly = params?.viewOnly === 'true' || params?.mode === 'view';
  const { showToast } = useToast();
  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <DiscoverProfileScreen
      isViewOnlyParam={isExplicitViewOnly}
      onClose={close}
      onToast={showToast}
      profileId={normalizedProfileId}
    />
  );
}
