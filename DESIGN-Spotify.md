# Design System Inspired by Spotify

> 本檔為前端視覺依據（重建版）。方向：「content-first darkness」——UI 退進近黑背景，唯一的品牌色是 Spotify Green，數字與內容自己發光。
> Reference design system for the frontend. Direction: "content-first darkness" — the UI recedes into near-black; the single brand accent is Spotify Green; numbers and content provide the color.

## 1. Visual Theme & Atmosphere

Dark, immersive, theater-like. Every surface is a shade of charcoal (`#121212` → `#1f1f1f`); the interface should feel like a premium audio device — tactile, rounded, built for touch. Color is functional, never decorative: green means "go / positive / primary action", red and orange are reserved for semantic states.

**Key characteristics:**
- Near-black immersive dark theme (`#121212`–`#1f1f1f`) — UI disappears behind content
- Spotify Green (`#1ed760`) as the singular brand accent — always functional (CTA, active, positive)
- Pill buttons (`border-radius: 500px`/`9999px`) and circular controls (`50%`) — rounded, touch-optimized
- Uppercase button labels with wide letter-spacing (1.4px–2px)
- Heavy shadows on elevated elements (`rgba(0,0,0,0.5) 0px 8px 24px`)
- Inset border-shadow combo on inputs: `rgb(18,18,18) 0px 1px 0px, rgb(124,124,124) 0px 0px 0px 1px inset`
- The UI itself is achromatic by design — data (amounts, chart slices) is the color source

## 2. Color Palette & Roles

### Surfaces
| Token | Hex | Role |
|---|---|---|
| `--bg-base` | `#121212` | Deepest page background |
| `--bg-surface` | `#181818` | Cards, containers, elevated surfaces |
| `--bg-elevated` | `#1f1f1f` | Button backgrounds, interactive surfaces |
| `--bg-highlight` | `#2a2a2a` | Hover states on surfaces |

### Brand
| Token | Hex | Role |
|---|---|---|
| `--brand` | `#1ed760` | Primary accent: CTAs, active states, income/positive |
| `--brand-press` | `#169c46` | Pressed/active green |

### Text
| Token | Hex | Role |
|---|---|---|
| `--text-base` | `#ffffff` | Primary text |
| `--text-subdued` | `#b3b3b3` | Secondary text, muted labels, inactive |
| `--text-bright` | `#fdfdfd` | Maximum emphasis (big numbers) |

### Semantic
| Token | Hex | Role |
|---|---|---|
| `--negative` | `#f3727f` | Errors, expense/negative amounts |
| `--warning` | `#ffa42b` | Warnings (e.g. negative balance) |
| `--announce` | `#539df5` | Info states |

On-brand text: black `#121212` on green buttons (never white on green).

## 3. Typography

- Font stack (Circular-like, global fallbacks): `"CircularSp", "Helvetica Neue", Helvetica, Arial, "Hiragino Kaku Gothic Pro", "Microsoft JhengHei", "Noto Sans TC", sans-serif` — system-safe, no external font loading.
- Weights: **700** emphasis/nav, **600** secondary emphasis, **400** body.
- Buttons/labels: UPPERCASE + `letter-spacing: 1.4px–2px`, small size (11–13px).
- Money figures: `font-variant-numeric: tabular-nums`, bold, bright — they are the heroes of the screen.

## 4. Geometry & Components

- **Primary buttons**: full pill (`border-radius: 9999px`), green fill, black uppercase label; scale on hover (1.02–1.04), no color shift.
- **Chips / segmented toggles**: pill outline on `--bg-elevated`; selected = green fill + black text.
- **Cards**: `--bg-surface`, radius 8–12px, generous padding; hover lightens to `--bg-highlight`.
- **Inputs**: pill or 8px radius on `--bg-elevated`, the inset border combo above; focus ring = 1px white → green.
- **Icon buttons**: circular, 32–48px, `--bg-elevated`.
- **Lists**: borderless rows separated by spacing, hover `--bg-highlight`; row height ≥ 48px (touch).

## 5. RWD 準則（本專案）/ Responsive rules for this app

主要使用情境是手機 — mobile-first。 Primary usage is on the phone — design mobile-first.

- **Baseline 360–430px**（iPhone/Android 直立）：單欄，全寬卡片，quick-add 靠近拇指熱區；觸控目標 ≥ 44px；`viewport-fit=cover` + `env(safe-area-inset-*)`。
- **≥ 768px（平板直立）**：內容欄 `max-width: 680px` 置中，元件放大呼吸。
- **≥ 1024px（桌機）**：兩欄 grid（左：balance + quick-add sticky；右：distribution + transactions），整體 `max-width: 1100px` 置中。
- 禁止水平捲動；圖表以 viewBox 縮放；長分類名截斷（ellipsis）不換行擠版。
- Dark 為預設且唯一主題（Spotify 沒有 light mode，本 app 同）。
