import React from 'react';
import { router } from 'expo-router';
import DashboardScreen from '../../../src/screens/DashboardScreen';

const ROUTES = {
  home: '/home',
  discover: '/discover',
  chat: '/chat',
  meetup: '/meetup',
  appointments: '/appointments',
  likes: '/likes',
};

export default function HomeRoute() {
  return (
    <DashboardScreen
      onNavigate={(destination) => router.navigate(ROUTES[destination] || '/home')}
      onOpenProfile={() => router.push('/profile')}
    />
  );
}
