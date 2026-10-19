# CLAUDE.md — Full-System Graphify & QA Guide for Claude Code

## 1. Agent Role Division
- **Antigravity (Backend & Core Architecture Brain)**: Owns Supabase PostgreSQL schema & migrations ([`supabase_maintenance_fix.sql`](file:///home/lya/proyectos/Domino/supabase_maintenance_fix.sql)), Offline-First Outbox & SWR Caching ([`src/lib/offlineSync.ts`](file:///home/lya/proyectos/Domino/src/lib/offlineSync.ts)), Sub-100ms Hybrid WebSocket Broadcast + Postgres Realtime ([`src/lib/realtimeManager.ts`](file:///home/lya/proyectos/Domino/src/lib/realtimeManager.ts)), Atomic Betting & Self-Healing Payout Engine ([`src/lib/bettingService.ts`](file:///home/lya/proyectos/Domino/src/lib/bettingService.ts)), Pedir Mesa Queue Service ([`src/lib/waitlistService.ts`](file:///home/lya/proyectos/Domino/src/lib/waitlistService.ts)), and the Runtime Graphify Bridge ([`src/lib/graphifyBridge.ts`](file:///home/lya/proyectos/Domino/src/lib/graphifyBridge.ts)).
- **Claude Code (Frontend Design, Visual Polish & E2E Testing Agent)**: Owns UI/UX polish, responsive layout inspection, component styling, and E2E verification across all 11 screens and 5 reusable components using the **Full-System Graphify** artifacts and `window.__DOMINO_GRAPHIFY__`.

---

## 2. Always Start With the Full-System Graphify Artifacts
Before running broad file searches, read the pre-indexed Full-System Graphify suite:
1. **[`graphify-out/GRAPH_REPORT.md`](file:///home/lya/proyectos/Domino/graphify-out/GRAPH_REPORT.md)**: Exhaustive architectural manual covering all **8 system communities**, **13 routes**, **11 screens**, **5 components**, **7 services**, **11 database tables**, **4 RPCs**, **8 local storage keys**, and **navigation state machine**.
2. **[`graphify-out/graph.json`](file:///home/lya/proyectos/Domino/graphify-out/graph.json)**: Machine-readable knowledge graph (`51 nodes`, `49 directed edges`, `6 hyperedges`) with exact props contracts, Supabase tables touched, RPCs invoked, storage keys, and sound effects per file.
3. **[`graphify-out/qa_matrix.json`](file:///home/lya/proyectos/Domino/graphify-out/qa_matrix.json)**: Complete 14-suite E2E & Visual QA test matrix (`QA-01` through `QA-14`) with exact programmatic navigation commands.
4. **[`graphify-out/graph.html`](file:///home/lya/proyectos/Domino/graphify-out/graph.html)**: Interactive visual knowledge graph & QA matrix explorer.
5. **Regenerate / Verify Graph Anytime**:
   ```bash
   npm run graphify
   ```

---

## 3. Complete System Map (8 Communities)

### Community 1: Core Router & Design System
- [`index.ts`](file:///home/lya/proyectos/Domino/index.ts) — Expo root entry.
- [`App.tsx`](file:///home/lya/proyectos/Domino/App.tsx) — 13-route state machine (`splash`, `ad`, `auth`, `home`, `setup`, `game`, `live`, `profile`, `store`, `achievements`, `leaderboard`, `global_chat`, `tournaments`), global toast, 30s urgent waitlist call modal (`¡A LA MESA!`), and offline sync status banner.
- [`src/types.ts`](file:///home/lya/proyectos/Domino/src/types.ts) — Domain models (`Team`, `GameMode`, `Player`, `Round`, `Substitution`, `Match`, `Profile`).
- [`src/theme.ts`](file:///home/lya/proyectos/Domino/src/theme.ts) — Dark-slate palette (`#0f172a` background, `#1e293b` card, `#3b82f6` Team 1, `#10b981` Team 2, `#f59e0b` gold accent).

### Community 2: Backend, Offline Outbox, Realtime & QA Services (`src/lib/`)
- [`src/lib/supabase.ts`](file:///home/lya/proyectos/Domino/src/lib/supabase.ts) — Supabase client.
- [`src/lib/offlineSync.ts`](file:///home/lya/proyectos/Domino/src/lib/offlineSync.ts) — Stale-While-Revalidate profile/match cache + persistent FIFO Offline Outbox (`@domino_offline_queue_v1`).
- [`src/lib/realtimeManager.ts`](file:///home/lya/proyectos/Domino/src/lib/realtimeManager.ts) — Singleton `domino_waitlist_calls` channel + per-match `sync_match_<id>` hybrid broadcast/Postgres channel.
- [`src/lib/bettingService.ts`](file:///home/lya/proyectos/Domino/src/lib/bettingService.ts) — `placeMatchBet`, `settleMatchBetsAndWagers`, and `reconcileUserPendingBets`.
- [`src/lib/waitlistService.ts`](file:///home/lya/proyectos/Domino/src/lib/waitlistService.ts) — `fetchActiveWaitlist`, `joinOrUpdateWaitlist`, `removeWaitlistEntry`, `callWaitlistDuo`.
- [`src/lib/sounds.ts`](file:///home/lya/proyectos/Domino/src/lib/sounds.ts) — Audio feedback (`pop`, `slap`, `clap`, `chaching`) + mute toggle.
- [`src/lib/graphifyBridge.ts`](file:///home/lya/proyectos/Domino/src/lib/graphifyBridge.ts) — Mounts `window.__DOMINO_GRAPHIFY__`.

### Community 3: Onboarding, Sponsored Ads & Authentication Screens
- [`src/screens/OnboardingScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/OnboardingScreen.tsx) (`route: 'splash'`) — 5 tutorial slides + iOS/Android PWA install modals.
- [`src/screens/SplashAdScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/SplashAdScreen.tsx) (`route: 'ad'`) — 5s countdown ad with 30m cooldown.
- [`src/screens/AuthScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/AuthScreen.tsx) (`route: 'auth'`) — Login, Invite Code (`CAFETIN`, `PESIMISTAS`, `DOMINO`, `0509`, `VIP`) / QR registration, password recovery, and Guest Mode.

### Community 4: Gameplay & Spectator Live Screens
- [`src/screens/HomeScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/HomeScreen.tsx) (`route: 'home'`) — Club dashboard, daily streak (`+10 pts` at 7am), Pedir Mesa queue, and Individual/Duo rankings (`Hoy`/`Semana`/`Histórico`).
- [`src/screens/SetupScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/SetupScreen.tsx) (`route: 'setup'`) — 2v2/Individual setup, 2-step Salida/Mano turn order, and VIP Wager toggle.
- [`src/screens/GameScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/GameScreen.tsx) (`route: 'game'`) — Two-column scorepad, Mano indicator, substitutions (50-pt rule), Winner modal, Zapato `👟`, view-shot share, and "Llamar Siguiente Dúo".
- [`src/screens/LiveMatchScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/LiveMatchScreen.tsx) (`route: 'live'`) — Real-time spectator scoreboard, dynamic odds betting (`1.20x - 3.50x`), Pedir Mesa modal, and `live_chat`.

### Community 5: Social, Economy, Achievements, Leaderboards & Tournaments
- [`src/screens/ProfileScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/ProfileScreen.tsx) (`route: 'profile'`) — Stats, expandable VAR `MatchGraph`, Rivals, Duos, last 10 Bets, QR Invite Pass, and secret Admin PIN (`5 taps on avatar -> 0509`).
- [`src/screens/StoreScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/StoreScreen.tsx) (`route: 'store'`) — 14 VIP cosmetics + 250,000-pt Custom Title creator.
- [`src/screens/AchievementsScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/AchievementsScreen.tsx) (`route: 'achievements'`) — 50 unlockable achievements with point rewards.
- [`src/screens/LeaderboardScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/LeaderboardScreen.tsx) (`route: 'leaderboard'`) — Top 100 `💰 Ricos`, `🏆 Ganadores`, and `🥾 Zapateros`.
- [`src/screens/TournamentsScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/TournamentsScreen.tsx) (`route: 'tournaments'`) — `vip_cash` (Bs + receipt upload), `brackets`, and `leaderboard` tournaments + Admin panel.
- [`src/screens/GlobalChatScreen.tsx`](file:///home/lya/proyectos/Domino/src/screens/GlobalChatScreen.tsx) (`route: 'global_chat'`) — Real-time global lobby chat with 3s cooldown.

### Community 6: Reusable Components (`src/components/`)
- [`src/components/ProgressChart.tsx`](file:///home/lya/proyectos/Domino/src/components/ProgressChart.tsx)
- [`src/components/MatchGraph.tsx`](file:///home/lya/proyectos/Domino/src/components/MatchGraph.tsx)
- [`src/components/QRScannerModal.tsx`](file:///home/lya/proyectos/Domino/src/components/QRScannerModal.tsx)
- [`src/components/RainbowText.tsx`](file:///home/lya/proyectos/Domino/src/components/RainbowText.tsx)
- [`src/components/LegalModal.tsx`](file:///home/lya/proyectos/Domino/src/components/LegalModal.tsx)

---

## 4. Using `window.__DOMINO_GRAPHIFY__` in Browser / Playwright Tests
When running `npm run web`, use `window.__DOMINO_GRAPHIFY__` in DevTools or Playwright `page.evaluate()` to jump to any screen, trigger UI modals, or run diagnostics:

```javascript
// 1. Run full backend & cache diagnostics
await window.__DOMINO_GRAPHIFY__.runDiagnostics();

// 2. Navigate to any screen instantaneously
window.__DOMINO_GRAPHIFY__.navigate('home');
window.__DOMINO_GRAPHIFY__.navigate('setup');
window.__DOMINO_GRAPHIFY__.navigate('game');
window.__DOMINO_GRAPHIFY__.navigate('live');
window.__DOMINO_GRAPHIFY__.navigate('profile');
window.__DOMINO_GRAPHIFY__.navigate('store');
window.__DOMINO_GRAPHIFY__.navigate('achievements');
window.__DOMINO_GRAPHIFY__.navigate('leaderboard');
window.__DOMINO_GRAPHIFY__.navigate('tournaments');
window.__DOMINO_GRAPHIFY__.navigate('global_chat');

// 3. Trigger global overlays for visual inspection
window.__DOMINO_GRAPHIFY__.uiTestHelpers.triggerSampleToast();
window.__DOMINO_GRAPHIFY__.uiTestHelpers.triggerSampleWaitlistModal();
```
