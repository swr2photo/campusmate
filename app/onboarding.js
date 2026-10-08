import React from 'react';
import { router } from 'expo-router';
import OnboardingScreen from '../src/screens/OnboardingScreen';

export default function OnboardingGuide() {
  return <OnboardingScreen onComplete={() => router.back()} />;
}
