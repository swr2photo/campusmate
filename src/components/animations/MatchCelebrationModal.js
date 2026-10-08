import Text from '../AppText';
import React from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import LottieViewSafe from './LottieViewSafe';
import { HEART_MATCH_LOTTIE } from './lottieData';
import MotiPulseButton from './MotiPulseButton';
import FeatureIcon from '../FeatureIcon';

/**
 * MatchCelebrationModal
 * "It's a Match!" celebration screen combining Lottie celebration and Moti animated elements.
 */
export default function MatchCelebrationModal({
  visible,
  currentUserPhoto,
  matchedUserPhoto,
  matchedUserName = 'เพื่อนใหม่',
  onStartChat,
  onKeepBrowsing,
  lottieSource = HEART_MATCH_LOTTIE,
}) {
  if (!visible) return null;

  return (
    <Modal
      animationType="fade"
      hardwareAccelerated
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        {/* Background celebration Lottie */}
        <View style={styles.lottieContainer} pointerEvents="none">
          <LottieViewSafe
            source={lottieSource}
            autoPlay
            loop
            style={styles.lottieAnimation}
          />
        </View>

        {/* Content Box */}
        <MotiView
          from={{ opacity: 0, scale: 0.85, translateY: 30 }}
          animate={{ opacity: 1, scale: 1, translateY: 0 }}
          transition={{ type: 'spring', damping: 16, stiffness: 200 }}
          style={styles.card}
        >
          <Text style={styles.title}>It's a Match!</Text>
          <Text style={styles.subtitle}>
            คุณและ <Text style={styles.highlightName}>{matchedUserName}</Text> ถูกใจกันและกัน
          </Text>

          {/* Overlapping Avatars */}
          <View style={styles.avatarsContainer}>
            <MotiView
              from={{ opacity: 0, translateX: -40, rotate: '-10deg' }}
              animate={{ opacity: 1, translateX: 0, rotate: '-6deg' }}
              transition={{ type: 'spring', damping: 14, delay: 150 }}
              style={[styles.avatarWrapper, styles.leftAvatar]}
            >
              {currentUserPhoto ? (
                <Image source={{ uri: currentUserPhoto }} style={styles.avatarImage} />
              ) : (
                <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                  <FeatureIcon name="person.fill" size={36} color="#FFFFFF" />
                </View>
              )}
            </MotiView>

            <MotiView
              from={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', damping: 12, delay: 300 }}
              style={styles.heartBadge}
            >
              <FeatureIcon name="heart.fill" size={24} color="#FF385C" />
            </MotiView>

            <MotiView
              from={{ opacity: 0, translateX: 40, rotate: '10deg' }}
              animate={{ opacity: 1, translateX: 0, rotate: '6deg' }}
              transition={{ type: 'spring', damping: 14, delay: 200 }}
              style={[styles.avatarWrapper, styles.rightAvatar]}
            >
              {matchedUserPhoto ? (
                <Image source={{ uri: matchedUserPhoto }} style={styles.avatarImage} />
              ) : (
                <View style={[styles.avatarImage, styles.avatarPlaceholder]}>
                  <FeatureIcon name="person.fill" size={36} color="#FFFFFF" />
                </View>
              )}
            </MotiView>
          </View>

          {/* Actions */}
          <View style={styles.actionsContainer}>
            <MotiPulseButton
              active
              onPress={onStartChat}
              style={styles.chatButtonContainer}
              accessibilityLabel="เริ่มคุยแชททันที"
            >
              <LinearGradient
                colors={['#FF5252', '#FF1744']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.chatButtonGradient}
              >
                <FeatureIcon name="bubble.left.and.bubble.right.fill" size={20} color="#FFFFFF" />
                <Text style={styles.chatButtonText}>ส่งข้อความทักทาย</Text>
              </LinearGradient>
            </MotiPulseButton>

            <Pressable
              onPress={onKeepBrowsing}
              style={styles.keepBrowsingButton}
              accessibilityLabel="หาเพื่อนต่อ"
            >
              <Text style={styles.keepBrowsingText}>หาเพื่อนต่อ</Text>
            </Pressable>
          </View>
        </MotiView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: 'rgba(11, 13, 20, 0.88)',
    justifyContent: 'center',
    padding: 24,
  },
  lottieContainer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lottieAnimation: {
    height: 380,
    width: 380,
  },
  card: {
    alignItems: 'center',
    backgroundColor: 'rgba(23, 27, 44, 0.95)',
    borderColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 32,
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    width: '100%',
    maxWidth: 360,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.72)',
    fontSize: 15,
    marginBottom: 28,
    textAlign: 'center',
  },
  highlightName: {
    color: '#FF5252',
    fontWeight: '700',
  },
  avatarsContainer: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 120,
    justifyContent: 'center',
    marginBottom: 32,
    position: 'relative',
    width: '100%',
  },
  avatarWrapper: {
    borderColor: '#FFFFFF',
    borderRadius: 55,
    borderWidth: 3,
    elevation: 8,
    height: 110,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    width: 110,
  },
  leftAvatar: {
    marginRight: -16,
    zIndex: 1,
  },
  rightAvatar: {
    marginLeft: -16,
    zIndex: 1,
  },
  avatarImage: {
    height: '100%',
    width: '100%',
  },
  avatarPlaceholder: {
    alignItems: 'center',
    backgroundColor: '#3B4158',
    justifyContent: 'center',
  },
  heartBadge: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    elevation: 10,
    height: 44,
    justifyContent: 'center',
    position: 'absolute',
    shadowColor: '#FF385C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    width: 44,
    zIndex: 10,
  },
  actionsContainer: {
    gap: 12,
    width: '100%',
  },
  chatButtonContainer: {
    borderRadius: 28,
    overflow: 'hidden',
    width: '100%',
  },
  chatButtonGradient: {
    alignItems: 'center',
    borderRadius: 28,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 15,
    width: '100%',
  },
  chatButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  keepBrowsingButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  keepBrowsingText: {
    color: 'rgba(255, 255, 255, 0.65)',
    fontSize: 15,
    fontWeight: '500',
  },
});
