import React from 'react';
import { router } from 'expo-router';
import HomeScreen from '../../src/screens/HomeScreen';
import { useToast } from '../../src/context/ToastContext';

export default function DiscoverRoute() {
  const { showToast } = useToast();
  return <HomeScreen onOpenLikes={() => router.push('/likes')} onToast={showToast} />;
}
