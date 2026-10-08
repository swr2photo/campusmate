import { Button, Text } from '../components/NativeTypography';
import StorysetStateView from '../components/StorysetStateView';
import { font } from '../components/brandFont';
import { useNativePalette } from '../theme';
import { useColorScheme, View } from 'react-native';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useCallback, useRef, useState } from 'react';
import { useRemoteImage } from '../utils/useRemoteImage';
import { ContentUnavailableView, RNHostView, Host, HStack, Image, LazyVStack, ZStack, ScrollView, Spacer, VStack } from '@expo/ui/swift-ui';
import { background, buttonBorderShape, buttonStyle, controlSize, disabled, foregroundStyle, frame, glassEffect, labelStyle, lineLimit, padding, scrollIndicators, shadow, shapes, symbolEffect, tint, resizable, aspectRatio, clipped, clipShape } from '@expo/ui/swift-ui/modifiers';
import { useAppActions, useAppFeed } from '../context/AppContext';
import { useConfirm } from '../context/ConfirmContext';
import { router } from 'expo-router';
import { useEntitlement } from '../context/MembershipContext';
import { FEATURE_INCOMING_LIKE_PROFILES } from '../data/plans';
import { formatAvailabilitySlots } from '../utils/formatters';

const usePalette = useNativePalette;

const cardShape = shapes.roundedRectangle({ cornerRadius: 24, roundedCornerStyle: 'continuous' });
const insetShape = shapes.roundedRectangle({ cornerRadius: 16, roundedCornerStyle: 'continuous' });

