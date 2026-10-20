import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StatusBar, Alert, BackHandler, View, Text, Animated, TouchableOpacity, StyleSheet, Platform, Image, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { SplashAdScreen } from './src/screens/SplashAdScreen';
import { SetupScreen } from './src/screens/SetupScreen';
import { GameScreen } from './src/screens/GameScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { LiveMatchScreen } from './src/screens/LiveMatchScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { StoreScreen } from './src/screens/StoreScreen';
import { AchievementsScreen } from './src/screens/AchievementsScreen';
import { LeaderboardScreen } from './src/screens/LeaderboardScreen';
import { GlobalChatScreen } from './src/screens/GlobalChatScreen';
import { TournamentsScreen } from './src/screens/TournamentsScreen';
import { Match, Profile } from './src/types';
import { supabase } from './src/lib/supabase';
import { sounds } from './src/lib/sounds';
import { offlineSync, generateUUID, isValidUUID, SyncStatus } from './src/lib/offlineSync';
import { realtimeManager } from './src/lib/realtimeManager';
import { settleMatchBetsAndWagers, reconcileUserPendingBets } from './src/lib/bettingService';
import { fetchActiveWaitlist } from './src/lib/waitlistService';
import { initGraphifyBridge, updateGraphifyRuntimeState, registerGraphifyControllers } from './src/lib/graphifyBridge';

const theme = {
  colors: {
    primary: '#3b82f6',
    card: '#1e293b',
    cardBorder: '#334155',
  },
  borderRadius: {
    m: 12,
  }
};

type ScreenState = 'splash' | 'ad' | 'auth' | 'home' | 'setup' | 'game' | 'live' | 'profile' | 'store' | 'achievements' | 'leaderboard' | 'global_chat' | 'tournaments';

const checkIsPasswordRecovery = (): boolean => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      return (
        hash.includes('type=recovery') ||
        search.includes('type=recovery') ||
        (hash.includes('access_token') && hash.includes('type=recovery'))
      );
    } catch {
      return false;
    }
  }
  return false;
};

const AD_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutos de tiempo mínimo entre publicidades

const shouldShowAd = async (): Promise<boolean> => {
  try {
    let lastAd = await AsyncStorage.getItem('@domino_last_ad_timestamp');
    if (!lastAd && Platform.OS === 'web' && typeof window !== 'undefined') {
      lastAd = window.localStorage.getItem('@domino_last_ad_timestamp');
    }
    if (!lastAd) return true; // Primera vez
    const lastTime = parseInt(lastAd, 10);
    if (isNaN(lastTime)) return true;
    return (Date.now() - lastTime) > AD_COOLDOWN_MS;
  } catch {
    return false;
  }
};

const markAdShown = async () => {
  try {
    const now = Date.now().toString();
    await AsyncStorage.setItem('@domino_last_ad_timestamp', now);
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.localStorage.setItem('@domino_last_ad_timestamp', now);
    }
  } catch (e) {
    console.warn('Error saving ad timestamp:', e);
  }
};

const getInitialScreen = (): ScreenState => {
  if (checkIsPasswordRecovery()) {
    return 'auth';
  }
  // La publicidad NUNCA debe ser la pantalla de inicio del historial para evitar retrocesos a anuncios
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      const seen = window.localStorage.getItem('@domino_onboarding_seen') || window.localStorage.getItem('domino_onboarding_seen');
      if (seen === '1') {
        return 'auth';
      }
    } catch {
      // ignore
    }
  }
  return 'splash';
};

