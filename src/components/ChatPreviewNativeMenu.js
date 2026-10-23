import React from 'react';

// Android / web fallback: native SwiftUI Menu is unavailable, so render nothing
// and let the standard Pressable context actions handle interactions.
export default function ChatPreviewNativeMenu() {
  return null;
}