export default function LikesScreen({ onClose, onOpenChat, onToast }) {
  const palette = usePalette();
  const colorScheme = useColorScheme();
  const { acceptedIncomingLikes, pendingIncomingLikes, pendingIncomingLikeCount, hasMorePendingLikes, isLoadingMorePendingLikes } = useAppFeed();
  const incomingCount = pendingIncomingLikeCount ?? pendingIncomingLikes.length;
  const likesEntitlement = useEntitlement(FEATURE_INCOMING_LIKE_PROFILES);
  const locked = likesEntitlement.locked;
  const { ensureConversation, respondToLike, loadMoreIncomingLikes } = useAppActions();
  const { confirm } = useConfirm();
  const [activeTab, setActiveTab] = useState('pending');
  const [processingId, setProcessingId] = useState(null);
  const processingIdRef = useRef(null);

  const beginProcessing = useCallback((id) => {
    if (processingIdRef.current) return false;
    processingIdRef.current = id;
    setProcessingId(id);
    return true;
  }, []);

  const endProcessing = useCallback(() => {
    processingIdRef.current = null;
    setProcessingId(null);
  }, []);

  const visibleLikes = activeTab === 'pending'
    ? pendingIncomingLikes
    : acceptedIncomingLikes;

  const handleResponse = useCallback(async (like, response) => {
    if (!beginProcessing(like.id)) return;

    try {
      const conversationId = await respondToLike(like, response);
      if (response === 'accept') {
        const targetConversationId = typeof conversationId === 'string'
          ? conversationId
          : await ensureConversation(like);
        onToast?.(`จับคู่กับ ${like.name} แล้ว เริ่มแชตได้เลย`, 'success');
        onOpenChat?.(targetConversationId);
      } else {
        onToast?.('นำคำขอนี้ออกจากรายการแล้ว', 'info');
      }
    } catch (error) {
      console.error('[LikesScreen.ios] handleResponse error:', error);
      onToast?.('ยังดำเนินการไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      endProcessing();
    }
  }, [beginProcessing, endProcessing, ensureConversation, onOpenChat, onToast, respondToLike]);

  const handleAccept = useCallback((like) => handleResponse(like, 'accept'), [handleResponse]);
  const handleReject = useCallback((like) => handleResponse(like, 'reject'), [handleResponse]);

  const handleRemoveMatch = useCallback(async (like) => {
    const ok = await confirm({
      title: 'ยืนยันการยกเลิกจับคู่',
      body: `ต้องการยกเลิกการจับคู่กับ ${like.name} หรือไม่?`,
      cancelLabel: 'ไม่ยกเลิก',
      confirmLabel: 'ยืนยัน',
      icon: 'heart.slash',
    });
    if (!ok) return;
    if (!beginProcessing(like.id)) return;
    try {
      await respondToLike(like, 'reject');
      onToast?.(`ยกเลิกการจับคู่กับ ${like.name} แล้ว`, 'info');
    } catch (error) {
      console.error('[LikesScreen.ios] handleRemoveMatch error:', error);
      onToast?.('ยังยกเลิกไม่สำเร็จ ลองใหม่อีกครั้ง', 'info');
    } finally {
      endProcessing();
    }
  }, [beginProcessing, confirm, endProcessing, onToast, respondToLike]);

  const handleOpenChat = useCallback(async (like) => {
    if (!beginProcessing(like.id)) return;
    try {
      const conversationId = await ensureConversation(like);
      onOpenChat?.(conversationId);
    } catch (error) {
      console.error('[LikesScreen.ios] handleOpenChat error:', error);
      onToast?.('ยังเปิดห้องแชตไม่ได้ กรุณาลองใหม่อีกครั้ง', 'info');
    } finally {
      endProcessing();
    }
  }, [beginProcessing, endProcessing, ensureConversation, onOpenChat, onToast]);

  const blurIntensity = colorScheme === 'dark' ? 30 : 40;

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <MaskedView
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 68, zIndex: 10 }}
        maskElement={
          <LinearGradient colors={['#FFFFFF', '#FFFFFF00']} style={{ flex: 1 }} />
        }
      >
        <BlurView intensity={blurIntensity} tint={colorScheme} style={{ flex: 1 }} />
      </MaskedView>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }} pointerEvents="box-none">
        <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ width: '100%', height: 68 }}>
          <VStack modifiers={[padding({ top: 0, bottom: 15, horizontal: 20 }), frame({ maxWidth: Infinity, alignment: 'topLeading' })]}>
            <Header onClose={onClose} />
          </VStack>
        </Host>
      </View>
      <Host colorScheme={colorScheme} seedColor={palette.coral} style={{ flex: 1 }}>
        <ScrollView showsIndicators={false} modifiers={[scrollIndicators('never', 'vertical')]}>
          <LazyVStack
            alignment="leading"
            spacing={16}
            modifiers={[
              padding({ top: 68, bottom: 32, horizontal: 20 }),
              frame({ maxWidth: Infinity, alignment: 'topLeading' }),
            ]}
          >
          <Summary
            acceptedCount={acceptedIncomingLikes.length}
            incomingCount={incomingCount}
            tab={activeTab}
          />
          <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
            <TabButton
              active={activeTab === 'pending'}
              count={incomingCount}
              label="ถูกใจคุณ"
              onPress={() => setActiveTab('pending')}
              systemImage="heart.fill"
            />
            <TabButton
              active={activeTab === 'accepted'}
              count={acceptedIncomingLikes.length}
              label="จับคู่แล้ว"
              onPress={() => setActiveTab('accepted')}
              systemImage="person.2.fill"
            />
          </HStack>

          {locked && activeTab === 'pending' ? <VStack spacing={14} modifiers={[padding({ vertical: 30, horizontal: 20 }), frame({ maxWidth: Infinity }), background(palette.surface, cardShape)]}>
            <Image systemName="lock.fill" size={32} color={palette.violet} />
            <Text modifiers={[font({ textStyle: 'headline' }), foregroundStyle(palette.text)]}>มี {incomingCount} คนกดใจคุณ</Text>
            <Text modifiers={[foregroundStyle(palette.secondary)]}>CampusMate Plus ดูว่าใครกดใจคุณได้</Text>
            <Button label="ดู CampusMate Plus" onPress={() => router.push('/membership')} modifiers={[buttonStyle('borderedProminent'), tint(palette.blue)]} />
          </VStack> : visibleLikes.length === 0 ? (
            <RNHostView matchContents>
              <StorysetStateView image={activeTab === 'accepted' ? require('../../assets/mascot/likes-matched.png') : undefined}
                title={activeTab === 'pending' ? 'ยังไม่มีคนกดใจใหม่' : 'ยังไม่มีคู่ที่จับคู่แล้ว'}
                description={activeTab === 'pending' ? 'เมื่อมีเพื่อนสนใจคุณ รายการจะแสดงที่นี่' : 'คนที่คุณรับเป็นเพื่อนแล้วจะแสดงที่นี่ เริ่มทักทายกันได้เลย'}
                actionLabel="ค้นหาเพื่อนใหม่" onAction={() => router.navigate('/home')} />
            </RNHostView>
          ) : (
            visibleLikes.map((like) => (
              <LikeCard
                accepted={activeTab === 'accepted'}
                key={like.id}
                like={like}
                onAccept={handleAccept}
                onOpenChat={handleOpenChat}
                onRemove={handleRemoveMatch}
                onReject={handleReject}
                processing={processingId === like.id}
              />
            ))
          )}

          {activeTab === 'pending' && !locked && hasMorePendingLikes ? <Button
            label={isLoadingMorePendingLikes ? 'กำลังโหลด…' : 'ดูคนที่กดใจเพิ่มเติม'} onPress={loadMoreIncomingLikes}
            modifiers={[disabled(isLoadingMorePendingLikes), buttonStyle('bordered'), tint(palette.blue)]} /> : null}
          <HStack
            spacing={8}
            modifiers={[
              padding({ top: 8, horizontal: 8 }),
              frame({ maxWidth: Infinity, alignment: 'center' }),
            ]}
          >
            <Image systemName="lock.shield.fill" size={14} color={palette.tertiary} />
            <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(palette.tertiary)]}>
              ข้อมูลของคุณได้รับการเข้ารหัสความปลอดภัย
            </Text>
          </HStack>
        </LazyVStack>
        </ScrollView>
      </Host>
    </View>
  );
}

