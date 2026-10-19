import { Platform } from 'react-native';
import { offlineSync } from './offlineSync';
import { realtimeManager } from './realtimeManager';
import { fetchActiveWaitlist, joinOrUpdateWaitlist, removeWaitlistEntry, callWaitlistDuo } from './waitlistService';
import { placeMatchBet, settleMatchBetsAndWagers, reconcileUserPendingBets } from './bettingService';
import { supabase } from './supabase';
import { sounds } from './sounds';

/**
 * GraphifyBridge ("Griphy") — Full-System Knowledge Graph & Runtime QA Bridge for Claude Code.
 * Exposes `window.__DOMINO_GRAPHIFY__` on Web so Claude Code / Playwright / E2E runners can:
 *   1. Inspect the entire system architecture graph (8 communities, 11 screens, 5 components, 7 services, 11 DB tables, 4 RPCs)
 *   2. Navigate programmatically to any screen (`navigate(screen, params)`) for automated UI/design testing
 *   3. Trigger UI modals (Waitlist 30s Call, Toast, Offline Banner) to verify design states
 *   4. Run end-to-end backend/frontend diagnostics (`runDiagnostics()`)
 */

export interface GraphifyRuntimeState {
  currentScreen: string;
  currentUserProfileId: string | null;
  currentUserDisplayName?: string | null;
  isAdmin?: boolean;
  isAuthenticated?: boolean;
  isGuestMode?: boolean;
  activeMatchId: string | null;
  liveMatchId?: string | null;
  isOnline: boolean;
  pendingOfflineOps: number;
}

export interface GraphifyNavigateOptions {
  replace?: boolean;
  liveMatchId?: string | null;
  viewProfileId?: string | null;
}

type NavigateFn = (screen: any, options?: GraphifyNavigateOptions) => void;
type TriggerToastFn = (msg: { name: string; text: string; color: string }) => void;
type TriggerWaitlistCallFn = (callData: {
  duoId: string;
  p1Name: string;
  p2Name: string;
  callerName: string;
  timeLeft: number;
}) => void;

let currentRuntimeState: GraphifyRuntimeState = {
  currentScreen: 'home',
  currentUserProfileId: null,
  currentUserDisplayName: null,
  isAdmin: false,
  isAuthenticated: false,
  isGuestMode: false,
  activeMatchId: null,
  liveMatchId: null,
  isOnline: true,
  pendingOfflineOps: 0,
};

let navigateController: NavigateFn | null = null;
let toastController: TriggerToastFn | null = null;
let waitlistCallController: TriggerWaitlistCallFn | null = null;

export function registerGraphifyControllers(controllers: {
  navigate: NavigateFn;
  triggerToast?: TriggerToastFn;
  triggerWaitlistCall?: TriggerWaitlistCallFn;
}) {
  navigateController = controllers.navigate;
  if (controllers.triggerToast) toastController = controllers.triggerToast;
  if (controllers.triggerWaitlistCall) waitlistCallController = controllers.triggerWaitlistCall;
}

export function updateGraphifyState(partial: Partial<GraphifyRuntimeState>) {
  currentRuntimeState = { ...currentRuntimeState, ...partial };
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const w = window as any;
    if (w.__DOMINO_GRAPHIFY__) {
      w.__DOMINO_GRAPHIFY__.runtimeState = currentRuntimeState;
    }
  }
}

export const updateGraphifyRuntimeState = updateGraphifyState;