export default function App() {
  const isRecoveryInitial = checkIsPasswordRecovery();
  const isPasswordRecoveryRef = useRef(isRecoveryInitial);
  const [currentScreen, setCurrentScreen] = useState<ScreenState>(getInitialScreen);
  const [match, setMatch] = useState<Match | null>(null);
  const [session, setSession] = useState<any>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(isRecoveryInitial);
  const [currentUserProfileId, setCurrentUserProfileId] = useState<string | null>(null);
  // Refs read by the popstate handler, which is registered once
  const sessionRef = useRef<any>(null);
  sessionRef.current = session;
  const currentUserProfileIdRef = useRef<string | null>(null);
  currentUserProfileIdRef.current = currentUserProfileId;
  const [liveMatchId, setLiveMatchId] = useState<string | null>(null);
  const [viewProfileId, setViewProfileId] = useState<string | null>(null);
  const [waitlistSetup, setWaitlistSetup] = useState<{ waitlistId: string, team1: Profile[], team2: Profile[] } | null>(null);
  const [isVersionValid, setIsVersionValid] = useState<boolean | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(offlineSync.getStatus());

  // In-App Toast State
  const [toastMsg, setToastMsg] = useState<{name: string, text: string, color?: string} | null>(null);
  // Global chat as an overlay during a match, so the game screen stays mounted
  const [chatOverlayOpen, setChatOverlayOpen] = useState(false);
  useEffect(() => {
    // Leaving the game by any route (swipe/back button) must close the overlay, or toasts stay muted
    if (currentScreen !== 'game') setChatOverlayOpen(false);
  }, [currentScreen]);
  const [initialInviteCode, setInitialInviteCode] = useState<string | null>(null);
  const [waitlistCall, setWaitlistCall] = useState<{
    p1Name: string;
    p2Name: string;
    callerName: string;
    timeLeft: number;
  } | null>(null);
  const toastAnim = useRef(new Animated.Value(-100)).current;
  const toastTimeout = useRef<NodeJS.Timeout | null>(null);

  const showToast = useCallback((name: string, text: string, color?: string, durationMs = 4500) => {
    setToastMsg({ name, text, color: color || theme.colors.primary });
    Animated.spring(toastAnim, {
      toValue: Platform.OS === 'ios' ? 60 : 40,
      useNativeDriver: true,
      bounciness: 12,
    }).start();

    if (toastTimeout.current) clearTimeout(toastTimeout.current);
    toastTimeout.current = setTimeout(() => {
      Animated.timing(toastAnim, {
        toValue: -150,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setToastMsg(null));
    }, durationMs);
  }, [toastAnim]);

  useEffect(() => {
    offlineSync.init();
    initGraphifyBridge();
    const unsub = offlineSync.subscribe(setSyncStatus);
    return () => unsub();
  }, []);

  useEffect(() => {
    updateGraphifyRuntimeState({
      currentScreen,
      currentUserProfileId,
      currentUserDisplayName: currentUserProfile?.display_name || null,
      isAdmin: Boolean(currentUserProfile?.is_admin),
      isAuthenticated,
      isGuestMode,
      activeMatchId: match?.id || null,
      liveMatchId,
    });
  }, [currentScreen, currentUserProfileId, currentUserProfile, isAuthenticated, isGuestMode, match?.id, liveMatchId]);

  const markOnboardingSeen = async () => {
    try {
      await AsyncStorage.setItem('@domino_onboarding_seen', '1');
      await AsyncStorage.setItem('domino_onboarding_seen', '1');
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.localStorage.setItem('@domino_onboarding_seen', '1');
        window.localStorage.setItem('domino_onboarding_seen', '1');
      }
    } catch (e) {
      console.warn('Error saving onboarding seen:', e);
    }
  };

  const fetchCurrentUser = async (id: string) => {
    setCurrentUserProfileId(id);
    setIsAuthenticated(true);

    // Self-healing: resolve any pending bets on completed matches for this user
    reconcileUserPendingBets(id).then((res) => {
      if (res.newlyWonBets > 0 && res.totalPointsCredited > 0) {
        sounds.playSound('chaching');
        showToast(
          '🎉 ¡Apuesta Ganada!',
          `Se acreditaron +${res.totalPointsCredited} pts a tu saldo por tus apuestas ganadas.`,
          '#10b981',
          6000
        );
      }
    });

    // Fast path: check cached profile first so UI renders immediately even offline
    const cachedMap = offlineSync.getCachedProfileMapSync();
    if (cachedMap[id]) {
      setCurrentUserProfile(cachedMap[id]);
    }

    try {
      const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
      if (data) {
        let isAdmin = (data as Profile).is_admin || false;
        try {
          let adminOverride = await AsyncStorage.getItem('@domino_admin_override');
          if (!adminOverride && Platform.OS === 'web' && typeof window !== 'undefined') {
            adminOverride = window.localStorage.getItem('@domino_admin_override');
          }
          if (adminOverride === 'true') {
            isAdmin = true;
          }
        } catch (e) {
          // ignore
        }
        const enriched = { ...(data as Profile), is_admin: isAdmin };
        setCurrentUserProfile(enriched);
        offlineSync.updateCachedProfile(enriched);
      }
    } catch (e) {
      // Offline fallback: cached profile already set if available
    }
  };

  // Navegación centralizada sincronizada con el historial del navegador / PWA
  const navigate = useCallback((
    screen: ScreenState,
    extra?: { viewProfileId?: string | null; liveMatchId?: string | null; replace?: boolean }
  ) => {
    if (extra?.viewProfileId !== undefined) {
      setViewProfileId(extra.viewProfileId);
    }
    if (extra?.liveMatchId !== undefined) {
      setLiveMatchId(extra.liveMatchId);
    }
    setCurrentScreen(screen);

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      // NUNCA empujar 'ad' al historial del navegador
      if (screen === 'ad') return;

      const stateObj = {
        screen,
        viewProfileId: extra?.viewProfileId !== undefined ? extra.viewProfileId : viewProfileId,
        liveMatchId: extra?.liveMatchId !== undefined ? extra.liveMatchId : liveMatchId,
      };
      if (extra?.replace) {
        window.history.replaceState(stateObj, '', `#${screen}`);
      } else {
        window.history.pushState(stateObj, '', `#${screen}`);
      }
    }
  }, [viewProfileId, liveMatchId]);

  useEffect(() => {
    registerGraphifyControllers({
      navigate: (s: ScreenState, opts) => navigate(s, opts),
      triggerToast: (msg) => showToast(msg.name, msg.text, msg.color),
      triggerWaitlistCall: (callData) =>
        setWaitlistCall({
          p1Name: callData.p1Name,
          p2Name: callData.p2Name,
          callerName: callData.callerName,
          timeLeft: callData.timeLeft,
        }),
    });
  }, [navigate, showToast]);

  // Retroceso inteligente para botón Volver, gesto swipe-back y botón físico Atrás
  const navigateBack = useCallback(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      if (window.history.length > 1 && window.location.hash && window.location.hash !== '#home') {
        window.history.back();
        return;
      }
    }

    if (currentScreen === 'profile' && viewProfileId && viewProfileId !== currentUserProfileId) {
      navigate('leaderboard');
      return;
    }
    if (currentScreen === 'game' && match?.tournament_id) {
      navigate('tournaments');
      return;
    }
    if (['game', 'setup', 'live', 'profile', 'store', 'achievements', 'leaderboard', 'global_chat', 'tournaments'].includes(currentScreen)) {
      if (currentScreen === 'profile' && currentUserProfileId) {
        fetchCurrentUser(currentUserProfileId);
      }
      navigate('home');
      return;
    }
  }, [currentScreen, viewProfileId, currentUserProfileId, match, navigate]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.title = 'PeSiMistas';
      try {
        if (checkIsPasswordRecovery()) {
          isPasswordRecoveryRef.current = true;
          setIsPasswordRecovery(true);
          setCurrentScreen('auth');
        }
        const searchParams = new URLSearchParams(window.location.search);
        const invite = searchParams.get('invite') || searchParams.get('ref') || searchParams.get('code');
        if (invite) {
          setInitialInviteCode(invite.toUpperCase());
          setCurrentScreen('auth');
        }
      } catch (e) {
        console.warn('Error reading URL params', e);
      }
    }

    const checkOnboardingAndNavigate = async (activeSession: any) => {
      try {
        // 1. Si viene por enlace de recuperación de contraseña, ir directo a auth
        if (isPasswordRecoveryRef.current || checkIsPasswordRecovery()) {
          isPasswordRecoveryRef.current = true;
          setIsPasswordRecovery(true);
          setCurrentScreen('auth');
          return;
        }

        // 2. Si el usuario ya está autenticado y no está restableciendo clave, ir a app o ad si corresponde por tiempo
        if (activeSession && !isPasswordRecoveryRef.current) {
          markOnboardingSeen();
          const showAd = await shouldShowAd();
          if (showAd) {
            setCurrentScreen('ad');
          } else {
            setCurrentScreen(match?.status === 'active' ? 'game' : 'home');
          }
          return;
        }

        // 3. Revisar si ya vio el onboarding
        let hasSeen: string | null = null;
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          try {
            hasSeen = window.localStorage.getItem('@domino_onboarding_seen') || window.localStorage.getItem('domino_onboarding_seen');
          } catch {}
        }
        if (!hasSeen) {
          hasSeen = await AsyncStorage.getItem('@domino_onboarding_seen');
        }
        if (!hasSeen) {
          hasSeen = await AsyncStorage.getItem('domino_onboarding_seen');
        }

        if (hasSeen === '1') {
          const showAd = await shouldShowAd();
          if (showAd) {
            setCurrentScreen('ad');
          } else {
            setCurrentScreen('auth');
          }
        } else {
          setCurrentScreen('splash');
        }
      } catch (e) {
        console.warn('Error reading onboarding status', e);
        setCurrentScreen('auth');
      }
    };

    const fallbackTimer = setTimeout(async () => {
      await checkOnboardingAndNavigate(session);
      setSessionChecked(true);
    }, 1200);

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      clearTimeout(fallbackTimer);
      setSession(session);
      if (session && !isPasswordRecoveryRef.current) {
        fetchCurrentUser(session.user.id);
      }
      await checkOnboardingAndNavigate(session);
      setSessionChecked(true);
    }).catch(async (err) => {
      clearTimeout(fallbackTimer);
      console.warn('Session error:', err);
      await checkOnboardingAndNavigate(null);
      setSessionChecked(true);
    });

    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        isPasswordRecoveryRef.current = true;
        setIsPasswordRecovery(true);
        setCurrentScreen('auth');
      } else if (session) {
        if (!isPasswordRecoveryRef.current) {
          fetchCurrentUser(session.user.id);
          markOnboardingSeen();
        }
      } else {
        if (!isPasswordRecoveryRef.current) {
          setCurrentScreen('auth');
        }
        setCurrentUserProfileId(null);
      }
    });

    // Preload sounds & warm up profile cache
    sounds.preloadSounds();
    offlineSync.getProfiles(false);

    // Request Web Push Notification permissions on load
    if (Platform.OS === 'web' && 'Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    return () => {
      authListener?.unsubscribe();
      sounds.unloadAll();
    };
  }, []);

  // Global Chat In-App Notification & Realtime Profile Points Sync
  useEffect(() => {
    if (!session?.user) return;

    const channel = supabase.channel(`app_global_toast_${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'global_chat' }, async payload => {
        if (payload.new.user_id === session.user.id) return;

        const cachedMap = offlineSync.getCachedProfileMapSync();
        let profile: any = cachedMap[payload.new.user_id];
        if (!profile) {
          const { data } = await supabase.from('profiles').select('display_name, equipped_items').eq('id', payload.new.user_id).single();
          profile = data;
        }
        if (profile) {
          const color = profile.equipped_items?.color === 'rainbow' ? '#ec4899' : (profile.equipped_items?.color || theme.colors.primary);
          showToast(profile.display_name, payload.new.message, color, 4000);
          
          if (Platform.OS === 'web' && 'Notification' in window) {
            if (Notification.permission === 'granted') {
              new Notification('Nuevo mensaje en Dominó', {
                body: `${profile.display_name}: ${payload.new.message}`,
                icon: '/assets/favicon.png'
              });
            } else if (Notification.permission !== 'denied') {
              Notification.requestPermission();
            }
          }
        }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` }, payload => {
        if (payload.new) {
          setCurrentUserProfile(prev => prev ? { ...prev, ...(payload.new as Profile), is_admin: prev.is_admin || (payload.new as Profile).is_admin } : (payload.new as Profile));
          offlineSync.updateCachedProfile(payload.new as Profile);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, showToast]);

  // Waitlist Call Realtime Broadcast & Countdown via singleton realtimeManager
  useEffect(() => {
    const unsubCall = realtimeManager.onCallDuo((data) => {
      if (!data) return;
      const isCalled = currentUserProfileId && (currentUserProfileId === data.p1Id || currentUserProfileId === data.p2Id);
      if (isCalled) {
        sounds.playSound('slap');
        if (Platform.OS === 'web' && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('🚨 ¡A LA MESA! Tu dúo ha sido llamado', {
              body: `${data.callerName} te ha llamado a la mesa. ¡Tienes 30 segundos!`,
              icon: '/favicon.ico'
            });
          } catch (e) {
            console.warn('Notif error', e);
          }
        }

        setWaitlistCall({
          p1Name: data.p1Name,
          p2Name: data.p2Name,
          callerName: data.callerName,
          timeLeft: 30
        });
      }
    });

    const unsubProximity = realtimeManager.onProximityAlert(async (data) => {
      if (!data || !currentUserProfileId) return;
      try {
        const queue = await fetchActiveWaitlist();
        if (queue && queue.length > 0) {
          const nextDuo = queue[0];
          if (currentUserProfileId === nextDuo.player1_id || currentUserProfileId === nextDuo.player2_id) {
            sounds.playSound('pop');
            showToast(
              '⏳ ¡Casi es su turno!',
              `La partida actual va por ${data.highestScore}/${data.limitScore} pts. Quedan ~${data.pointsLeft} pts para que jueguen. ¡Vayan preparándose!`,
              '#f59e0b',
              6000
            );

            if (Platform.OS === 'web' && 'Notification' in window && Notification.permission === 'granted') {
              try {
                new Notification('⏳ ¡Casi es su turno en Dominó!', {
                  body: `La partida en la mesa va por ${data.highestScore}/${data.limitScore} pts. ¡Prepárense para entrar!`,
                  icon: '/favicon.ico'
                });
              } catch (e) {
                console.warn('Notif error', e);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error handling proximity alert:', err);
      }
    });

    return () => {
      unsubCall();
      unsubProximity();
    };
  }, [currentUserProfileId, showToast]);

  useEffect(() => {
    if (!waitlistCall) return;
    if (waitlistCall.timeLeft <= 0) {
      setWaitlistCall(null);
      return;
    }
    const timer = setTimeout(() => {
      setWaitlistCall(prev => prev ? { ...prev, timeLeft: prev.timeLeft - 1 } : null);
    }, 1000);
    return () => clearTimeout(timer);
  }, [waitlistCall]);



  // Version Check
  useEffect(() => {
    const checkVersion = async () => {
      try {
        const { data } = await supabase.from('system_config').select('min_app_version').eq('id', 1).single();
        if (data && data.min_app_version) {
          const currentVer = Constants.expoConfig?.version || '1.0.8';
          const currentParts = currentVer.split('.').map(Number);
          const minParts = data.min_app_version.split('.').map(Number);
          
          let isValid = true;
          for (let i = 0; i < Math.max(currentParts.length, minParts.length); i++) {
            const curr = currentParts[i] || 0;
            const min = minParts[i] || 0;
            if (curr > min) break;
            if (curr < min) { isValid = false; break; }
          }
          setIsVersionValid(isValid);
        } else {
          setIsVersionValid(true);
        }
      } catch (err) {
        setIsVersionValid(true);
      }
    };
    checkVersion();
  }, []);

  useEffect(() => {
    const loadState = async () => {
      try {
        const savedMatch = await AsyncStorage.getItem('@domino_match');
        if (savedMatch) {
          setMatch(JSON.parse(savedMatch));
        }
      } catch (e) {
        console.error('Failed to load match', e);
      }
    };
    loadState();
  }, []);

  useEffect(() => {
    const saveState = async () => {
      try {
        if (match) {
          await AsyncStorage.setItem('@domino_match', JSON.stringify(match));
        } else {
          await AsyncStorage.removeItem('@domino_match');
        }
      } catch (e) {
        console.error('Failed to save match', e);
      }
    };
    saveState();
  }, [match]);

  // 1. Sincronización de eventos de retroceso Web / PWA (gesto swipe-back y botón atrás del navegador)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    // Inicializar el estado de base asegurando que 'home' sea el ancla
    window.history.replaceState({ screen: 'home_base' }, '', '#home');
    const initScreen = getInitialScreen();
    if (initScreen !== 'home' && initScreen !== 'ad') {
      window.history.pushState({ screen: initScreen }, '', `#${initScreen}`);
    } else {
      window.history.pushState({ screen: 'home' }, '', '#home');
    }

    // Si la URL traía hash '#ad' o '#splash', limpiarlo inmediatamente
    if (window.location.hash === '#ad' || window.location.hash === '#splash') {
      window.history.replaceState({ screen: 'home' }, '', '#home');
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state && state.screen) {
        // La publicidad, splash y base NUNCA deben abrirse al retroceder,
        // y con sesión iniciada tampoco el login
        const isLoginEntry = (state.screen === 'auth' || state.screen === 'splash') && !!sessionRef.current && !isPasswordRecoveryRef.current;
        if (state.screen === 'ad' || state.screen === 'splash' || state.screen === 'home_base' || isLoginEntry) {
          window.history.replaceState({ screen: 'home' }, '', '#home');
          setCurrentScreen('home');
          setViewProfileId(null);
          setLiveMatchId(null);
          return;
        }

        setCurrentScreen(state.screen);
        if (state.viewProfileId !== undefined) setViewProfileId(state.viewProfileId);
        if (state.liveMatchId !== undefined) setLiveMatchId(state.liveMatchId);

        if (state.screen === 'profile' && currentUserProfileIdRef.current) {
          fetchCurrentUser(currentUserProfileIdRef.current);
        }
      } else {
        // Si no hay state, volver a Home de forma segura sin salir de la página
        setCurrentScreen('home');
        setViewProfileId(null);
        setLiveMatchId(null);
        window.history.replaceState({ screen: 'home' }, '', '#home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
    // Run once: re-running on login used to push extra '#auth' entries into the history
  }, []);

  // 2. Manejo de botón físico Atrás en Android nativo
  useEffect(() => {
    const onBackPress = () => {
      if (['game', 'setup', 'live', 'profile', 'store', 'achievements', 'leaderboard', 'global_chat', 'tournaments'].includes(currentScreen)) {
        navigateBack();
        return true;
      }
      return false;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [currentScreen, navigateBack]);

  if (isVersionValid === false) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
        <StatusBar barStyle="light-content" />
        <Text style={{ fontSize: 64, marginBottom: 24 }}>🛡️</Text>
        <Text style={{ fontSize: 28, fontWeight: 'bold', color: '#ef4444', textAlign: 'center', marginBottom: 16 }}>
          Actualización Obligatoria
        </Text>
        <Text style={{ fontSize: 18, color: '#f8fafc', textAlign: 'center', opacity: 0.9, lineHeight: 26 }}>
          Por favor, actualiza la aplicación.
        </Text>
      </View>
    );
  }

  const isSupabaseId = (id: string) => isValidUUID(id);

  const handleStartMatch = async (matchConfig: Omit<Match, 'id' | 'rounds' | 'status'>, waitlistId?: string) => {
    let matchId = generateUUID();

    const newMatch: Match = {
      ...matchConfig,
      id: matchId,
      rounds: [],
      status: 'active',
    };

    if (!matchConfig.isGuestMode && isAuthenticated) {
      const team1Players = matchConfig.players.filter(p => p.teamNumber === 1);
      const team2Players = matchConfig.players.filter(p => p.teamNumber === 2);
      const getValidId = (id?: string) => id && !id.startsWith('guest-') ? id : null;

      await offlineSync.syncActiveMatch({
        id: matchId,
        status: 'active',
        game_mode: matchConfig.gameMode,
        limit_score: matchConfig.limitScore,
        rounds: [],
        team1_total: 0,
        team2_total: 0,
        winner_team: null,
        is_zapato: false,
        players_json: matchConfig.players,
        substitutions: [],
        team1_player1: getValidId(team1Players[0]?.profileId),
        team1_player2: getValidId(team1Players[1]?.profileId),
        team2_player1: getValidId(team2Players[0]?.profileId),
        team2_player2: getValidId(team2Players[1]?.profileId),
        wager_amount: matchConfig.wager_amount || 0,
        is_wager_match: matchConfig.is_wager_match || false,
        tournament_id: matchConfig.tournament_id || null,
      });
    }

    if (waitlistId && isAuthenticated) {
      if (offlineSync.getIsOnline()) {
        supabase.from('waitlist').update({ status: 'playing' }).eq('id', waitlistId).then(() => {
          realtimeManager.notifyWaitlistRefresh();
        });
      }
    }

    setWaitlistSetup(null);
    setMatch(newMatch);
    navigate('game');
  };

  const handleRejoinMatch = (matchData: any) => {
    const rejoinedMatch: Match = {
      id: matchData.id,
      gameMode: matchData.game_mode,
      limitScore: matchData.limit_score,
      players: matchData.players_json || [],
      rounds: matchData.rounds || [],
      substitutions: matchData.substitutions || [],
      status: 'active',
      isGuestMode: false,
      tournament_id: matchData.tournament_id,
      is_wager_match: matchData.is_wager_match,
      wager_amount: matchData.wager_amount,
    };
    setMatch(rejoinedMatch);
    navigate('game');
  };

  const handleUpdateMatch = async (updatedMatch: Match, fromRemote: boolean = false) => {
    const totals: Record<string, number> = { team1: 0, team2: 0 };
    updatedMatch.rounds.forEach(r => {
      if (r.scorerId === 'team1') totals.team1 += r.points;
      else if (r.scorerId === 'team2') totals.team2 += r.points;
    });

    let newStatus = updatedMatch.status;
    let winnerTeam: number | null = null;
    let isZapato = false;

    if (totals.team1 >= updatedMatch.limitScore) {
      newStatus = 'completed';
      winnerTeam = 1;
      isZapato = totals.team2 === 0;
    } else if (totals.team2 >= updatedMatch.limitScore) {
      newStatus = 'completed';
      winnerTeam = 2;
      isZapato = totals.team1 === 0;
    } else {
      newStatus = 'active';
    }

    const matchToSave: Match = { ...updatedMatch, status: newStatus };
    setMatch(matchToSave);

    if (fromRemote) {
      return;
    }

    if (!updatedMatch.isGuestMode && isAuthenticated && isSupabaseId(updatedMatch.id)) {
      const team1Players = matchToSave.players.filter(p => p.teamNumber === 1);
      const team2Players = matchToSave.players.filter(p => p.teamNumber === 2);
      const getValidId = (id?: string) => id && !id.startsWith('guest-') ? id : null;

      // Broadcast instant update (<100ms) to spectators and other devices
      realtimeManager.broadcastMatchUpdate(matchToSave.id, {
        id: matchToSave.id,
        status: newStatus,
        winner_team: winnerTeam,
        is_zapato: isZapato,
        rounds: matchToSave.rounds,
        players_json: matchToSave.players,
        substitutions: matchToSave.substitutions || [],
        team1_total: totals.team1,
        team2_total: totals.team2,
      });

      await offlineSync.syncActiveMatch({
        id: matchToSave.id,
        status: newStatus,
        game_mode: matchToSave.gameMode,
        limit_score: matchToSave.limitScore,
        winner_team: winnerTeam,
        is_zapato: isZapato,
        rounds: matchToSave.rounds,
        players_json: matchToSave.players,
        substitutions: matchToSave.substitutions || [],
        team1_total: totals.team1,
        team2_total: totals.team2,
        team1_player1: getValidId(team1Players[0]?.profileId),
        team1_player2: getValidId(team1Players[1]?.profileId),
        team2_player1: getValidId(team2Players[0]?.profileId),
        team2_player2: getValidId(team2Players[1]?.profileId),
        wager_amount: matchToSave.wager_amount || 0,
        is_wager_match: matchToSave.is_wager_match || false,
        tournament_id: matchToSave.tournament_id || null,
      });

      // If match reached limitScore automatically, settle bets & wagers immediately so winners get paid even if host closes tab
      if (newStatus === 'completed' && winnerTeam !== null && offlineSync.getIsOnline()) {
        settleMatchBetsAndWagers({
          matchId: matchToSave.id,
          winnerTeam,
          isWagerMatch: matchToSave.is_wager_match,
          wagerAmount: matchToSave.wager_amount,
          team1Player1: getValidId(team1Players[0]?.profileId),
          team1Player2: getValidId(team1Players[1]?.profileId),
          team2Player1: getValidId(team2Players[0]?.profileId),
          team2Player2: getValidId(team2Players[1]?.profileId),
        }).catch(err => console.warn('[App] Background bet settlement warning:', err));
      }
    }
  };

  const handleEndMatch = async (winnerId: string) => {
    if (match) {
      const updatedMatch: Match = { ...match, status: 'completed' };
      setMatch(updatedMatch);

      if (!isGuestMode && isAuthenticated) {
        try {
          let isZapato = false;
          const totals: Record<string, number> = {};
          updatedMatch.players.forEach(p => {
            const key = updatedMatch.gameMode === 'teams' ? `team${p.teamNumber}` : p.id;
            totals[key] = 0;
          });
          updatedMatch.rounds.forEach(r => {
            if (totals[r.scorerId] !== undefined) {
              totals[r.scorerId] += r.points;
            }
          });

          if (updatedMatch.gameMode === 'teams' && winnerId !== 'null') {
            const loserKey = winnerId === 'team1' ? 'team2' : 'team1';
            if (totals[loserKey] === 0) isZapato = true;
          }

          const winnerTeam = winnerId === 'team1' ? 1 : (winnerId === 'team2' ? 2 : null);
          const getValidId = (id?: string) => id && !id.startsWith('guest-') ? id : null;

          let finalPlayers = [...updatedMatch.players];
          if (updatedMatch.substitutions) {
            const reversedSubs = [...updatedMatch.substitutions].reverse();
            reversedSubs.forEach(sub => {
              if (sub.teamScoreAtSub >= 50) {
                const pIndex = finalPlayers.findIndex(p => p.id === sub.originalId);
                if (pIndex >= 0) {
                  finalPlayers[pIndex] = { ...finalPlayers[pIndex], profileId: sub.originalProfileId };
                }
              }
            });
          }

          const team1P1 = getValidId(finalPlayers.find(p => p.teamNumber === 1)?.profileId);
          const team1P2 = getValidId(finalPlayers.filter(p => p.teamNumber === 1)[1]?.profileId);
          const team2P1 = getValidId(finalPlayers.find(p => p.teamNumber === 2)?.profileId);
          const team2P2 = getValidId(finalPlayers.filter(p => p.teamNumber === 2)[1]?.profileId);

          let finalMatchId = isSupabaseId(updatedMatch.id) ? updatedMatch.id : generateUUID();

          const completePayload = {
            id: finalMatchId,
            status: 'completed' as const,
            game_mode: updatedMatch.gameMode,
            limit_score: updatedMatch.limitScore,
            rounds: updatedMatch.rounds,
            team1_total: totals['team1'] || 0,
            team2_total: totals['team2'] || 0,
            winner_team: winnerTeam,
            is_zapato: isZapato,
            players_json: updatedMatch.players,
            substitutions: updatedMatch.substitutions || [],
            team1_player1: team1P1,
            team1_player2: team1P2,
            team2_player1: team2P1,
            team2_player2: team2P2,
            wager_amount: updatedMatch.wager_amount || 0,
            is_wager_match: updatedMatch.is_wager_match || false,
            tournament_id: updatedMatch.tournament_id || null,
          };

          if (!offlineSync.getIsOnline()) {
            await offlineSync.enqueueMatchComplete(completePayload);
            setMatch(null);
            navigate('home', { replace: true });
            return;
          }

          const { error: upsertErr } = await supabase.from('matches').upsert({
            id: completePayload.id,
            status: 'completed',
            game_mode: completePayload.game_mode,
            limit_score: completePayload.limit_score,
            rounds: completePayload.rounds,
            team1_total: completePayload.team1_total,
            team2_total: completePayload.team2_total,
            winner_team: completePayload.winner_team,
            is_zapato: completePayload.is_zapato,
            players_json: completePayload.players_json,
            substitutions: completePayload.substitutions,
            team1_player1: completePayload.team1_player1,
            team1_player2: completePayload.team1_player2,
            team2_player1: completePayload.team2_player1,
            team2_player2: completePayload.team2_player2,
            wager_amount: completePayload.wager_amount,
            is_wager_match: completePayload.is_wager_match,
            tournament_id: completePayload.tournament_id,
          }, { onConflict: 'id' });

          if (upsertErr) {
            await offlineSync.enqueueMatchComplete(completePayload);
          } else {
            await settleMatchBetsAndWagers({
              matchId: finalMatchId,
              winnerTeam,
              isWagerMatch: updatedMatch.is_wager_match,
              wagerAmount: updatedMatch.wager_amount,
              team1Player1: team1P1,
              team1Player2: team1P2,
              team2Player1: team2P1,
              team2Player2: team2P2,
            });
          }

          if (isSupabaseId(finalMatchId)) {
            try {
              await supabase.rpc('update_player_streaks_for_match', { 
                p_match_id: finalMatchId 
              });
            } catch (rpcErr) {
              console.error('Error updating streaks via RPC:', rpcErr);
            }
            
            // Tournament brackets advance on the server (tr_advance_tournament) when the match is saved
            // as completed; here we only tell the players what happened
            if (completePayload.tournament_id && !upsertErr) {
              try {
                const { data: t } = await supabase.from('tournaments').select('status, prize_paid, prize_pool, tournament_type').eq('id', completePayload.tournament_id).single();
                const { data: bracket } = await supabase.from('tournament_brackets').select('round_number').eq('live_match_id', finalMatchId).maybeSingle();
                if (t?.status === 'completed') {
                  let prizeMsg = 'El torneo ha concluido exitosamente.';
                  if (t.prize_paid && Number(t.prize_pool) > 0 && t.tournament_type !== 'vip_cash') prizeMsg += ' El premio ya se pagó a los campeones.';
                  Alert.alert('🏆 ¡Torneo Finalizado!', prizeMsg);
                } else if (bracket) {
                  const { count } = await supabase.from('tournament_brackets').select('id', { count: 'exact', head: true })
                    .eq('tournament_id', completePayload.tournament_id).eq('round_number', bracket.round_number + 1);
                  if (count && count > 0) {
                    Alert.alert('¡Siguiente Ronda!', `La Ronda ${bracket.round_number + 1} del torneo ha sido generada automáticamente.`);
                  }
                }
              } catch (err) {
                console.error('Error reading tournament progress:', err);
              }
            }
          }

          if (isZapato) {
            const winners = winnerTeam === 1 ? [team1P1, team1P2] : [team2P1, team2P2];
            // The server counts zapatos given and grants the badge (clients can't write achievements)
            for (const wid of winners) {
              if (!wid) continue;
              const { data: awarded } = await supabase.rpc('award_zapatero_maestro', { p_user_id: wid });
              if (awarded && wid === currentUserProfileId) Alert.alert('🏆 Logro Desbloqueado', 'Zapatero Maestro: ¡Has dado 3 zapatos!');
            }
          }

        } catch (err) {
          console.error('Failed to save match to Supabase:', err);
        }

        // Tournament matches go back to the bracket, not to the club's waitlist
        if (updatedMatch.gameMode === 'teams' && !updatedMatch.tournament_id) {
          const winnerTeamNumber = winnerId === 'team1' ? 1 : 2;
          const winnerPlayers = updatedMatch.players.filter(p => p.teamNumber === winnerTeamNumber);
          const winnerProfileIds = winnerPlayers.map(p => p.profileId).filter(Boolean) as string[];

          if (winnerProfileIds.length === 2 && offlineSync.getIsOnline()) {
            try {
              const { data: waitlistData } = await supabase
                .from('waitlist')
                .select('*')
                .eq('status', 'waiting')
                .order('created_at', { ascending: true })
                .limit(1);

              if (waitlistData && waitlistData.length > 0) {
                const nextDuo = waitlistData[0];
                const profilesData = await offlineSync.getProfiles();
                if (profilesData && profilesData.length > 0) {
                  const pMap = Object.fromEntries(profilesData.map(p => [p.id, p]));
                  setWaitlistSetup({
                    waitlistId: nextDuo.id,
                    team1: [pMap[winnerProfileIds[0]], pMap[winnerProfileIds[1]]].filter(Boolean),
                    team2: [pMap[nextDuo.player1_id], pMap[nextDuo.player2_id]].filter(Boolean),
                  });
                  setMatch(null);
                  setCurrentScreen('setup');
                  return;
                }
              }
            } catch (err) {
              console.error('Error fetching waitlist transition', err);
            }
          }
        }
      }

      setMatch(null);
      if (isGuestMode) {
        navigate('setup', { replace: true });
      } else if (updatedMatch.tournament_id) {
        navigate('tournaments', { replace: true });
      } else {
        navigate('home', { replace: true });
      }
    }
  };

  const handleSeatWaitlistDuo = async (waitlistEntry: any) => {
    const profiles = await offlineSync.getProfiles();
    const pMap = Object.fromEntries(profiles.map(p => [p.id, p]));
    const p1 = waitlistEntry.player1 || pMap[waitlistEntry.player1_id];
    const p2 = waitlistEntry.player2 || pMap[waitlistEntry.player2_id];
    setWaitlistSetup({
      waitlistId: waitlistEntry.id,
      team1: [p1, p2].filter(Boolean),
      team2: [],
    });
    navigate('setup');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsAuthenticated(false);
    setIsGuestMode(false);
    setMatch(null);
    setCurrentUserProfileId(null);
    setCurrentUserProfile(null);
    navigate('auth', { replace: true });
  };

  if (!sessionChecked) {
    return (
      <View style={{ flex: 1, backgroundColor: '#07080a', justifyContent: 'center', alignItems: 'center' }}>
        <View style={{
          width: 88,
          height: 88,
          borderRadius: 22,
          overflow: 'hidden',
          backgroundColor: '#0a0d14',
          borderWidth: 2,
          borderColor: 'rgba(59, 130, 246, 0.4)',
          shadowColor: '#3b82f6',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.5,
          shadowRadius: 14,
          elevation: 8,
        }}>
          <Image
            source={require('./assets/icon.png')}
            style={[
              { width: '100%', height: '100%' },
              Platform.OS === 'web' ? ({ imageRendering: '-webkit-optimize-contrast' } as any) : {}
            ]}
            resizeMode="cover"
          />
        </View>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: 1, marginTop: 14 }}>PeSiMistas</Text>
      </View>
    );
  }

  return (
    <View style={styles.appWrapper}>
      <View style={styles.appContainer}>
        <StatusBar barStyle="light-content" backgroundColor="#000" />

        {/* Offline / Outbox Sync Banner */}
        {(!syncStatus.isOnline || syncStatus.pendingCount > 0) && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => {
              if (syncStatus.isOnline && syncStatus.pendingCount > 0) {
                offlineSync.flushQueue();
              }
            }}
            style={{
              backgroundColor: !syncStatus.isOnline ? '#b45309' : '#1d4ed8',
              paddingVertical: 6,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              zIndex: 9998,
              borderBottomWidth: 1,
              borderBottomColor: 'rgba(255,255,255,0.18)',
            }}
          >
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', flex: 1 }}>
              {!syncStatus.isOnline
                ? `📡 Modo Offline activo — Las partidas se guardan localmente (${syncStatus.pendingCount} en cola)`
                : syncStatus.isSyncing
                ? `🔄 Sincronizando ${syncStatus.pendingCount} cambio(s) con la base de datos...`
                : `☁️ ${syncStatus.pendingCount} partida(s) pendiente(s) por subir (Toca para sincronizar)`}
            </Text>
          </TouchableOpacity>
        )}

      {currentScreen === 'splash' && (
        <OnboardingScreen
          onComplete={async () => {
            await markOnboardingSeen();
            const showAd = await shouldShowAd();
            if (showAd) {
              setCurrentScreen('ad');
            } else {
              navigate(isAuthenticated ? (match?.status === 'active' ? 'game' : 'home') : 'auth', { replace: true });
            }
          }}
        />
      )}

      {currentScreen === 'ad' && (
        <SplashAdScreen
          onComplete={async () => {
            await markAdShown();
            if (isAuthenticated) {
              navigate(match?.status === 'active' ? 'game' : 'home', { replace: true });
            } else {
              navigate('auth', { replace: true });
            }
          }}
        />
      )}

      {currentScreen === 'auth' && (
        <AuthScreen
          onSessionConfigured={() => {
            isPasswordRecoveryRef.current = false;
            setIsPasswordRecovery(false);
            setIsAuthenticated(true);
            setIsGuestMode(false);
            setCurrentScreen(match?.status === 'active' ? 'game' : 'home');
          }}
          onGuestMode={() => {
            setIsGuestMode(true);
            setCurrentScreen('setup');
          }}
          inviteCode={initialInviteCode}
          initialRecoveryMode={isPasswordRecovery}
        />
      )}

      {currentScreen === 'home' && (
        <HomeScreen
          onNewMatch={() => navigate('setup')}
          onLogout={handleLogout}
          currentUserProfileId={currentUserProfileId}
          onWatchLiveMatch={(matchId: string) => {
            navigate('live', { liveMatchId: matchId });
          }}
          onOpenProfile={(profileId?: string) => {
            navigate('profile', { viewProfileId: profileId || null });
          }}
          onOpenStore={() => navigate('store')}
          onOpenAchievements={() => navigate('achievements')}
          onOpenLeaderboard={() => navigate('leaderboard')}
          onOpenGlobalChat={() => navigate('global_chat')}
          onRejoinMatch={handleRejoinMatch}
          onOpenTournaments={() => navigate('tournaments')}
          onSeatWaitlistDuo={handleSeatWaitlistDuo}
        />
      )}

      {currentScreen === 'setup' && (
        <SetupScreen
          onStartMatch={handleStartMatch}
          isGuestMode={isGuestMode}
          initialSlots={waitlistSetup ? [...waitlistSetup.team1, ...waitlistSetup.team2] : undefined}
          waitlistId={waitlistSetup?.waitlistId}
          onBack={() => {
            setWaitlistSetup(null);
            if (isGuestMode) {
              navigate('auth');
            } else {
              navigateBack();
            }
          }}
        />
      )}

      {currentScreen === 'game' && match && (
        <GameScreen
          match={match}
          onUpdateMatch={handleUpdateMatch}
          onEndMatch={handleEndMatch}
          currentUserProfileId={currentUserProfileId}
          isAdmin={currentUserProfile?.is_admin || false}
          onBack={navigateBack}
        />
      )}

      {currentScreen === 'live' && liveMatchId && (
        <LiveMatchScreen
          matchId={liveMatchId}
          currentUserProfileId={currentUserProfileId}
          onBack={navigateBack}
        />
      )}

      {currentScreen === 'profile' && (
        <ProfileScreen
          profileId={viewProfileId || currentUserProfileId || null}
          isOwnProfile={!viewProfileId || viewProfileId === currentUserProfileId}
          onAdminChanged={(newAdminStatus) => {
            if (currentUserProfileId) fetchCurrentUser(currentUserProfileId);
          }}
          onBack={navigateBack}
        />
      )}

      {currentScreen === 'store' && currentUserProfileId && (
        <StoreScreen
          currentUserProfileId={currentUserProfileId}
          onBack={navigateBack}
        />
      )}

      {currentScreen === 'achievements' && currentUserProfileId && (
        <AchievementsScreen
          currentUserProfileId={currentUserProfileId}
          onBack={navigateBack}
        />
      )}

      {currentScreen === 'global_chat' && currentUserProfileId && (
        <GlobalChatScreen
          currentUserProfileId={currentUserProfileId}
          onBack={navigateBack}
        />
      )}

      {currentScreen === 'leaderboard' && (
        <LeaderboardScreen
          onBack={navigateBack}
          currentUserProfileId={currentUserProfileId || ''}
          onOpenProfile={(profileId?: string) => {
            navigate('profile', { viewProfileId: profileId || null });
          }}
        />
      )}

      {currentScreen === 'tournaments' && (
        <TournamentsScreen
          onBack={navigateBack}
          profileId={currentUserProfileId}
          isAdmin={currentUserProfile?.is_admin || false}
          onWatchLiveMatch={(matchId) => {
            navigate('live', { liveMatchId: matchId });
          }}
          onRejoinMatch={handleRejoinMatch}
        />
      )}

      {/* Floating Global Chat button while playing */}
      {currentScreen === 'game' && currentUserProfileId && !chatOverlayOpen && (
        <TouchableOpacity
          style={styles.chatFab}
          onPress={() => setChatOverlayOpen(true)}
          accessibilityLabel="Abrir chat global"
        >
          <Text style={styles.chatFabIcon}>💬</Text>
        </TouchableOpacity>
      )}

      <Modal
        visible={chatOverlayOpen && currentScreen === 'game' && !!currentUserProfileId}
        animationType="slide"
        onRequestClose={() => setChatOverlayOpen(false)}
      >
        {currentUserProfileId && (
          <GlobalChatScreen
            currentUserProfileId={currentUserProfileId}
            onBack={() => setChatOverlayOpen(false)}
          />
        )}
      </Modal>

      {/* Global In-App Toast */}
      {toastMsg && currentScreen !== 'global_chat' && !chatOverlayOpen && (
        <Animated.View style={[styles.toastContainer, { transform: [{ translateY: toastAnim }] }]}>
          <TouchableOpacity 
            style={styles.toastContent} 
            activeOpacity={0.9} 
            onPress={() => {
              Animated.timing(toastAnim, { toValue: -150, duration: 200, useNativeDriver: true }).start(() => setToastMsg(null));
              if (currentScreen === 'game') {
                setChatOverlayOpen(true);
              } else {
                navigate('global_chat');
              }
            }}
          >
            <View style={styles.toastIconBg}>
              <Text style={styles.toastIcon}>💬</Text>
            </View>
            <View style={styles.toastTextContainer}>
              <Text style={[styles.toastTitle, { color: toastMsg.color }]} numberOfLines={1}>
                {toastMsg.name}
              </Text>
              <Text style={styles.toastMessage} numberOfLines={1}>{toastMsg.text}</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Urgent Waitlist Call Modal */}
      {waitlistCall && (
        <View style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.92)',
          zIndex: 99999,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}>
          <View style={{
            backgroundColor: '#111318',
            borderRadius: 24,
            padding: 24,
            width: '100%',
            maxWidth: 400,
            borderWidth: 2,
            borderColor: waitlistCall.timeLeft <= 10 ? '#ef4444' : '#f59e0b',
            alignItems: 'center',
            shadowColor: waitlistCall.timeLeft <= 10 ? '#ef4444' : '#f59e0b',
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.9,
            shadowRadius: 25,
            elevation: 20,
          }}>
            <Text style={{ fontSize: 48, marginBottom: 8 }}>🚨</Text>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 4 }}>
              ¡A LA MESA!
            </Text>
            <Text style={{ color: '#f59e0b', fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 16 }}>
              {waitlistCall.callerName} los ha llamado a la mesa
            </Text>

            <View style={{
              backgroundColor: 'rgba(255,255,255,0.05)',
              padding: 12,
              borderRadius: 12,
              width: '100%',
              alignItems: 'center',
              marginBottom: 16,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.1)'
            }}>
              <Text style={{ color: '#94a3b8', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
                Dúo Convocado
              </Text>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 4 }}>
                {waitlistCall.p1Name} & {waitlistCall.p2Name}
              </Text>
            </View>

            <View style={{
              width: 86,
              height: 86,
              borderRadius: 43,
              backgroundColor: waitlistCall.timeLeft <= 10 ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
              borderWidth: 3,
              borderColor: waitlistCall.timeLeft <= 10 ? '#ef4444' : '#f59e0b',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 16,
            }}>
              <Text style={{
                color: waitlistCall.timeLeft <= 10 ? '#ef4444' : '#f59e0b',
                fontSize: 34,
                fontWeight: '900',
              }}>
                {waitlistCall.timeLeft}
              </Text>
              <Text style={{ color: '#94a3b8', fontSize: 9, fontWeight: '700' }}>SEGUNDOS</Text>
            </View>

            <Text style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', marginBottom: 20, lineHeight: 16 }}>
              Preséntate de inmediato en la mesa del Cafetín o el turno pasará al siguiente dúo en la lista de espera.
            </Text>

            <TouchableOpacity
              style={{
                backgroundColor: '#2563eb',
                width: '100%',
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
                shadowColor: '#3b82f6',
                shadowOpacity: 0.8,
                shadowRadius: 12,
                elevation: 6,
              }}
              onPress={() => {
                sounds.playSound('chaching');
                setWaitlistCall(null);
                setCurrentScreen('home');
              }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>
                ¡VOY A LA MESA! 🏃💨
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  appWrapper: {
    flex: 1,
    backgroundColor: '#050608',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  appContainer: {
    flex: 1,
    width: '100%',
    maxWidth: 600,
    backgroundColor: '#0d0e12',
    position: 'relative',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 8,
  },
  chatFab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9998,
    elevation: 8,
  },
  chatFabIcon: {
    fontSize: 24,
  },
  toastContainer: {
    position: 'absolute',
    top: 0,
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 10,
  },
  toastContent: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.m,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  toastIconBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(59,130,246,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  toastIcon: {
    fontSize: 18,
  },
  toastTextContainer: {
    flex: 1,
  },
  toastTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  toastMessage: {
    color: '#fff',
    fontSize: 14,
  }
});
