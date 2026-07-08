---
name: Vivid Stream
colors:
  surface: '#0b1326'
  surface-dim: '#0b1326'
  surface-bright: '#31394d'
  surface-container-lowest: '#060e20'
  surface-container-low: '#131b2e'
  surface-container: '#171f33'
  surface-container-high: '#222a3d'
  surface-container-highest: '#2d3449'
  on-surface: '#dae2fd'
  on-surface-variant: '#bbcac6'
  inverse-surface: '#dae2fd'
  inverse-on-surface: '#283044'
  outline: '#859490'
  outline-variant: '#3c4947'
  surface-tint: '#4fdbc8'
  primary: '#4fdbc8'
  on-primary: '#003731'
  primary-container: '#14b8a6'
  on-primary-container: '#00423b'
  inverse-primary: '#006b5f'
  secondary: '#c0c1ff'
  on-secondary: '#1000a9'
  secondary-container: '#3131c0'
  on-secondary-container: '#b0b2ff'
  tertiary: '#ffb2b7'
  on-tertiary: '#67001b'
  tertiary-container: '#ff7b88'
  on-tertiary-container: '#7a0022'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#71f8e4'
  primary-fixed-dim: '#4fdbc8'
  on-primary-fixed: '#00201c'
  on-primary-fixed-variant: '#005048'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#ffdadb'
  tertiary-fixed-dim: '#ffb2b7'
  on-tertiary-fixed: '#40000d'
  on-tertiary-fixed-variant: '#92002a'
  background: '#0b1326'
  on-background: '#dae2fd'
  surface-variant: '#2d3449'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 40px
---

## Brand & Style
The design system is built for a safe, modern, and high-energy video communication platform. The brand personality is "Technically Empathetic"—merging the precision of high-end software with a warm, human-centric approach. 

The aesthetic style follows a **Modern Corporate** approach with a **Glassmorphic** twist. It utilizes clean layouts and heavy whitespace to prioritize video content, while employing frosted glass overlays for floating controls to ensure they remain legible without obscuring the user's view. The emotional response should be one of security, clarity, and excitement.

## Colors
The palette is anchored by a deep Indigo-Slate (`#0F172A`) to provide a stable, "safe" backdrop that makes video colors pop. 

- **Primary (Bright Teal):** Used for "Action" states, active camera indicators, and primary call-to-action buttons. It represents energy and connectivity.
- **Secondary (Soft Indigo):** Used for supportive UI elements, secondary buttons, and navigational highlights.
- **Tertiary (Rose):** Reserved exclusively for "End Call" actions and critical alerts to provide immediate visual contrast.
- **Surface Neutrals:** Deep greys and semi-transparent blacks are used for panels and backgrounds to maintain a premium, cinematic feel.

## Typography
Inter is used across the entire design system to ensure maximum legibility and a systematic, utilitarian feel that stays out of the way of the conversation. 

Headlines use a tighter letter-spacing and heavier weights to provide clear hierarchy in settings and profile views. Body text maintains a generous line height to ensure readability in chat sidebars. Label styles are frequently used for participant names and timestamps, where a medium weight ensures visibility against variable video backgrounds.

## Layout & Spacing
The layout uses a **Fluid Grid** for video participant tiles, which dynamically scales based on the number of users in a call (1x1, 2x2, or a large featured speaker with a sidebar). 

- **Desktop:** A 12-column grid is used for the dashboard, while the video call view uses a flexible container with 40px outer margins.
- **Mobile:** Elements stack vertically with 16px safe-area margins. The video aspect ratio is prioritized, often utilizing a 9:16 portrait orientation for mobile-to-mobile calls.
- **Rhythm:** An 8px linear scale drives all padding and margin decisions to maintain visual consistency.

## Elevation & Depth
Depth is created through **Glassmorphism** and **Ambient Shadows**. 

1. **Base Layer:** Deep neutral background.
2. **Video Layer:** Crisp, high-contrast video feeds.
3. **Control Layer:** Floating toolbars and chat panels use a `Backdrop Filter: blur(12px)` with a 10% white border stroke to separate the UI from the video movement beneath it.
4. **Interactive Layer:** Active modals or dropdowns use extra-diffused, low-opacity shadows (20% opacity) with a subtle Indigo tint to create a sense of floating.

## Shapes
This design system uses a **Rounded** shape language to feel approachable and "soft." 

Large containers like video previews use `rounded-xl` (1.5rem/24px) to avoid the "harshness" of sharp-edged screens. Buttons and input fields use the base `rounded` (0.5rem/8px). For status indicators (like "Live") and small icons, use `rounded-lg` (1rem/16px) to maintain the friendly, circular motif throughout the interface.

## Components
- **Buttons:** Primary buttons are Teal with white text. Secondary buttons use the Indigo tint with a glass-blur background. All buttons have a subtle inner-glow on hover.
- **Video Tiles:** Feature a 1px inner stroke (Indigo-400 at 20% opacity) and display the participant name in a bottom-left label with a blurred background.
- **Control Bar:** A floating bottom-centered bar with circular icon buttons. Toggled states (e.g., Mute On) should transition from Teal to Rose.
- **Input Fields:** Darker than the background with a 1px border that glows Teal on focus.
- **Chips:** Used for "Tags" or "Interests" in profiles, utilizing the secondary Indigo color with a 12% fill.
- **Safety Indicator:** A prominent, always-visible "Safe Connection" shield icon in the top left, rendered in a soft Primary Teal.