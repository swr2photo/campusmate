import React from 'react';
import { router } from 'expo-router';
import LegalNoticeScreen from '../src/screens/LegalNoticeScreen';

export default function LegalNoticeRoute() {
  return <LegalNoticeScreen onClose={() => router.back()} />;
}