export const FULL_SYSTEM_GRAPH_MANIFEST = {
  version: '3.0.0-full-system',
  appName: 'Domino VIP (PeSiMistas)',
  communities: [
    {
      id: 'core_router',
      name: '1. Core Router & Lifecycle',
      files: ['index.ts', 'App.tsx', 'src/types.ts', 'src/theme.ts'],
    },
    {
      id: 'backend_services',
      name: '2. Backend, Offline, Realtime & QA Services',
      files: [
        'src/lib/supabase.ts',
        'src/lib/offlineSync.ts',
        'src/lib/realtimeManager.ts',
        'src/lib/bettingService.ts',
        'src/lib/waitlistService.ts',
        'src/lib/sounds.ts',
        'src/lib/graphifyBridge.ts',
      ],
    },
    {
      id: 'onboarding_auth_screens',
      name: '3. Onboarding, Ads & Auth Screens',
      files: [
        'src/screens/OnboardingScreen.tsx',
        'src/screens/SplashAdScreen.tsx',
        'src/screens/AuthScreen.tsx',
      ],
    },
    {
      id: 'gameplay_live_screens',
      name: '4. Match Setup, Gameplay & Spectator Screens',
      files: [
        'src/screens/HomeScreen.tsx',
        'src/screens/SetupScreen.tsx',
        'src/screens/GameScreen.tsx',
        'src/screens/LiveMatchScreen.tsx',
      ],
    },
    {
      id: 'social_economy_screens',
      name: '5. Social, Store, Achievements, Rankings & Tournaments',
      files: [
        'src/screens/ProfileScreen.tsx',
        'src/screens/LeaderboardScreen.tsx',
        'src/screens/AchievementsScreen.tsx',
        'src/screens/StoreScreen.tsx',
        'src/screens/TournamentsScreen.tsx',
        'src/screens/GlobalChatScreen.tsx',
      ],
    },
    {
      id: 'ui_components',
      name: '6. Reusable Visual & Modal Components',
      files: [
        'src/components/ProgressChart.tsx',
        'src/components/MatchGraph.tsx',
        'src/components/QRScannerModal.tsx',
        'src/components/RainbowText.tsx',
        'src/components/LegalModal.tsx',
      ],
    },
    {
      id: 'database_sql',
      name: '7. Supabase Database Schema, Triggers & RPCs',
      files: [
        'supabase_schema.sql',
        'supabase_maintenance_fix.sql',
        'clean_today.sql',
        'clean_only_tests.sql',
      ],
    },
    {
      id: 'pwa_build_config',
      name: '8. PWA, Service Worker & Deployment Config',
      files: [
        'package.json',
        'app.json',
        'tsconfig.json',
        'vercel.json',
        'public/manifest.json',
        'public/sw.js',
        'scripts/postbuild.js',
        'scripts/graphify.js',
      ],
    },
  ],
  screens: [
    { route: 'splash', component: 'OnboardingScreen', file: 'src/screens/OnboardingScreen.tsx', requiresAuth: false },
    { route: 'ad', component: 'SplashAdScreen', file: 'src/screens/SplashAdScreen.tsx', requiresAuth: false },
    { route: 'auth', component: 'AuthScreen', file: 'src/screens/AuthScreen.tsx', requiresAuth: false },
    { route: 'home', component: 'HomeScreen', file: 'src/screens/HomeScreen.tsx', requiresAuth: true },
    { route: 'setup', component: 'SetupScreen', file: 'src/screens/SetupScreen.tsx', requiresAuth: false },
    { route: 'game', component: 'GameScreen', file: 'src/screens/GameScreen.tsx', requiresAuth: false },
    { route: 'live', component: 'LiveMatchScreen', file: 'src/screens/LiveMatchScreen.tsx', requiresAuth: true },
    { route: 'profile', component: 'ProfileScreen', file: 'src/screens/ProfileScreen.tsx', requiresAuth: true },
    { route: 'store', component: 'StoreScreen', file: 'src/screens/StoreScreen.tsx', requiresAuth: true },
    { route: 'achievements', component: 'AchievementsScreen', file: 'src/screens/AchievementsScreen.tsx', requiresAuth: true },
    { route: 'leaderboard', component: 'LeaderboardScreen', file: 'src/screens/LeaderboardScreen.tsx', requiresAuth: true },
    { route: 'tournaments', component: 'TournamentsScreen', file: 'src/screens/TournamentsScreen.tsx', requiresAuth: true },
    { route: 'global_chat', component: 'GlobalChatScreen', file: 'src/screens/GlobalChatScreen.tsx', requiresAuth: true },
  ],
  databaseTables: [
    { table: 'profiles', pk: 'id', realtime: true, purpose: 'Users, betting_points, inventory, equipped_items, achievements, streak_count, is_admin' },
    { table: 'matches', pk: 'id', realtime: true, purpose: 'Active & completed matches, rounds JSONB, players_json, substitutions, wager_amount, tournament_id' },
    { table: 'waitlist', pk: 'id', realtime: true, purpose: 'Pedir Mesa queue (creator_id, player1_id, player2_id, status: waiting/playing/cancelled)' },
    { table: 'bets', pk: 'id', realtime: true, purpose: 'Spectator match bets (user_id, match_id, bet_on_team, amount_wagered, multiplier, status)' },
    { table: 'duos', pk: 'id', realtime: false, purpose: 'Official player partnerships (player1_id, player2_id, is_active)' },
    { table: 'live_chat', pk: 'id', realtime: true, purpose: 'Per-match spectator & player chat messages' },
    { table: 'global_chat', pk: 'id', realtime: true, purpose: 'Community global lobby chat with 3s cooldown' },
    { table: 'tournaments', pk: 'id', realtime: false, purpose: 'VIP Cash, Brackets & Leaderboard tournaments' },
    { table: 'tournament_participants', pk: 'id', realtime: false, purpose: 'Tournament registrations, payment receipts, partner_id, payout_details' },
    { table: 'tournament_brackets', pk: 'id', realtime: false, purpose: 'Elimination bracket matches linked via live_match_id' },
    { table: 'ads', pk: 'id', realtime: false, purpose: 'Sponsored splash screen ads (image_url, link_url, is_active)' },
  ],
  databaseRPCs: [
    { name: 'resolve_match_bets', security: 'SECURITY DEFINER', args: ['p_match_id', 'p_winner_team'], purpose: 'Pays FLOOR(amount_wagered * multiplier) to winning bettors or refunds cancelled matches' },
    { name: 'resolve_match_wagers', security: 'SECURITY DEFINER', args: ['p_match_id', 'p_winner_team'], purpose: 'Transfers wager_amount between winning and losing players in VIP Wager matches' },
    { name: 'update_player_streaks_for_match', security: 'INVOKER', args: ['p_match_id'], purpose: 'Updates player win/play streaks after match completion' },
    { name: 'clean_old_tournaments', security: 'INVOKER', args: [], purpose: 'Cleans up expired tournaments older than 15 days' },
  ],
  storageKeys: [
    { key: '@domino_active_match', purpose: 'Persists active match state across reloads and offline play' },
    { key: '@domino_offline_queue_v1', purpose: 'FIFO Outbox queue for offline match creations, round updates, and completions' },
    { key: '@domino_cached_profiles_v1', purpose: 'Stale-While-Revalidate local cache of all player profiles' },
    { key: '@domino_cached_matches_v1', purpose: 'Stale-While-Revalidate local cache of recent matches for instant rankings' },
    { key: '@domino_onboarding_seen', purpose: 'Tracks whether the 5-slide OnboardingScreen has been completed' },
    { key: '@domino_last_ad_timestamp', purpose: '30-minute cooldown tracker for SplashAdScreen' },
    { key: '@domino_admin_override', purpose: 'Local admin PIN unlock flag (PIN: 0509 in ProfileScreen)' },
  ],
};

