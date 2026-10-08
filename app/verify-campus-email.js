import React from 'react';
import { Redirect } from 'expo-router';
import CampusEmailMigrationScreen from '../src/screens/CampusEmailMigrationScreen';
import { useAuth } from '../src/context/AuthContext';
import { useAppProfile } from '../src/context/AppContext';
import AppSplashScreen from '../src/components/AppSplashScreen';
import { getLoggedInRoute } from '../src/utils/campusEmail';

export default function VerifyCampusEmailRoute() {
  const { isLoggedIn, user } = useAuth();
  const { profile } = useAppProfile();

  if (!isLoggedIn) return <Redirect href="/" />;

  const destination = getLoggedInRoute(user, profile);
  if (!destination) return <AppSplashScreen />;
  if (destination !== '/verify-campus-email') return <Redirect href={destination} />;

  return <CampusEmailMigrationScreen />;
}
