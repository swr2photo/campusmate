import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppProfile } from '../context/AppContext';
import { IosLikeAvatar } from './iosLike';
import { useTheme } from '../theme';

const AVATAR_SIZE = 24;

export default function ProfileTabIcon({ color, focused }) {
  const { profile } = useAppProfile();
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.ring,
        focused ? { borderColor: color } : styles.ringIdle,
      ]}
    >
      <IosLikeAvatar
        cacheScope={profile?.id}
        cacheVersion={profile?.avatarRevision}
        color={profile?.avatarColor || colors.primarySoft}
        emoji={profile?.avatar}
        size={AVATAR_SIZE}
        uri={profile?.avatarUri}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ring: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 2,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  ringIdle: {
    borderColor: 'transparent',
  },
});
