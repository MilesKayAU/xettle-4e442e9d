

## First-Time User Welcome Guide

### Problem
New users land on the dashboard with no context about what Xettle does or how to use it. The existing onboarding checklist is task-oriented but doesn't explain the product's value proposition or workflow.

### Solution
A dismissible "Welcome to Xettle" card that appears on the dashboard for first-time users (no settlements, wizard complete or dismissed). It explains the app in 3 simple steps with clear visuals, highlights what connecting integrations does for them, and gives them a confident first action.

### Design

The card appears at the top of the ActionCentre, above the status cards. It contains:

```text
┌─────────────────────────────────────────────────────────┐
│  Welcome to Xettle — here's how it works                │
│                                                    [X]  │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ 1. UPLOAD │  │ 2. REVIEW│  │ 3. PUSH  │              │
│  │           │  │          │  │          │              │
│  │ Upload a  │  │ We break │  │ One click│              │
│  │ settlement│  │ it down  │  │ sends it │              │
│  │ CSV from  │  │ into fees│  │ to Xero  │              │
│  │ Amazon,   │  │ refunds, │  │ as a     │              │
│  │ Shopify,  │  │ & sales  │  │ journal  │              │
│  │ etc.      │  │          │  │ entry    │              │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                         │
│  💡 Connect Amazon or Shopify to auto-fetch settlements │
│  💡 Connect Xero to push with one click                 │
│                                                         │
│  [Upload your first settlement]  [Connect a store]      │
└─────────────────────────────────────────────────────────┘
```

### New Component
**`src/components/dashboard/WelcomeGuide.tsx`**
- Three-step visual explainer: Upload → Review → Push
- Two "pro tips" about connecting stores and Xero
- Two CTA buttons: "Upload your first settlement" and "Connect a store"
- Dismissible via X button, persisted to `app_settings` with key `welcome_guide_dismissed`
- Only renders when user has zero settlements

### Integration
**`src/components/dashboard/ActionCentre.tsx`**
- Import `WelcomeGuide`
- Add state check: show when `rows.length === 0` (no validation data = no settlements)
- Pass `onSwitchToUpload` and a callback to open settings as props
- Render above the greeting section

### Files to Change
- **Create**: `src/components/dashboard/WelcomeGuide.tsx`
- **Edit**: `src/components/dashboard/ActionCentre.tsx` — import and conditionally render WelcomeGuide