function Header({ onClose }) {
  const palette = usePalette();
  return (
    <HStack alignment="center" spacing={12} modifiers={[frame({ maxWidth: Infinity })]}>
      {onClose ? (
        <Button
          label="ย้อนกลับ"
          onPress={onClose}
          systemImage="chevron.left"
          modifiers={[
            buttonStyle('glass'),
            buttonBorderShape('circle'),
            controlSize('large'),
            labelStyle('iconOnly'),
          ]}
        />
      ) : null}
      <VStack alignment="leading" spacing={4}>
        <Text
          modifiers={[
            font({ textStyle: 'largeTitle', weight: 'bold', design: 'rounded' }),
            foregroundStyle(palette.text),
          ]}
        >
          ถูกใจ
        </Text>
      </VStack>
      <Spacer />
    </HStack>
  );
}

function Summary({ acceptedCount, incomingCount, tab }) {
  const palette = usePalette();
  const title = tab === 'pending'
    ? (incomingCount ? `มี ${incomingCount} คนรอคำตอบจากคุณ` : 'ไม่มีคำขอใหม่ในตอนนี้')
    : (acceptedCount ? `จับคู่สำเร็จแล้ว ${acceptedCount} คน` : 'ยังไม่มีคู่ที่จับคู่แล้ว');

  const subtitle = tab === 'pending'
    ? 'การปฏิเสธจะไม่ส่งการแจ้งเตือนไปให้อีกฝ่าย'
    : 'เริ่มส่งข้อความหรือชวนไปทำกิจกรรมร่วมกันได้เลย';

  const iconName = 'heart.circle.fill';

  return (
    <HStack
      spacing={14}
      modifiers={[
        padding({ all: 16 }),
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.coralSoft, cardShape),
      ]}
    >
      <Image systemName={iconName} size={38} color={palette.coral} />
      <VStack alignment="leading" spacing={4}>
        <Text
          modifiers={[
            font({ textStyle: 'headline', weight: 'bold', design: 'rounded' }),
            foregroundStyle(palette.text),
          ]}
        >
          {title}
        </Text>
        <Text
          modifiers={[
            font({ textStyle: 'caption', weight: 'medium' }),
            foregroundStyle(palette.secondary),
            lineLimit(2),
          ]}
        >
          {subtitle}
        </Text>
      </VStack>
    </HStack>
  );
}

