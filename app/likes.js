import React from 'react';
import { router } from 'expo-router';
import { SafeAreaView, StyleSheet } from 'react-native';
import LikesScreen from '../src/screens/LikesScreen';
import { useToast } from '../src/context/ToastContext';
import { colors, useTheme } from '../src/theme';

export default function LikesRoute() {
  const { showToast } = useToast();
  const { colors } = useTheme();
  const styles = getStyles(colors);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <LikesScreen
        onClose={close}
        onOpenChat={(chatId) => {
          if (chatId) {
            router.replace({ pathname: '/chat-room', params: { chatId } });
          } else {
            router.replace('/(tabs)/chat');
          }
        }}
        onToast={showToast}
      />
    </SafeAreaView>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { backgroundColor: colors.canvas, flex: 1 },
});
