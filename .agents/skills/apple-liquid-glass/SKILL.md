---
name: apple-liquid-glass
description: "Apple Liquid Glass Framework & Design System Guide based on official Landmarks sample code. Covers SwiftUI Liquid Glass APIs (GlassEffectContainer, .glassEffect, .glassEffectID, .buttonStyle(.glass), .backgroundExtensionEffect()), interactive morphing physics, flexible scroll headers, accessibility contrast scrims, and Expo/React Native integration via @expo/ui/swift-ui and expo-glass-effect."
version: 1.0.0
license: MIT
---

# Apple Liquid Glass Architecture & Engineering Guide

This skill distills the architectural patterns, APIs, and design principles from Apple's official sample project: **Landmarks: Building an app with Liquid Glass** (iOS 26+, macOS 26+, iPadOS 26+), and demonstrates how to implement them natively in SwiftUI as well as bridge them to Expo and React Native applications.

---

## 1. Core Principles of Liquid Glass

Liquid Glass represents Apple's dynamic, interactive material system. Unlike static visual materials (`.ultraThinMaterial`, `.regularMaterial`), Liquid Glass possesses four physical properties:

1. **Optical Refraction & Prismatic Dispersion**: Refracts underlying content dynamically with specular edge rim lighting and subtle chromatic aberration (prism highlights).
2. **Coalescence & Morphing**: When grouped inside a `GlassEffectContainer`, discrete glass elements fluidly merge, deform, and coalesce as their layout boundaries change.
3. **Interactive Reactivity**: Buttons and controls with `.buttonStyle(.glass)` depress with physical lens bulging and highlight shifts under user touch or pointer hover.
4. **Contextual Readability**: Always paired with contrast preservation layers (e.g., gradient scrims like `ReadabilityRoundedRectangle`) and falls back to opaque accessible surfaces when Reduce Transparency is enabled.

---

## 2. Complete SwiftUI API Suite (from Landmarks)

### 2.1 `GlassEffectContainer`
Groups multiple Liquid Glass elements into a single coordinated layout. It orchestrates boundary interactions and allows glass elements to morph together during animations.

```swift
GlassEffectContainer(spacing: Constants.badgeGlassSpacing) {
    VStack(alignment: .center, spacing: Constants.badgeButtonTopSpacing) {
        if isExpanded {
            VStack(spacing: Constants.badgeSpacing) {
                ForEach(modelData.earnedBadges) { badge in
                    BadgeLabel(badge: badge)
                        .glassEffect(.regular, in: .rect(cornerRadius: Constants.badgeCornerRadius))
                        .glassEffectID(badge.id, in: namespace)
                }
            }
        }

        Button {
            withAnimation {
                isExpanded.toggle()
            }
        } label: {
            ToggleBadgesLabel(isExpanded: isExpanded)
                .frame(width: Constants.badgeShowHideButtonWidth,
                       height: Constants.badgeShowHideButtonHeight)
        }
        .buttonStyle(.glass)
        #if os(macOS)
        .tint(.clear)
        #endif
        .glassEffectID("togglebutton", in: namespace)
    }
    .frame(width: Constants.badgeFrameWidth)
}
```

- **`spacing`**: The minimum gap threshold where discrete glass boundaries remain distinct or begin coalescing.
- **`withAnimation`**: Wrapping state changes in standard SwiftUI animations (`withAnimation`, spring) triggers fluid morphing of the glass material.

---

### 2.2 `.glassEffect(_ style:in:)`
Applies Liquid Glass to any arbitrary SwiftUI view or layout container.

```swift
.glassEffect(.regular, in: .rect(cornerRadius: Constants.badgeCornerRadius))
// Or with capsule shape:
.glassEffect(.regular, in: .capsule)
// Or with circle:
.glassEffect(.clear, in: .circle)
```

- **Styles**:
  - `.regular`: Standard translucent glass with full specular highlights and optical refraction.
  - `.clear`: Ultra-clear minimal diffusion glass, ideal over vibrant, high-contrast imagery.
- **Shapes (`in:`)**: Defines the 3D surface geometry used by the rendering engine to compute rim lighting and light refraction angles.

---

### 2.3 `.glassEffectID(_:in:)`
Assigns an animated glass identity within an `@Namespace`.

```swift
@Namespace private var namespace

...
.glassEffectID(badge.id, in: namespace)
...
.glassEffectID("togglebutton", in: namespace)
```

- Functions similarly to `.matchedGeometryEffect`, but specifically instructs the Liquid Glass compositor to morph the glass boundary and specular sheen from one state to another.

---

### 2.4 `.buttonStyle(.glass)`
Applies the native Apple Liquid Glass button interaction.

```swift
Button(action: toggleAction) {
    Label("Toggle", systemImage: "sparkles")
}
.buttonStyle(.glass)
#if os(macOS)
.tint(.clear)
#endif
```

- Native haptic and visual depression feedback.
- Specular highlight moves toward the touch point.
- On macOS, use `.tint(.clear)` when the button is nested over dynamic artwork to avoid unwanted window accent tinting.

---

### 2.5 `.backgroundExtensionEffect()`
Extends background hero imagery and content dynamically into the navigation bar, toolbars, and safe areas.