export function initGraphifyBridge() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;

  const w = window as any;
  w.__DOMINO_GRAPHIFY__ = {
    version: FULL_SYSTEM_GRAPH_MANIFEST.version,
    manifest: FULL_SYSTEM_GRAPH_MANIFEST,
    runtimeState: currentRuntimeState,
    getState: () => ({
      ...currentRuntimeState,
      isOnline: offlineSync.getIsOnline(),
      pendingOfflineOps: offlineSync.getStatus().pendingCount,
      cachedProfilesCount: offlineSync.getCachedProfilesSync().length,
    }),
    // Programmatic Navigation & UI State Triggers for Claude Code E2E / Visual Testing
    navigate: (screen: string, options?: GraphifyNavigateOptions) => {
      if (navigateController) {
        navigateController(screen, options);
        return { ok: true, navigatedTo: screen };
      }
      return { ok: false, error: 'Navigate controller not mounted yet' };
    },
    uiTestHelpers: {
      triggerSampleToast: () => {
        if (toastController) {
          toastController({
            name: '👑 Claude Code QA',
            text: 'Prueba visual de notificación global en vivo',
            color: '#60a5fa',
          });
          return true;
        }
        return false;
      },
      triggerSampleWaitlistModal: () => {
        if (waitlistCallController) {
          waitlistCallController({
            duoId: 'qa-test-duo',
            p1Name: 'Jugador QA 1',
            p2Name: 'Jugador QA 2',
            callerName: 'Claude Code Test',
            timeLeft: 30,
          });
          return true;
        }
        return false;
      },
      toggleMute: () => sounds.toggleMute(),
    },
    // Direct Backend Service Access for Claude Code
    offlineSync: {
      getStatus: () => offlineSync.getStatus(),
      getQueue: () => offlineSync.getQueue(),
      flushQueue: () => offlineSync.flushQueue(),
      getProfiles: (force?: boolean) => offlineSync.getProfiles(force),
      getCachedMatches: () => offlineSync.getCachedMatches(),
    },
    realtimeManager: {
      broadcastMatchUpdate: (matchId: string, matchData: any) =>
        realtimeManager.broadcastMatchUpdate(matchId, matchData),
      broadcastCallDuo: (payload: any) => realtimeManager.broadcastCallDuo(payload),
      notifyWaitlistRefresh: () => realtimeManager.notifyWaitlistRefresh(),
    },
    betting: {
      placeMatchBet,
      settleMatchBetsAndWagers,
      reconcileUserPendingBets,
    },
    waitlist: {
      fetchActiveWaitlist,
      joinOrUpdateWaitlist,
      removeWaitlistEntry,
      callWaitlistDuo,
    },
    runDiagnostics: async () => {
      const results: Record<string, any> = {
        timestamp: new Date().toISOString(),
        version: FULL_SYSTEM_GRAPH_MANIFEST.version,
        online: offlineSync.getIsOnline(),
        offlineQueueLength: offlineSync.getQueue().length,
        cachedProfilesCount: offlineSync.getCachedProfilesSync().length,
        currentScreen: currentRuntimeState.currentScreen,
        checks: {},
      };

      try {
        const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
        results.checks.supabaseAuth = {
          ok: !sessionErr,
          authenticated: Boolean(sessionData?.session?.user),
          userId: sessionData?.session?.user?.id || null,
        };
      } catch (e: any) {
        results.checks.supabaseAuth = { ok: false, error: e?.message };
      }

      try {
        const profiles = await offlineSync.getProfiles();
        results.checks.profilesCache = {
          ok: Array.isArray(profiles) && profiles.length > 0,
          count: profiles.length,
        };
      } catch (e: any) {
        results.checks.profilesCache = { ok: false, error: e?.message };
      }

      try {
        const wl = await fetchActiveWaitlist();
        results.checks.waitlist = {
          ok: Array.isArray(wl),
          waitingCount: wl.length,
        };
      } catch (e: any) {
        results.checks.waitlist = { ok: false, error: e?.message };
      }

      if (currentRuntimeState.currentUserProfileId) {
        try {
          const rec = await reconcileUserPendingBets(currentRuntimeState.currentUserProfileId);
          results.checks.bettingReconciliation = {
            ok: true,
            settledCount: rec.settledCount,
            totalCredited: rec.totalCredited,
          };
        } catch (e: any) {
          results.checks.bettingReconciliation = { ok: false, error: e?.message };
        }
      }

      return results;
    },
  };
}
