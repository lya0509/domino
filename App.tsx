import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StatusBar, Alert, BackHandler, View, Text, Animated, TouchableOpacity, StyleSheet, Platform, Image } from 'react-native';
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
  const [liveMatchId, setLiveMatchId] = useState<string | null>(null);
  const [viewProfileId, setViewProfileId] = useState<string | null>(null);
  const [waitlistSetup, setWaitlistSetup] = useState<{ waitlistId: string, team1: Profile[], team2: Profile[] } | null>(null);
  const [isVersionValid, setIsVersionValid] = useState<boolean | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<Profile | null>(null);

  // In-App Toast State
  const [toastMsg, setToastMsg] = useState<{name: string, text: string, color?: string} | null>(null);
  const [initialInviteCode, setInitialInviteCode] = useState<string | null>(null);
  const [waitlistCall, setWaitlistCall] = useState<{
    p1Name: string;
    p2Name: string;
    callerName: string;
    timeLeft: number;
  } | null>(null);
  const toastAnim = useRef(new Animated.Value(-100)).current;
  const toastTimeout = useRef<NodeJS.Timeout | null>(null);

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
      setCurrentUserProfile({ ...(data as Profile), is_admin: isAdmin });
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

    // Preload sounds
    sounds.preloadSounds();

    // Request Web Push Notification permissions on load
    if (Platform.OS === 'web' && 'Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
      Notification.requestPermission();
    }

    return () => {
      authListener?.unsubscribe();
      sounds.unloadAll();
    };
  }, []);

  // Global Chat In-App Notification
  useEffect(() => {
    if (!session?.user) return;

    const channel = supabase.channel('app_global_toast')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'global_chat' }, async payload => {
        if (payload.new.user_id === session.user.id) return;

        const { data: profile } = await supabase.from('profiles').select('display_name, equipped_items').eq('id', payload.new.user_id).single();
        if (profile) {
          const color = profile.equipped_items?.color === 'rainbow' ? '#ec4899' : (profile.equipped_items?.color || theme.colors.primary);
          setToastMsg({ name: profile.display_name, text: payload.new.message, color });
          
          // Notificación Push para la Web (PWA)
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

          Animated.spring(toastAnim, {
            toValue: Platform.OS === 'ios' ? 60 : 40,
            useNativeDriver: true,
            bounciness: 12
          }).start();

          if (toastTimeout.current) clearTimeout(toastTimeout.current);

          toastTimeout.current = setTimeout(() => {
            Animated.timing(toastAnim, {
              toValue: -150,
              duration: 300,
              useNativeDriver: true
            }).start(() => setToastMsg(null));
          }, 4000);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session]);

  // Waitlist Call Realtime Broadcast & Countdown
  useEffect(() => {
    const channel = supabase.channel('domino_waitlist_calls')
      .on('broadcast', { event: 'call_duo' }, payload => {
        const data = payload.payload;
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
      })
      .on('broadcast', { event: 'proximity_alert' }, async payload => {
        const data = payload.payload;
        if (!data || !currentUserProfileId) return;

        try {
          const { data: queue } = await supabase
            .from('waitlist')
            .select('player1_id, player2_id')
            .eq('status', 'waiting')
            .order('created_at', { ascending: true })
            .limit(1);

          if (queue && queue.length > 0) {
            const nextDuo = queue[0];
            if (currentUserProfileId === nextDuo.player1_id || currentUserProfileId === nextDuo.player2_id) {
              sounds.playSound('pop');
              setToastMsg({
                name: '⏳ ¡Casi es su turno!',
                text: `La partida actual va por ${data.highestScore}/${data.limitScore} pts. Quedan ~${data.pointsLeft} pts para que jueguen. ¡Vayan preparándose!`,
                color: '#f59e0b'
              });

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

              Animated.spring(toastAnim, {
                toValue: Platform.OS === 'ios' ? 60 : 40,
                useNativeDriver: true,
                bounciness: 12
              }).start();

              if (toastTimeout.current) clearTimeout(toastTimeout.current);
              toastTimeout.current = setTimeout(() => {
                Animated.timing(toastAnim, {
                  toValue: -150,
                  duration: 300,
                  useNativeDriver: true
                }).start(() => setToastMsg(null));
              }, 6000);
            }
          }
        } catch (err) {
          console.error('Error handling proximity alert:', err);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentUserProfileId]);

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
        // La publicidad, splash y base NUNCA deben abrirse al retroceder
        if (state.screen === 'ad' || state.screen === 'splash' || state.screen === 'home_base') {
          window.history.replaceState({ screen: 'home' }, '', '#home');
          setCurrentScreen('home');
          setViewProfileId(null);
          setLiveMatchId(null);
          return;
        }

        setCurrentScreen(state.screen);
        if (state.viewProfileId !== undefined) setViewProfileId(state.viewProfileId);
        if (state.liveMatchId !== undefined) setLiveMatchId(state.liveMatchId);

        if (state.screen === 'profile' && currentUserProfileId) {
          fetchCurrentUser(currentUserProfileId);
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
  }, [currentUserProfileId]);

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

  const isSupabaseId = (id: string) => id && id.includes('-') && id.length > 30;

  const handleStartMatch = async (matchConfig: Omit<Match, 'id' | 'rounds' | 'status'>, waitlistId?: string) => {
    let matchId = Math.random().toString(36).substring(7);

    if (!matchConfig.isGuestMode && isAuthenticated) {
      try {
        const team1Players = matchConfig.players.filter(p => p.teamNumber === 1);
        const team2Players = matchConfig.players.filter(p => p.teamNumber === 2);

        const matchData: any = {
          status: 'active',
          game_mode: matchConfig.gameMode,
          limit_score: matchConfig.limitScore,
          rounds: [],
          team1_total: 0,
          team2_total: 0,
          players_json: matchConfig.players,
          wager_amount: matchConfig.wager_amount || 0,
          is_wager_match: matchConfig.is_wager_match || false,
          tournament_id: matchConfig.tournament_id || null,
        };

        const getValidId = (id?: string) => id && !id.startsWith('guest-') ? id : null;

        if (getValidId(team1Players[0]?.profileId)) matchData.team1_player1 = team1Players[0].profileId;
        if (getValidId(team1Players[1]?.profileId)) matchData.team1_player2 = team1Players[1].profileId;
        if (getValidId(team2Players[0]?.profileId)) matchData.team2_player1 = team2Players[0].profileId;
        if (getValidId(team2Players[1]?.profileId)) matchData.team2_player2 = team2Players[1].profileId;

        const { data, error } = await supabase.from('matches').insert(matchData).select().single();

        if (data && !error) {
          matchId = data.id;
        }
      } catch (err) {
        console.error('Failed to save active match to Supabase:', err);
      }
    }

    const newMatch: Match = {
      ...matchConfig,
      id: matchId,
      rounds: [],
      status: 'active',
    };
    
    if (waitlistId && isAuthenticated) {
      supabase.from('waitlist').update({ status: 'playing' }).eq('id', waitlistId).then();
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

  const handleUpdateMatch = async (updatedMatch: Match) => {
    let matchToSave = updatedMatch;

    if (!updatedMatch.isGuestMode && isAuthenticated && isSupabaseId(updatedMatch.id)) {
      try {
        const totals: Record<string, number> = { team1: 0, team2: 0 };
        updatedMatch.rounds.forEach(r => {
          if (r.scorerId === 'team1') totals.team1 += r.points;
          else if (r.scorerId === 'team2') totals.team2 += r.points;
        });

        let newStatus = updatedMatch.status;
        let winnerTeam = null;
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

        matchToSave = { ...updatedMatch, status: newStatus };

        await supabase.from('matches').update({
          status: newStatus,
          winner_team: winnerTeam,
          is_zapato: isZapato,
          rounds: matchToSave.rounds,
          team1_total: totals.team1,
          team2_total: totals.team2,
        }).eq('id', matchToSave.id);
      } catch (err) {
        console.error('Failed to sync match update to Supabase:', err);
      }
    }
    
    setMatch(matchToSave);
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

          let finalMatchId = updatedMatch.id;

          if (isSupabaseId(updatedMatch.id)) {
            await supabase.from('matches').update({
              status: 'completed',
              winner_team: winnerTeam,
              is_zapato: isZapato,
              rounds: updatedMatch.rounds,
              team1_total: totals['team1'] || 0,
              team2_total: totals['team2'] || 0,
              wager_amount: updatedMatch.wager_amount || 0,
              is_wager_match: updatedMatch.is_wager_match || false,
              tournament_id: updatedMatch.tournament_id || null,
            }).eq('id', updatedMatch.id);
          } else {
            const matchData: any = {
              status: 'completed',
              game_mode: updatedMatch.gameMode,
              limit_score: updatedMatch.limitScore,
              rounds: updatedMatch.rounds,
              team1_total: totals['team1'] || 0,
              team2_total: totals['team2'] || 0,
              winner_team: winnerTeam,
              is_zapato: isZapato,
              players_json: updatedMatch.players,
              team1_player1: team1P1,
              team1_player2: team1P2,
              team2_player1: team2P1,
              team2_player2: team2P2,
              wager_amount: updatedMatch.wager_amount || 0,
              is_wager_match: updatedMatch.is_wager_match || false,
              tournament_id: updatedMatch.tournament_id || null,
            };

            const { data: newMatchRec } = await supabase.from('matches').insert(matchData).select('id').single();
            if (newMatchRec) finalMatchId = newMatchRec.id;
          }

          // Wager resolution logic for players in match
          if (updatedMatch.is_wager_match && updatedMatch.wager_amount && updatedMatch.wager_amount > 0 && winnerTeam !== null) {
            const wager = updatedMatch.wager_amount;
            const winners = winnerTeam === 1 ? [team1P1, team1P2] : [team2P1, team2P2];
            const losers = winnerTeam === 1 ? [team2P1, team2P2] : [team1P1, team1P2];
            
            // Add wager to winners
            for (const wid of winners) {
              if (!wid) continue;
              const { data: prof } = await supabase.from('profiles').select('betting_points').eq('id', wid).single();
              if (prof) {
                await supabase.from('profiles').update({ betting_points: (prof.betting_points || 0) + wager }).eq('id', wid);
              }
            }
            // Subtract wager from losers
            for (const lid of losers) {
              if (!lid) continue;
              const { data: prof } = await supabase.from('profiles').select('betting_points').eq('id', lid).single();
              if (prof) {
                await supabase.from('profiles').update({ betting_points: Math.max(0, (prof.betting_points || 0) - wager) }).eq('id', lid);
              }
            }
          }
          
          if (isSupabaseId(finalMatchId)) {
            try {
              await supabase.rpc('resolve_match_bets', { 
                p_match_id: finalMatchId, 
                p_winner_team: winnerTeam 
              });
            } catch (rpcErr) {
              console.error('Error resolving bets via RPC:', rpcErr);
            }

            try {
              await supabase.rpc('update_player_streaks_for_match', { 
                p_match_id: finalMatchId 
              });
            } catch (rpcErr) {
              console.error('Error updating streaks via RPC:', rpcErr);
            }
            
            // Tournament Bracket Progression
            try {
              const { data: bracket } = await supabase.from('tournament_brackets').select('*').eq('live_match_id', finalMatchId).single();
              if (bracket && !bracket.winner_team) {
                await supabase.from('tournament_brackets').update({ winner_team: winnerTeam }).eq('id', bracket.id);
                
                const { data: allMatches } = await supabase.from('tournament_brackets').select('*').eq('tournament_id', bracket.tournament_id).eq('round_number', bracket.round_number);
                
                if (allMatches) {
                  const updatedMatches = allMatches.map((m: any) => m.id === bracket.id ? { ...m, winner_team: winnerTeam } : m);
                  const allFinished = updatedMatches.every((m: any) => m.winner_team !== null);
                  
                  if (allFinished) {
                    const winners = updatedMatches.map((m: any) => {
                      return m.winner_team === 1 
                        ? { p1: m.team1_player1, p2: m.team1_player2 } 
                        : { p1: m.team2_player1, p2: m.team2_player2 };
                    });

                    if (winners.length === 1) {
                      await supabase.from('tournaments').update({ status: 'completed' }).eq('id', bracket.tournament_id);

                      // Si es un torneo de puntos y hay un pozo acumulado, repartir a los campeones
                      try {
                        const { data: tInfo } = await supabase.from('tournaments').select('*').eq('id', bracket.tournament_id).single();
                        if (tInfo && tInfo.tournament_type !== 'vip_cash' && Number(tInfo.prize_pool) > 0) {
                          const championIds = [winners[0].p1, winners[0].p2].filter(Boolean);
                          if (championIds.length > 0) {
                            const pointsPerChamp = Math.floor(Number(tInfo.prize_pool) / championIds.length);
                            for (const champId of championIds) {
                              const { data: cProf } = await supabase.from('profiles').select('betting_points').eq('id', champId).single();
                              await supabase.from('profiles').update({
                                betting_points: (cProf?.betting_points || 0) + pointsPerChamp
                              }).eq('id', champId);
                            }
                          }
                        }
                      } catch (payoutErr) {
                        console.error('Error awarding tournament prize points:', payoutErr);
                      }

                      Alert.alert('🏆 ¡Torneo Finalizado!', 'El torneo ha concluido exitosamente y se han entregado los premios a los campeones.');
                    } else {
                      const nextRoundMatches = [];
                      let matchCount = 1;
                      for (let i = 0; i < winners.length; i += 2) {
                        if (i + 1 < winners.length) {
                           const { data: prof1 } = await supabase.from('profiles').select('display_name, initials').eq('id', winners[i].p1).single();
                           const { data: prof2 } = await supabase.from('profiles').select('display_name, initials').eq('id', winners[i].p2).single();
                           const { data: prof3 } = await supabase.from('profiles').select('display_name, initials').eq('id', winners[i+1].p1).single();
                           const { data: prof4 } = await supabase.from('profiles').select('display_name, initials').eq('id', winners[i+1].p2).single();
                           
                           const players_json = [
                              { id: '1', profileId: winners[i].p1, name: prof1?.display_name, initials: prof1?.initials, teamNumber: 1, position: 'bottom' },
                              { id: '2', profileId: winners[i+1].p1, name: prof3?.display_name, initials: prof3?.initials, teamNumber: 2, position: 'right' },
                              { id: '3', profileId: winners[i].p2, name: prof2?.display_name, initials: prof2?.initials, teamNumber: 1, position: 'top' },
                              { id: '4', profileId: winners[i+1].p2, name: prof4?.display_name, initials: prof4?.initials, teamNumber: 2, position: 'left' }
                           ];

                           const { data: liveMatchData, error: matchInsertError } = await supabase.from('matches').insert({
                              status: 'active',
                              game_mode: 'teams',
                              limit_score: 100,
                              team1_total: 0,
                              team2_total: 0,
                              team1_player1: winners[i].p1,
                              team1_player2: winners[i].p2,
                              team2_player1: winners[i+1].p1,
                              team2_player2: winners[i+1].p2,
                              rounds: [],
                              players_json: players_json,
                              tournament_id: bracket.tournament_id
                           }).select('id').single();

                           if (matchInsertError) {
                             console.error("Match Insert Error:", matchInsertError);
                           }

                           nextRoundMatches.push({
                              tournament_id: bracket.tournament_id,
                              round_number: bracket.round_number + 1,
                              match_number: matchCount++,
                              team1_player1: winners[i].p1,
                              team1_player2: winners[i].p2,
                              team2_player1: winners[i+1].p1,
                              team2_player2: winners[i+1].p2,
                              live_match_id: liveMatchData?.id || null
                           });
                        }
                      }
                      if (nextRoundMatches.length > 0) {
                        const { error: bracketInsertErr } = await supabase.from('tournament_brackets').insert(nextRoundMatches);
                        if (bracketInsertErr) {
                          console.error("Bracket Insert Error:", bracketInsertErr);
                          Alert.alert('Error', 'No se pudo generar la siguiente ronda: ' + bracketInsertErr.message);
                        } else {
                          Alert.alert('¡Siguiente Ronda!', `La Ronda ${bracket.round_number + 1} del torneo ha sido generada automáticamente.`);
                        }
                      }
                    }
                  }
                }
              }
            } catch (err) {
              console.error('Error advancing bracket:', err);
            }
          }

          if (isZapato) {
            const winners = winnerTeam === 1 ? [team1P1, team1P2] : [team2P1, team2P2];
            for (const wid of winners) {
              if (!wid) continue;
              const { data: prof } = await supabase.from('profiles').select('achievements').eq('id', wid).single();
              if (prof) {
                const achs = prof.achievements || [];
                if (!achs.includes('zapatero_maestro')) {
                  const { data: playerMatches } = await supabase.from('matches').select('winner_team, team1_player1, team1_player2, team2_player1, team2_player2').eq('is_zapato', true).eq('status', 'completed');
                  let count = 0;
                  playerMatches?.forEach(m => {
                    const inT1 = m.team1_player1 === wid || m.team1_player2 === wid;
                    const inT2 = m.team2_player1 === wid || m.team2_player2 === wid;
                    if ((inT1 && m.winner_team === 1) || (inT2 && m.winner_team === 2)) count++;
                  });
                  if (count >= 3) {
                    achs.push('zapatero_maestro');
                    await supabase.from('profiles').update({ achievements: achs }).eq('id', wid);
                    if (wid === currentUserProfileId) Alert.alert('🏆 Logro Desbloqueado', 'Zapatero Maestro: ¡Has dado 3 zapatos!');
                  }
                }
              }
            }
          }

        } catch (err) {
          console.error('Failed to save match to Supabase:', err);
        }

        if (updatedMatch.gameMode === 'teams') {
          const winnerTeamNumber = winnerId === 'team1' ? 1 : 2;
          const winnerPlayers = updatedMatch.players.filter(p => p.teamNumber === winnerTeamNumber);
          const winnerProfileIds = winnerPlayers.map(p => p.profileId).filter(Boolean) as string[];

          if (winnerProfileIds.length === 2) {
            try {
              const { data: waitlistData } = await supabase
                .from('waitlist')
                .select('*')
                .eq('status', 'waiting')
                .order('created_at', { ascending: true })
                .limit(1);

              if (waitlistData && waitlistData.length > 0) {
                const nextDuo = waitlistData[0];
                const { data: profilesData } = await supabase.from('profiles').select('*')
                    .in('id', [...winnerProfileIds, nextDuo.player1_id, nextDuo.player2_id]);
                
                if (profilesData) {
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

      {/* Global In-App Toast */}
      {toastMsg && currentScreen !== 'global_chat' && (
        <Animated.View style={[styles.toastContainer, { transform: [{ translateY: toastAnim }] }]}>
          <TouchableOpacity 
            style={styles.toastContent} 
            activeOpacity={0.9} 
            onPress={() => {
              Animated.timing(toastAnim, { toValue: -150, duration: 200, useNativeDriver: true }).start(() => setToastMsg(null));
              navigate('global_chat');
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
