import { Platform, useWindowDimensions } from 'react-native';

/**
 * useResponsiveLayout
 * Provides dynamic, orientation-aware layout metrics for iPad and tablet devices.
 * Adheres to Apple Human Interface Guidelines for iPadOS.
 */
export function useResponsiveLayout() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const isPad = Platform.OS === 'ios' && Boolean(Platform.isPad);
  const isTablet = isPad || windowWidth >= 700;
  const isLandscape = windowWidth > windowHeight;

  // Adaptive content max-widths
  const maxContentWidth = isTablet ? Math.min(windowWidth - 48, 860) : windowWidth;
  const cardMaxWidth = isTablet ? Math.min(windowWidth - 64, 520) : Math.min(windowWidth - 32, 440);
  const formMaxWidth = isTablet ? Math.min(windowWidth - 64, 640) : windowWidth;
  const modalMaxWidth = isTablet ? 520 : Math.min(windowWidth - 32, 440);

  // Responsive grid columns (e.g. for Likes or activities feed)
  const gridColumns = isTablet ? (windowWidth >= 1024 ? 3 : 2) : 1;

  // Adaptive hero heights for profile cards and discovery
  const heroHeight = isTablet
    ? Math.round(Math.min(windowHeight * 0.62, 540))
    : Math.round(Math.min(windowHeight * 0.75, 460));

  // Chat message bubble width for tablet (avoid cramped 300px bubbles on wide screens)
  const chatBubbleMaxWidth = isTablet ? Math.min(windowWidth * 0.62, 520) : 300;

  return {
    isPad,
    isTablet,
    isLandscape,
    windowWidth,
    windowHeight,
    maxContentWidth,
    cardMaxWidth,
    formMaxWidth,
    modalMaxWidth,
    gridColumns,
    heroHeight,
    chatBubbleMaxWidth,
  };
}

export default useResponsiveLayout;
