import React from 'react';
import { Stack } from 'expo-router';
import PSUCampusMapScreen from '../src/screens/PSUCampusMapScreen';

export default function CampusMapRoute() {
  return <>
    <Stack.Screen options={{ headerShown: false }} />
    <PSUCampusMapScreen />
  </>;
}
