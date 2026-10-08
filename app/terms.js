import React from 'react';
import { router } from 'expo-router';
import TermsOfServiceScreen from '../src/screens/TermsOfServiceScreen';

export default function TermsRoute() {
  return <TermsOfServiceScreen onClose={() => router.back()} />;
}
