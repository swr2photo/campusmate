import React from 'react';
import MeetupScreen from '../../src/screens/MeetupScreen';
import { useToast } from '../../src/context/ToastContext';

export default function MeetupRoute() {
  const { showToast } = useToast();
  return <MeetupScreen onToast={showToast} />;
}

