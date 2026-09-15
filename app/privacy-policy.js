import React from 'react';
import { router } from 'expo-router';
import PrivacyPolicyScreen from '../src/screens/PrivacyPolicyScreen';

export default function PrivacyPolicyRoute() {
  return <PrivacyPolicyScreen onClose={() => router.back()} />;
}
