import React, { useEffect, useRef } from 'react';
import { VStack } from '@expo/ui/swift-ui';
import { id as nativeId, onGeometryChange } from '@expo/ui/swift-ui/modifiers';
import { useTourTarget } from '../context/AppTourContext';

// SwiftUI views cannot be measured with a React Native View ref. Bridge their
// window geometry into the same registry used by the shared tour overlay.
export default function NativeTourTarget({ id, ensureVisible, children }) {
  const geometry = useRef(null);
  const node = useRef({
    measureInWindow(callback) {
      const rect = geometry.current;
      if (rect) callback(rect.x, rect.y, rect.width, rect.height);
      else callback(0, 0, 0, 0);
    },
  });
  const register = useTourTarget(id, ensureVisible);
  useEffect(() => {
    register(node.current);
    return () => register(null);
  }, [register]);

  return (
    <VStack spacing={0} modifiers={[
      nativeId(id),
      onGeometryChange((rect) => { geometry.current = rect; }),
    ]}>
      {children}
    </VStack>
  );
}
