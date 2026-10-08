import React from 'react';
import { router } from 'expo-router';
import CommunityGuidelinesScreen from '../src/screens/CommunityGuidelinesScreen';

export default function CommunityGuidelinesRoute() {
  return <CommunityGuidelinesScreen onClose={() => router.back()} />;
}