function TabButton({ active, count, label, onPress, systemImage }) {
  const palette = usePalette();
  return (
    <Button
      onPress={onPress}
      modifiers={[
        buttonStyle(active ? 'glassProminent' : 'glass'),
        buttonBorderShape('capsule'),
        controlSize('small'),
        tint(active ? palette.coral : palette.surfaceRaised),
        frame({ maxWidth: Infinity }),
      ]}
    >
      <HStack spacing={7}>
        <Image systemName={systemImage} size={14} color={active ? '#FFFFFF' : palette.text} />
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'semibold' }), foregroundStyle(active ? '#FFFFFF' : palette.text)]}>
          {label}{count > 0 ? `  ${count}` : ''}
        </Text>
      </HStack>
    </Button>
  );
}


const LikeCard = React.memo(function LikeCard({ accepted, like, onAccept, onOpenChat, onReject, onRemove, processing }) {
  const palette = usePalette();
  const imageUri = useRemoteImage(like.avatarUri, like.avatarRevision, like.id);
  const handleAccept = useCallback(() => onAccept?.(like), [onAccept, like]);
  const handleOpenChat = useCallback(() => onOpenChat?.(like), [onOpenChat, like]);
  const handleReject = useCallback(() => onReject?.(like), [onReject, like]);
  const handleRemove = useCallback(() => onRemove?.(like), [onRemove, like]);
  return (
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[
        frame({ maxWidth: Infinity, alignment: 'leading' }),
        background(palette.surface, cardShape),
        shadow({ radius: 18, y: 8, color: 'rgba(0,0,0,0.20)' }),
        clipShape('roundedRectangle', 24),
      ]}
    >
      <ZStack alignment="bottomLeading" modifiers={[frame({ height: 350, maxWidth: Infinity }), background(like.avatarColor || palette.surfaceRaised)]}>
        {imageUri ? (
          <Image
            uiImage={imageUri}
            modifiers={[
              resizable(),
              aspectRatio({ contentMode: 'fill' }),
              frame({ height: 350, maxWidth: Infinity }),
              clipped()
            ]}
          />
        ) : (
          <Image
            systemName="person.crop.circle.fill"
            size={60}
            color={palette.text}
            modifiers={[frame({ height: 350, maxWidth: Infinity })]}
          />
        )}
        <LinearGradient
          colors={['#00000000', '#000000BB']}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 }}
        />
        <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 18 }), frame({ maxWidth: Infinity })]}>
          <Text
            modifiers={[
              font({ textStyle: 'title1', weight: 'heavy' }),
              foregroundStyle('#FFFFFF'),
            ]}
          >
            {like.name}, {like.age || '?'}
          </Text>
          <Text
            modifiers={[
              font({ textStyle: 'subheadline', weight: 'medium' }),
              foregroundStyle('#FFFFFF'),
            ]}
          >
            {like.faculty}
          </Text>
        </VStack>
      </ZStack>

      <VStack spacing={14} modifiers={[padding({ all: 18 }), frame({ maxWidth: Infinity })]}>
        <HStack spacing={10}>
          <Image systemName="quote.bubble.fill" size={17} color={palette.coral} />
          <Text
            modifiers={[
              font({ textStyle: 'caption', weight: 'medium' }),
              foregroundStyle(palette.secondary),
            ]}
          >
            {like.likeMessage || "สนใจอยากทำความรู้จัก"}
          </Text>
        </HStack>

        <ScrollView axes="horizontal" showsIndicators={false} modifiers={[scrollIndicators('never', 'horizontal')]}>
          <HStack spacing={6}>
            {like.year ? (
              <HStack spacing={4} modifiers={[padding({ horizontal: 10, vertical: 6 }), background(palette.surfaceRaised, shapes.capsule())]}>
                <Image systemName="graduationcap.fill" size={12} color={palette.tertiary} />
                <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
                  {like.year}
                </Text>
              </HStack>
            ) : null}
            {like.activityLabel ? (
              <HStack spacing={4} modifiers={[padding({ horizontal: 10, vertical: 6 }), background(palette.surfaceRaised, shapes.capsule())]}>
                <Image systemName="figure.run" size={12} color={palette.tertiary} />
                <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
                  {like.activityLabel}
                </Text>
              </HStack>
            ) : null}
            {like.location ? (
              <HStack spacing={4} modifiers={[padding({ horizontal: 10, vertical: 6 }), background(palette.surfaceRaised, shapes.capsule())]}>
                <Image systemName="mappin.and.ellipse" size={12} color={palette.tertiary} />
                <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
                  {like.location}
                </Text>
              </HStack>
            ) : null}
            {(like.availabilitySlots && like.availabilitySlots.length > 0) ? (
              <HStack spacing={4} modifiers={[padding({ horizontal: 10, vertical: 6 }), background(palette.surfaceRaised, shapes.capsule())]}>
                <Image systemName="clock.fill" size={12} color={palette.tertiary} />
                <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
                  {formatAvailabilitySlots(like.availabilitySlots, { compact: true })}
                </Text>
              </HStack>
            ) : like.availability ? (
              <HStack spacing={4} modifiers={[padding({ horizontal: 10, vertical: 6 }), background(palette.surfaceRaised, shapes.capsule())]}>
                <Image systemName="clock.fill" size={12} color={palette.tertiary} />
                <Text modifiers={[font({ textStyle: 'caption2', weight: 'semibold' }), foregroundStyle(palette.tertiary)]}>
                  {like.availability}
                </Text>
              </HStack>
            ) : null}
          </HStack>
        </ScrollView>
        
        {accepted ? (
          <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
            <Button
              label="ยกเลิกจับคู่"
              onPress={handleRemove}
              role="destructive"
              systemImage="person.2.slash"
              modifiers={[
                buttonStyle('glass'),
                buttonBorderShape('capsule'),
                controlSize('small'),
                tint(palette.coral),
                frame({ maxWidth: Infinity })
              ]}
            />
            <Button
              disabled={processing}
              label="เปิดห้องแชต"
              onPress={handleOpenChat}
              systemImage="message.fill"
              modifiers={[
                buttonStyle('glassProminent'),
                buttonBorderShape('capsule'),
                controlSize('small'),
                tint(palette.coral),
                frame({ maxWidth: Infinity })
              ]}
            />
          </HStack>
        ) : (
          <HStack spacing={10} modifiers={[frame({ maxWidth: Infinity })]}>
            <Button
              label="ไม่รับตอนนี้"
              onPress={handleReject}
              role="cancel"
              systemImage="xmark"
              modifiers={[
                buttonStyle('glass'),
                buttonBorderShape('capsule'),
                controlSize('small'),
                tint(palette.surfaceRaised),
                disabled(processing),
                frame({ maxWidth: Infinity })
              ]}
            />
            <Button
              label={processing ? 'กำลังจับคู่...' : 'รับเป็นเพื่อน'}
              onPress={handleAccept}
              systemImage="heart.fill"
              modifiers={[
                buttonStyle('glassProminent'),
                buttonBorderShape('capsule'),
                controlSize('small'),
                tint(palette.coral),
                disabled(processing),
                frame({ maxWidth: Infinity })
              ]}
            />
          </HStack>
        )}
      </VStack>
    </VStack>
  );
});
