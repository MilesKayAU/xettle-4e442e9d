

# Add "Rescan Channels" Button

## Problem
The `handleRescan()` function exists in `ChannelAlertsBanner.tsx` (line 156) but is never called — no UI element triggers it. Users have no way to re-run the channel scan after initial detection.

## Fix
Add a "Rescan channels" button to `ChannelAlertsBanner.tsx` in two places:

### 1. When alerts exist — add a rescan button in the header area
In the section where alerts are displayed (line 301-307, near the "Collapse" button), add a `RefreshCw` rescan button next to it so users can re-run detection after new orders come in.

### 2. When no alerts and no initial sync needed — show a subtle rescan option
After line 278 (`if (alerts.length === 0) return null`), instead of returning null, render a minimal strip with a "Rescan channels" button so users who've already actioned all alerts can trigger a fresh scan.

## Changes
**Single file**: `src/components/dashboard/ChannelAlertsBanner.tsx`
- Wire the existing `handleRescan` function to a `<Button>` with `RefreshCw` icon
- Show "Rescanning..." with spinner when `syncing` is true
- Place it alongside the Collapse button when alerts are visible, or as a standalone subtle row when no alerts remain