```swift
Image(landmark.backgroundImageName)
    .resizable()
    .aspectRatio(contentMode: .fill)
    .frame(minWidth: 0, maxWidth: .infinity, minHeight: 0, maxHeight: .infinity)
    .backgroundExtensionEffect()
    .flexibleHeaderContent()
```

- Creates an immersive visual layer behind translucent toolbars and floating glass controls.

---

### 2.6 Flexible Header with Geometry Tracking
In Landmarks, stretchy overscroll headers are built cleanly using `.onScrollGeometryChange`:

```swift
@Observable private class FlexibleHeaderGeometry {
    var offset: CGFloat = 0
}

private struct FlexibleHeaderScrollViewModifier: ViewModifier {
    @State private var geometry = FlexibleHeaderGeometry()

    func body(content: Content) -> some View {
        content
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                min(geometry.contentOffset.y + geometry.contentInsets.top, 0)
            } action: { _, offset in
                geometry.offset = offset
            }
            .environment(geometry)
    }
}
```

---

### 2.7 Readability Scrims & High-Opacity Surfaces
Liquid Glass must never compromise legibility:

1. **Readability Scrim**: Place subtle gradient scrims beneath text overlaying images:
   ```swift
   RoundedRectangle(cornerRadius: Constants.cornerRadius)
       .foregroundStyle(.clear)
       .background(
           LinearGradient(
               colors: [.black.opacity(0.8), .clear],
               startPoint: .bottom,
               endPoint: .center
           )
       )
   ```
2. **Text Editing Surfaces**: For text inputs (`TextField`, `TextEditor`), do **not** use interactive glass. Use high-opacity static materials:
   ```swift
   #if os(macOS)
   static let editingBackgroundStyle = WindowBackgroundShapeStyle.windowBackground
   #else
   static let editingBackgroundStyle = Material.ultraThickMaterial
   #endif
   ```

---

## 3. Expo & React Native Bridge

When building React Native and Expo apps for iOS, leverage `@expo/ui/swift-ui` to utilize real Apple Liquid Glass components.

### 3.1 Native SwiftUI Segmented Picker (iOS 18+ Glass Slider)

```tsx
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Host, Picker, Text } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';

export default function NativeGlassSegmentedControl({ activeTab, onChangeTab, tabs }) {
  return (
    <View style={styles.container}>
      {/* IMPORTANT: Host must have an explicit height and width to prevent 0-height collapse */}
      <Host style={styles.host}>
        <Picker
          label="Tab Selector"
          modifiers={[pickerStyle('segmented')]}
          selection={activeTab}
          onSelectionChange={(selection) => {
            if (selection && selection !== activeTab) {
              onChangeTab(selection);
            }
          }}
        >
          {tabs.map((tab) => (
            <Text key={tab.id} modifiers={[tag(tab.id)]}>
              {tab.label}
            </Text>
          ))}
        </Picker>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    justifyContent: 'center',
    marginVertical: 4,
  },
  host: {
    width: '100%',
    height: 38,
  },
});
```

> [!CRITICAL]
> **Host Sizing Rule**: Segmented and wheel pickers in `@expo/ui/swift-ui` stretch to fill the width they are given. They **collapse to 0 height** under `matchContents={true}` or inside unbounded SwiftUI containers. Always specify an explicit `height: 36` to `38` and `width: '100%'` on the `Host`.

---

### 3.2 High-Fidelity Cross-Platform Fallback (Android & Older iOS)

When running on Android or platforms without native iOS 26+ Liquid Glass, construct a visual twin using:
1. Outer capsule track with `BlurView` (`intensity={40}`)
2. Sliding glass pill with:
   - **Prismatic / Chromatic Aberration Rim**: `LinearGradient` border with `['rgba(255,255,255,0.9)', 'rgba(115,215,255,0.8)', 'rgba(215,125,255,0.75)', 'rgba(255,195,85,0.7)', 'rgba(255,255,255,0.4)']`.
   - **Inner Frosted Blur**: `BlurView` (`intensity={50}`).
   - **Top Specular Convex Sheen**: Curved top `LinearGradient` `['rgba(255,255,255,0.45)', 'rgba(255,255,255,0.06)', 'transparent']`.
   - **Spring Physics**: Smooth sliding with Reanimated `withSpring({ damping: 26, stiffness: 350, mass: 0.8 })`.

---

## 4. Best Practices & Anti-Patterns Checklist

| Do | Don't |
|---|---|
| Use `GlassEffectContainer` whenever animating 2+ glass elements together. | Animate glass elements individually with disconnected transitions. |
| Use `.buttonStyle(.glass)` for floating action buttons and toolbars over visual media. | Apply `.glass` to standard full-width form submission buttons. |
| Provide explicit frames (`height: 38`, `width: '100%'`) on `<Host>` for segmented pickers. | Use `matchContents={true}` on pickers inside `<Host>`. |
| Add a readability scrim gradient beneath white text over glass and photography. | Place raw text directly over translucent glass on busy backgrounds. |
| Respect `isReduceTransparencyEnabled()` and fall back to solid/opaque materials. | Force high transparency on users who requested reduced transparency. |
| Use `Material.ultraThickMaterial` for dense text inputs and form editors. | Place `TextEditor` inside interactive `.glassEffect`. |
