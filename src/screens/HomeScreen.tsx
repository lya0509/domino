import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, SafeAreaView, RefreshControl, ActivityIndicator, Animated, Image, Alert, Platform, Modal, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { theme } from '../theme';
import { Profile, PlayerStats, DuoStats } from '../types';
import { supabase } from '../lib/supabase';
import { sounds } from '../lib/sounds';
import { offlineSync } from '../lib/offlineSync';
import { realtimeManager } from '../lib/realtimeManager';
import { fetchActiveWaitlist, joinOrUpdateWaitlist, removeWaitlistEntry, callWaitlistDuo } from '../lib/waitlistService';
import { reconcileUserPendingBets } from '../lib/bettingService';

interface Props {
  onNewMatch: () => void;
  onLogout: () => void;
  currentUserProfileId: string | null;
  onWatchLiveMatch: (matchId: string) => void;
  onOpenProfile: (profileId?: string) => void;
  onOpenStore: () => void;
  onOpenAchievements: () => void;
  onOpenLeaderboard: () => void;
  onOpenGlobalChat: () => void;
  onRejoinMatch?: (matchData: any) => void;
  onOpenTournaments?: () => void;
  onSeatWaitlistDuo?: (waitlistEntry: any) => void;
}

type RankingPeriod = 'today' | 'week' | 'all';
type RankingTab = 'individual' | 'duos';

export const HomeScreen: React.FC<Props> = ({
  onNewMatch,
  onLogout,
  currentUserProfileId,
  onWatchLiveMatch,
  onOpenProfile,
  onOpenStore,
  onOpenAchievements,
  onOpenLeaderboard,
  onOpenGlobalChat,
  onRejoinMatch,
  onOpenTournaments,
  onSeatWaitlistDuo,
}) => {
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [allProfiles, setAllProfiles] = useState<Profile[]>(() => offlineSync.getCachedProfilesSync());
  const [rankings, setRankings] = useState<PlayerStats[]>([]);
  const [duoRankings, setDuoRankings] = useState<DuoStats[]>([]);
  const [period, setPeriod] = useState<RankingPeriod>('today');
  const [tab, setTab] = useState<RankingTab>('individual');
  const [refreshing, setRefreshing] = useState(false);
  const [isMuted, setIsMuted] = useState(sounds.isMuted);
  const [notifPermission, setNotifPermission] = useState(
    Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'granted'
  );
  const [loading, setLoading] = useState(true);
  const [liveMatches, setLiveMatches] = useState<any[]>([]);
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [activeUserMatch, setActiveUserMatch] = useState<any | null>(null);
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('');
  const [partnerSearch, setPartnerSearch] = useState('');
  const [joiningWaitlist, setJoiningWaitlist] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const fetchWaitlist = useCallback(async () => {
    try {
      const entries = await fetchActiveWaitlist();
      setWaitlist(entries);
    } catch (e) {
      console.error('Error fetching waitlist:', e);
    }
  }, []);

  // Pure ranking computation so it can run first on cached data (SWR) and again on fresh data
  const applyRankings = useCallback(
    (profiles: Profile[], rawMatches: any[], uid: string | null, fromDate: string | null) => {
    const profileMap: Record<string, Profile> = {};
    (profiles || []).forEach((p: Profile) => {
      profileMap[p.id] = p;
    });

    // Filter matches by period if loaded from offline cache
    const matches = (rawMatches || []).filter((m: any) => {
      if (!fromDate || !m.created_at) return true;
      return m.created_at >= fromDate;
    });

    const matchList = matches.filter((m: any) => m.status === 'completed');

    const activeMatch = (rawMatches || []).find(
      (m: any) =>
        m.status === 'active' &&
        uid &&
        [m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2].includes(uid)
    );
    setActiveUserMatch(activeMatch || null);

    // Compute individual stats
    const statsMap: Record<string, PlayerStats> = {};
    (profiles || []).forEach((p: Profile) => {
      statsMap[p.id] = {
        id: p.id,
        display_name: p.display_name,
        initials: p.initials,
        total_matches: 0,
        wins: 0,
        losses: 0,
        zapatos_given: 0,
        zapatos_received: 0,
        medals: [],
      };
    });

    matchList.forEach((m: any) => {
      const allPlayers = [m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2].filter(Boolean);
      const team1 = [m.team1_player1, m.team1_player2].filter(Boolean);
      const team2 = [m.team2_player1, m.team2_player2].filter(Boolean);

      if (!m.winner_team) return;

      const winners = m.winner_team === 1 ? team1 : team2;
      const losers = m.winner_team === 1 ? team2 : team1;

      allPlayers.forEach((pid: string) => {
        if (!statsMap[pid]) return;
        statsMap[pid].total_matches++;
      });
      winners.forEach((pid: string) => {
        if (!statsMap[pid]) return;
        statsMap[pid].wins++;
        if (m.is_zapato) statsMap[pid].zapatos_given++;
      });
      losers.forEach((pid: string) => {
        if (!statsMap[pid]) return;
        statsMap[pid].losses++;
        if (m.is_zapato) statsMap[pid].zapatos_received++;
      });
    });

    const sortedStats = Object.values(statsMap)
      .filter((s) => s.total_matches > 0)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses);

    let maxZapatos = 0;
    let maxWinRate = 0;
    let maxLosses = 0;
    sortedStats.forEach((s) => {
      if (s.zapatos_given > maxZapatos) maxZapatos = s.zapatos_given;
      if (s.losses > maxLosses) maxLosses = s.losses;
      if (s.total_matches >= 3 && s.wins / s.total_matches > maxWinRate) maxWinRate = s.wins / s.total_matches;
    });

    sortedStats.forEach((s) => {
      s.medals = [];
      if (maxZapatos > 0 && s.zapatos_given === maxZapatos) s.medals.push('🥾');
      if (maxLosses > 0 && s.losses === maxLosses) s.medals.push('🤡');
      if (s.total_matches >= 3 && s.wins / s.total_matches === maxWinRate) s.medals.push('🔥');
    });

    setRankings(sortedStats);

    // Compute duo stats
    const duoMap: Record<string, { p1: string; p2: string; wins: number; total: number }> = {};
    matchList.forEach((m: any) => {
      if (!m.winner_team) return;
      const team1 = [m.team1_player1, m.team1_player2].filter(Boolean).sort();
      const team2 = [m.team2_player1, m.team2_player2].filter(Boolean).sort();

      if (team1.length === 2) {
        const key1 = team1.join('_');
        if (!duoMap[key1]) duoMap[key1] = { p1: team1[0], p2: team1[1], wins: 0, total: 0 };
        duoMap[key1].total++;
        if (m.winner_team === 1) duoMap[key1].wins++;
      }
      if (team2.length === 2) {
        const key2 = team2.join('_');
        if (!duoMap[key2]) duoMap[key2] = { p1: team2[0], p2: team2[1], wins: 0, total: 0 };
        duoMap[key2].total++;
        if (m.winner_team === 2) duoMap[key2].wins++;
      }
    });

    const sortedDuos: DuoStats[] = Object.values(duoMap)
      .filter((d) => d.total > 0)
      .sort((a, b) => b.wins - a.wins)
      .map((d) => ({
        player1: profileMap[d.p1] || { id: d.p1, display_name: '?', initials: '?' },
        player2: profileMap[d.p2] || { id: d.p2, display_name: '?', initials: '?' },
        wins: d.wins,
        totalMatches: d.total,
      }));
    setDuoRankings(sortedDuos);
    },
    []
  );

  const fetchData = useCallback(async () => {
    try {
      // Build date filter
      let fromDate: string | null = null;
      const now = new Date();
      if (period === 'today') {
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        fromDate = today.toISOString();
      } else if (period === 'week') {
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        fromDate = weekAgo.toISOString();
      }

      // 0. Stale-while-revalidate: paint rankings instantly from cache, network refresh below
      const cachedProfiles = offlineSync.getCachedProfilesSync();
      if (cachedProfiles.length > 0) {
        const cachedMatches = await offlineSync.getCachedMatches();
        if (cachedMatches.length > 0) {
          applyRankings(cachedProfiles, cachedMatches, currentUserProfileId, fromDate);
          setLoading(false);
        }
      }

      // 1. Fetch profiles from fast cache / network + lightweight matches in parallel
      const profilesPromise = offlineSync.getProfiles();
      const matchesPromise = (async () => {
        if (!offlineSync.getIsOnline()) {
          return offlineSync.getCachedMatches();
        }
        try {
          let query = supabase
            .from('matches')
            .select(
              'id, status, winner_team, is_zapato, team1_player1, team1_player2, team2_player1, team2_player2, created_at, game_mode, limit_score, players_json, team1_total, team2_total, wager_amount, is_wager_match, tournament_id'
            );
          if (fromDate) {
            query = query.gte('created_at', fromDate);
          }
          const { data, error } = await query;
          if (!error && data) {
            if (!fromDate) {
              offlineSync.setCachedMatches(data);
            } else {
              // Merge period results into the cache so the default 'today' view can paint instantly next time
              const cached = await offlineSync.getCachedMatches();
              const byId: Record<string, any> = {};
              cached.forEach((m: any) => { byId[m.id] = m; });
              data.forEach((m: any) => { byId[m.id] = m; });
              offlineSync.setCachedMatches(Object.values(byId));
            }
            return data;
          }
        } catch {}
        return offlineSync.getCachedMatches();
      })();

      const [profiles, rawMatches] = await Promise.all([profilesPromise, matchesPromise]);
      setAllProfiles(profiles);

      const profileMap: Record<string, Profile> = {};
      (profiles || []).forEach((p: Profile) => {
        profileMap[p.id] = p;
      });

      // Resolve current user profile quickly from cached map or session
      let uid = currentUserProfileId;
      if (!uid && offlineSync.getIsOnline()) {
        const { data: { session } } = await supabase.auth.getSession();
        uid = session?.user?.id || null;
      }

      applyRankings(profiles, rawMatches, uid, fromDate);

      if (uid) {
        let profile: Profile | null = profileMap[uid] || null;
        if (!profile && offlineSync.getIsOnline()) {
          const { data: dbProfile } = await supabase.from('profiles').select('*').eq('id', uid).single();
          profile = dbProfile as Profile | null;
        }

        if (profile) {
          try {
            let override = await AsyncStorage.getItem('@domino_admin_override');
            if (!override && Platform.OS === 'web' && typeof window !== 'undefined') {
              override = window.localStorage.getItem('@domino_admin_override');
            }
            if (override === 'true') {
              profile.is_admin = true;
            }
          } catch {}

          // Reconcile any pending winning bets in background
          if (offlineSync.getIsOnline()) {
            reconcileUserPendingBets(profile.id).then((res) => {
              if (res.settledCount > 0 || res.totalCredited > 0) {
                supabase
                  .from('profiles')
                  .select('*')
                  .eq('id', profile!.id)
                  .single()
                  .then(({ data: refreshed }) => {
                    if (refreshed) {
                      if (profile?.is_admin) (refreshed as Profile).is_admin = true;
                      setCurrentUser(refreshed as Profile);
                      offlineSync.updateProfileInCache(refreshed as Profile);
                    }
                  });
              }
            });
          }

          // Daily bonus (10 pts at 7am) & daily login streak
          const lastBonus = profile.last_daily_bonus_at ? new Date(profile.last_daily_bonus_at) : null;
          let canClaim = false;
          if (!lastBonus) {
            canClaim = true;
          } else {
            const adjustedNow = new Date(now.getTime() - 7 * 60 * 60 * 1000);
            const adjustedLast = new Date(lastBonus.getTime() - 7 * 60 * 60 * 1000);
            canClaim =
              adjustedNow.getDate() !== adjustedLast.getDate() ||
              adjustedNow.getMonth() !== adjustedLast.getMonth() ||
              adjustedNow.getFullYear() !== adjustedLast.getFullYear();
          }

          const getLocalDateKey = (d: Date) => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
          };

          const todayKey = getLocalDateKey(now);
          const rawLastStreak = profile.last_streak_update_at;
          const lastStreakKey = rawLastStreak ? rawLastStreak.slice(0, 10) : null;

          let newStreak = profile.streak_count || 0;
          let streakUpdated = false;
          let streakIncreased = false;
          let streakLost = false;
          const previousStreak = profile.streak_count || 0;

          if (!lastStreakKey) {
            newStreak = 1;
            streakUpdated = true;
            streakIncreased = true;
          } else if (lastStreakKey === todayKey) {
            streakUpdated = false;
          } else {
            const [ty, tm, td] = todayKey.split('-').map(Number);
            const [ly, lm, ld] = lastStreakKey.split('-').map(Number);
            const todayUtc = Date.UTC(ty, tm - 1, td);
            const lastUtc = Date.UTC(ly, lm - 1, ld);
            const diffDays = Math.round((todayUtc - lastUtc) / (1000 * 60 * 60 * 24));

            if (diffDays === 1) {
              newStreak = previousStreak + 1;
              streakUpdated = true;
              streakIncreased = true;
            } else if (diffDays > 1) {
              newStreak = 1;
              streakUpdated = true;
              streakIncreased = false;
              if (previousStreak > 1) {
                streakLost = true;
              }
            }
          }

          if ((canClaim || streakUpdated) && offlineSync.getIsOnline()) {
            if (canClaim) {
              // The server decides if today's bonus is still available and credits it
              const { data: bonus, error: bonusErr } = await supabase.rpc('claim_daily_bonus');
              if (bonusErr) console.warn('claim_daily_bonus failed:', bonusErr.message);
              canClaim = !bonusErr && !!bonus?.claimed;
            }

            const { data: updatedProfile } = streakUpdated
              ? await supabase
                  .from('profiles')
                  .update({ streak_count: newStreak, last_streak_update_at: todayKey })
                  .eq('id', profile.id)
                  .select('*')
                  .single()
              : await supabase.from('profiles').select('*').eq('id', profile.id).single();

            if (updatedProfile) {
              if (profile.is_admin) (updatedProfile as Profile).is_admin = true;
              setCurrentUser(updatedProfile as Profile);
              offlineSync.updateProfileInCache(updatedProfile as Profile);
              if (streakLost) {
                Alert.alert(
                  '💔 ¡Racha Perdida!',
                  `No iniciaste sesión ayer y se perdió tu racha de ${previousStreak} días.\n¡Hoy comienzas una nueva racha de 1 día! 🔥` +
                    (canClaim ? '\n\nAdemás recibiste 10 puntos de bono diario.' : '')
                );
                sounds.playSound('slap');
              } else if (canClaim && streakIncreased) {
                Alert.alert(
                  '🔥 ¡Racha y Bono Diario!',
                  `¡Has subido a ${newStreak} días de racha consecutiva! 🔥\nAdemás recibiste 10 puntos de apuestas.`
                );
                sounds.playSound('chaching');
              } else if (canClaim) {
                Alert.alert('🎁 ¡Bono Diario!', '¡Has recibido 10 puntos de apuestas por iniciar sesión hoy!');
                sounds.playSound('chaching');
              } else if (streakIncreased) {
                Alert.alert(
                  '🔥 ¡Racha Aumentada!',
                  `¡Has alcanzado ${newStreak} días de racha consecutiva jugando en PeSiMistas! 🔥`
                );
                sounds.playSound('chaching');
              }
            } else {
              setCurrentUser(profile as Profile);
            }
          } else {
            setCurrentUser(profile as Profile);
          }
        }
      }

    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [period, currentUserProfileId, applyRankings]);

  const myWaitlistEntry = waitlist.find(
    (w) =>
      currentUserProfileId &&
      (w.creator_id === currentUserProfileId ||
        w.player1_id === currentUserProfileId ||
        w.player2_id === currentUserProfileId)
  );

  const handleOpenWaitlistModal = () => {
    if (!currentUserProfileId) {
      Alert.alert('Inicia sesión', 'Debes iniciar sesión para pedir mesa.');
      return;
    }
    if (myWaitlistEntry) {
      const currentPartner =
        myWaitlistEntry.player1_id === currentUserProfileId
          ? myWaitlistEntry.player2_id
          : myWaitlistEntry.player1_id;
      setSelectedPartnerId(currentPartner || '');
    } else {
      setSelectedPartnerId('');
    }
    setPartnerSearch('');
    setShowWaitlistModal(true);
  };

  const handleSaveWaitlist = async () => {
    if (!currentUserProfileId) return;
    if (!selectedPartnerId) {
      Alert.alert('Falta tu pareja', 'Por favor selecciona con quién vas a hacer pareja.');
      return;
    }
    setJoiningWaitlist(true);
    const res = await joinOrUpdateWaitlist({
      currentUserId: currentUserProfileId,
      partnerId: selectedPartnerId,
      existingWaitlistId: myWaitlistEntry?.id || null,
    });
    setJoiningWaitlist(false);
    if (!res.success) {
      Alert.alert('Atención', res.error || 'No se pudo anotar en la fila.');
      return;
    }
    sounds.playSound('pop');
    setShowWaitlistModal(false);
    await fetchWaitlist();
    Alert.alert(
      myWaitlistEntry ? '✅ Pareja Actualizada' : '✋ ¡Mesa Pedida!',
      myWaitlistEntry
        ? 'Se ha actualizado tu pareja en la lista de espera.'
        : 'Tu dúo ha sido anotado en la lista de espera.'
    );
  };

  const handleRemoveWaitlist = async (id: string) => {
    const ok = await removeWaitlistEntry(id);
    if (ok) {
      setShowWaitlistModal(false);
      await fetchWaitlist();
    } else {
      Alert.alert('Error', 'No se pudo retirar de la lista de espera.');
    }
  };

  const handleCallDuo = async (item: any) => {
    try {
      const p1Name = item.player1?.display_name || 'Jugador 1';
      const p2Name = item.player2?.display_name || 'Jugador 2';

      await callWaitlistDuo(item, currentUser?.display_name || 'La Mesa');
      sounds.playSound('pop');
      Alert.alert(
        '📢 Dúo Llamado a Mesa',
        `Se ha enviado una alerta en vivo a ${p1Name} y ${p2Name}. Tienen 30 segundos para presentarse en la mesa.`
      );
    } catch (e) {
      console.error(e);
      Alert.alert('Error', 'No se pudo enviar la llamada');
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchData();
  }, [fetchData]);

  // Pulse animation for live badge
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Fetch live matches and subscribe to Realtime
  useEffect(() => {
    const fetchLiveMatches = async () => {
      if (!offlineSync.getIsOnline()) return;
      const { data } = await supabase
        .from('matches')
        .select('id, status, team1_player1, team1_player2, team2_player1, team2_player2, players_json, team1_total, team2_total, limit_score, game_mode, rounds, substitutions, wager_amount, is_wager_match, tournament_id')
        .eq('status', 'active');
      setLiveMatches(data || []);
    };

    fetchLiveMatches();
    fetchWaitlist();
    // Unique topic per mount: reusing a fixed name returns the old, still-closing channel and .on() throws


    const matchesChannel = supabase
      .channel(`home-live-matches-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'matches' },
        () => {
          fetchLiveMatches();
          fetchData();
        }
      )
      .subscribe();

    const waitlistChannel = supabase
      .channel(`home-waitlist-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'waitlist' },
        () => {
          fetchWaitlist();
        }
      )
      .subscribe();

    const unsubWaitlistBroadcast = realtimeManager.onWaitlistChange(() => {
      fetchWaitlist();
    });

    return () => {
      supabase.removeChannel(matchesChannel);
      supabase.removeChannel(waitlistChannel);
      unsubWaitlistBroadcast();
    };
  }, [fetchWaitlist, fetchData]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchWaitlist();
    fetchData();
  };

  const myStats = currentUser ? rankings.find(r => r.id === currentUser.id) : null;

  const getMedal = (index: number) => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return `${index + 1}`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Cargando rankings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 }}>
            <View style={{ flexShrink: 1 }}>
              <Text style={styles.greeting} numberOfLines={1}>Hola, {currentUser?.display_name?.split(' ')[0] || 'Jugador'} 👋</Text>
              <Text style={styles.greetingSub}>¿Listo para jugar?</Text>
            </View>
            {(currentUser?.streak_count || 0) > 0 && (
              <View style={{ marginLeft: 12, backgroundColor: 'rgba(249, 115, 22, 0.15)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.accent }}>
                <Text style={{ fontSize: 16, marginRight: 4 }}>🔥</Text>
                <Text style={{ color: theme.colors.accent, fontWeight: 'bold', fontSize: 16 }}>{currentUser?.streak_count}</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity 
              onPress={() => setIsMuted(sounds.toggleMute())} 
              style={{ backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, marginRight: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}
              activeOpacity={0.7}
            >
              <Text style={{ fontSize: 16 }}>{isMuted ? '🔇' : '🔊'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onLogout} style={styles.logoutBtn}>
              <Text style={styles.logoutText}>Salir</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Notif Banner */}
        {Platform.OS === 'web' && notifPermission === 'default' && (
          <View style={{ 
            backgroundColor: 'rgba(59, 130, 246, 0.12)', 
            borderWidth: 1, 
            borderColor: '#3b82f6', 
            borderRadius: theme.borderRadius.m, 
            padding: 12, 
            marginBottom: theme.spacing.m,
            flexDirection: 'row',
            alignItems: 'center'
          }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: 13 }}>🔔 Activa las Notificaciones</Text>
              <Text style={{ color: theme.colors.textDim, fontSize: 11, marginTop: 2 }}>
                Te avisaremos en tu teléfono cuando llamen a tu dúo a la mesa.
              </Text>
            </View>
            <TouchableOpacity
              style={{ backgroundColor: '#2563eb', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 }}
              onPress={() => {
                if (typeof window !== 'undefined' && 'Notification' in window) {
                  Notification.requestPermission().then(perm => {
                    setNotifPermission(perm);
                    if (perm === 'granted') {
                      new Notification('✅ Notificaciones Activadas', {
                        body: 'Te avisaremos de inmediato cuando sea tu turno en la mesa.',
                        icon: '/favicon.ico'
                      });
                    }
                  });
                }
              }}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 12 }}>Activar</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Active Match Banner */}
        {activeUserMatch && (
          <TouchableOpacity 
            style={[styles.myStatsCard, { borderColor: theme.colors.accent, backgroundColor: 'rgba(245,158,11,0.1)' }]} 
            onPress={() => onRejoinMatch && onRejoinMatch(activeUserMatch)}
            activeOpacity={0.8}
          >
            <View style={{ alignItems: 'center' }}>
              <Text style={{ fontSize: 32, marginBottom: 8 }}>⚠️</Text>
              <Text style={{ color: theme.colors.accent, fontSize: 18, fontWeight: '900', textAlign: 'center' }}>PARTIDA EN CURSO</Text>
              <Text style={{ color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginTop: 4 }}>Tienes una partida activa. Toca para reanudar la libreta de anotaciones.</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* My Stats Card — toca para ver perfil */}
        {currentUser && (
          <TouchableOpacity style={styles.myStatsCard} onPress={() => onOpenProfile()} activeOpacity={0.8}>
            <View style={styles.myStatsAvatar}>
              {currentUser?.avatar_url ? (
                <Image source={{ uri: currentUser.avatar_url }} style={styles.myStatsImage} />
              ) : (
                <Text style={styles.myStatsInitials}>{currentUser?.initials}</Text>
              )}
            </View>
            <View style={styles.myStatsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{myStats?.wins ?? 0}</Text>
                <Text style={styles.statLabel}>Ganadas</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{myStats?.losses ?? 0}</Text>
                <Text style={styles.statLabel}>Perdidas</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: theme.colors.danger }]}>{myStats?.zapatos_given ?? 0}</Text>
                <Text style={styles.statLabel}>Zapatos 👟</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{myStats?.total_matches ?? 0}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
            </View>
            <Text style={styles.profileTapHint}>Ver mi perfil completo →</Text>
          </TouchableOpacity>
        )}

        {/* Quick Actions */}
        {!activeUserMatch && (
          <>
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={onOpenStore}>
                <Text style={styles.actionBtnIcon}>🛒</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionBtnTitle}>Tienda</Text>
                  <Text style={styles.actionBtnSub} numberOfLines={1} adjustsFontSizeToFit>Cosméticos</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.actionBtn, { marginLeft: 8 }]} onPress={onOpenAchievements}>
                <Text style={styles.actionBtnIcon}>🏆</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionBtnTitle}>Logros</Text>
                  <Text style={styles.actionBtnSub} numberOfLines={1} adjustsFontSizeToFit>Misiones</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.actionBtn} onPress={onOpenLeaderboard}>
                <Text style={styles.actionBtnIcon}>🌍</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.actionBtnTitle}>Ranking</Text>
                  <Text style={styles.actionBtnSub} numberOfLines={1} adjustsFontSizeToFit>Mundial</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity 
                style={[
                  styles.actionBtn, 
                  { 
                    marginLeft: 8, 
                    justifyContent: 'center',
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    borderColor: 'rgba(245, 158, 11, 0.6)',
                    borderWidth: 1.5,
                    shadowColor: '#f59e0b',
                    shadowOpacity: 0.7,
                    shadowRadius: 12,
                    elevation: 5,
                  }
                ]} 
                onPress={onOpenTournaments}
              >
                <Text style={styles.actionBtnIcon}>💎</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionBtnTitle, { color: '#f59e0b' }]}>Torneos VIP</Text>
                  <Text style={styles.actionBtnSub} numberOfLines={1} adjustsFontSizeToFit>Juega por Bs</Text>
                </View>
              </TouchableOpacity>
            </View>

            {/* Global Chat / Lobby Banner */}
            <TouchableOpacity style={[styles.actionBtn, { width: '100%', marginBottom: theme.spacing.l, backgroundColor: 'rgba(59,130,246,0.1)', borderColor: '#3B82F6' }]} onPress={onOpenGlobalChat}>
              <Text style={styles.actionBtnIcon}>💬</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.actionBtnTitle, { color: '#3B82F6' }]}>Lobby Global</Text>
                <Text style={styles.actionBtnSub} numberOfLines={1} adjustsFontSizeToFit>Habla con la comunidad</Text>
              </View>
            </TouchableOpacity>
          </>
        )}

        {/* Live Match Banner */}
        {liveMatches.length > 0 && (
          <View style={styles.liveBannerContainer}>
            <View style={styles.liveBannerHeader}>
              <Animated.View style={[styles.liveDot, { opacity: pulseAnim }]} />
              <Text style={styles.liveBannerTitle}>🔴 Partida en Vivo</Text>
            </View>
            {liveMatches.map(m => {
              const players: any[] = m.players_json || [];
              const t1 = players.filter((p: any) => p.teamNumber === 1).map((p: any) => p.initials).join(' & ') || 'Eq.1';
              const t2 = players.filter((p: any) => p.teamNumber === 2).map((p: any) => p.initials).join(' & ') || 'Eq.2';
              return (
                <TouchableOpacity key={m.id} style={styles.liveMatchCard} onPress={() => onWatchLiveMatch(m.id)}>
                  <View style={styles.liveMatchTeams}>
                    <Text style={[styles.liveTeamName, { color: theme.colors.primary }]}>{t1}</Text>
                    <View style={styles.liveScoreBadge}>
                      <Text style={styles.liveScore}>{m.team1_total} - {m.team2_total}</Text>
                      <Text style={styles.liveMeta}>/{m.limit_score}</Text>
                    </View>
                    <Text style={[styles.liveTeamName, { color: theme.colors.secondary, textAlign: 'right' }]}>{t2}</Text>
                  </View>
                  <Text style={styles.liveWatchBtn}>Ver en vivo →</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Waitlist Section */}
        <View style={styles.waitlistContainer}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.m }}>
            <Text style={[styles.waitlistTitle, { marginBottom: 0 }]}>📋 Lista de Espera</Text>
            <TouchableOpacity
              onPress={handleOpenWaitlistModal}
              style={{
                backgroundColor: myWaitlistEntry ? 'rgba(16, 185, 129, 0.18)' : theme.colors.primary,
                borderWidth: 1,
                borderColor: myWaitlistEntry ? '#10b981' : '#60a5fa',
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 10,
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: myWaitlistEntry ? '#34d399' : '#fff', fontWeight: '900', fontSize: 13 }}>
                {myWaitlistEntry ? '✏️ Editar mi turno' : '✋ Pedir Mesa'}
              </Text>
            </TouchableOpacity>
          </View>
          {waitlist.length === 0 ? (
            <Text style={{ color: theme.colors.textDim, fontStyle: 'italic', paddingVertical: 8, textAlign: 'center' }}>
              No hay nadie en fila aún. ¡Toca "Pedir Mesa" para anotar tu dúo!
            </Text>
          ) : (
            waitlist.map((item, index) => {
              const canDelete =
                currentUser?.is_admin ||
                (currentUserProfileId &&
                  (item.creator_id === currentUserProfileId ||
                    item.player1_id === currentUserProfileId ||
                    item.player2_id === currentUserProfileId));
              return (
                <View key={item.id} style={styles.waitlistItem}>
                  <Text style={styles.waitlistRank}>#{index + 1}</Text>
                  <View style={styles.waitlistPlayers}>
                    <Text style={styles.waitlistName}>{item.player1?.display_name || 'Desconocido'}</Text>
                    <Text style={styles.waitlistAnd}>&</Text>
                    <Text style={styles.waitlistName}>{item.player2?.display_name || 'Desconocido'}</Text>
                  </View>
                  {index === 0 && onSeatWaitlistDuo && (
                    <TouchableOpacity
                      onPress={() => onSeatWaitlistDuo(item)}
                      style={{
                        backgroundColor: 'rgba(16, 185, 129, 0.16)',
                        borderWidth: 1,
                        borderColor: '#10b981',
                        paddingHorizontal: 8,
                        paddingVertical: 5,
                        borderRadius: 8,
                        marginRight: 6,
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ color: '#34d399', fontSize: 11, fontWeight: '800' }}>🎲 Pasar</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => handleCallDuo(item)}
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.15)',
                      borderWidth: 1,
                      borderColor: '#f59e0b',
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 8,
                      marginRight: canDelete ? 8 : 0,
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ color: '#fbbf24', fontSize: 12, fontWeight: '800' }}>📢 Llamar</Text>
                  </TouchableOpacity>
                  {canDelete && (
                    <TouchableOpacity onPress={() => handleRemoveWaitlist(item.id)} style={{ paddingLeft: 6 }}>
                      <Text style={{ color: theme.colors.danger, fontWeight: 'bold', fontSize: 18 }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </View>

        {/* New Match Button */}
        <TouchableOpacity style={styles.newMatchBtn} onPress={onNewMatch}>
          <Text style={styles.newMatchIcon}>🎲</Text>
          <Text style={styles.newMatchText}>Nueva Partida</Text>
        </TouchableOpacity>

        {/* Rankings Section */}
        <View style={styles.rankingSection}>
          <Text style={styles.rankingTitle}>🏆 Rankings</Text>

          {/* Period Selector */}
          <View style={styles.periodSelector}>
            {([['today', 'Hoy'], ['week', 'Semana'], ['all', 'Historial']] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                style={[styles.periodBtn, period === key && styles.periodActive]}
                onPress={() => setPeriod(key)}
              >
                <Text style={[styles.periodText, period === key && styles.periodTextActive]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tab Selector */}
          <View style={styles.tabSelector}>
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'individual' && styles.tabActive]}
              onPress={() => setTab('individual')}
            >
              <Text style={[styles.tabText, tab === 'individual' && styles.tabTextActive]}>👤 Individual</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, tab === 'duos' && styles.tabActive]}
              onPress={() => setTab('duos')}
            >
              <Text style={[styles.tabText, tab === 'duos' && styles.tabTextActive]}>👥 Duos</Text>
            </TouchableOpacity>
          </View>

          {/* Individual Rankings */}
          {tab === 'individual' && (
            <>
              {rankings.length === 0 ? (
                <Text style={styles.emptyText}>No hay partidas en este período.</Text>
              ) : (
                rankings.map((stat, i) => (
                  <TouchableOpacity key={stat.id} style={[styles.rankItem, stat.id === currentUser?.id && styles.rankItemMe]} onPress={() => onOpenProfile(stat.id)}>
                    <Text style={styles.rankMedal}>{getMedal(i)}</Text>
                    <View style={styles.rankInfo}>
                      <Text style={styles.rankName}>{stat.display_name} {stat.medals?.join('')}</Text>
                      <Text style={styles.rankDetail}>
                        {stat.wins}W - {stat.losses}L
                        {stat.zapatos_given > 0 ? ` · 👟${stat.zapatos_given}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.rankWins}>{stat.wins}</Text>
                  </TouchableOpacity>
                ))
              )}
            </>
          )}

          {/* Duo Rankings */}
          {tab === 'duos' && (
            <>
              {duoRankings.length === 0 ? (
                <Text style={styles.emptyText}>No hay duos registrados en este período.</Text>
              ) : (
                duoRankings.map((duo, i) => (
                  <TouchableOpacity key={`${duo.player1.id}_${duo.player2.id}`} style={styles.rankItem} onPress={() => onOpenProfile(duo.player1.id)}>
                    <Text style={styles.rankMedal}>{getMedal(i)}</Text>
                    <View style={styles.rankInfo}>
                      <Text style={styles.rankName}>{duo.player1.initials} & {duo.player2.initials}</Text>
                      <Text style={styles.rankDetail}>
                        {duo.wins}W de {duo.totalMatches} partidas juntos
                      </Text>
                    </View>
                    <Text style={styles.rankWins}>{duo.wins}</Text>
                  </TouchableOpacity>
                ))
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Modal para Pedir Mesa / Editar Pareja */}
      <Modal
        visible={showWaitlistModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowWaitlistModal(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.82)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20,
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.card,
              borderRadius: theme.borderRadius.l,
              padding: 20,
              width: '100%',
              maxWidth: 420,
              maxHeight: '85%',
              borderWidth: 1,
              borderColor: theme.colors.cardBorder,
            }}
          >
            <Text style={{ color: theme.colors.text, fontSize: 20, fontWeight: '900', textAlign: 'center' }}>
              {myWaitlistEntry ? '✏️ Editar tu Pareja' : '✋ Pedir Mesa (Anotar Dúo)'}
            </Text>
            <Text style={{ color: theme.colors.textDim, fontSize: 13, textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
              Selecciona a tu compañero para entrar en la lista de espera:
            </Text>

            <TextInput
              style={{
                backgroundColor: 'rgba(0,0,0,0.35)',
                color: '#fff',
                borderRadius: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.1)',
                marginBottom: 10,
                fontSize: 14,
              }}
              placeholder="🔍 Buscar compañero por nombre o iniciales..."
              placeholderTextColor={theme.colors.textDim}
              value={partnerSearch}
              onChangeText={setPartnerSearch}
            />

            <ScrollView style={{ maxHeight: 260, marginBottom: 14 }} nestedScrollEnabled>
              {allProfiles
                .filter((p) => p.id !== currentUserProfileId)
                .filter((p) => {
                  if (!partnerSearch.trim()) return true;
                  const q = partnerSearch.toLowerCase();
                  return (
                    p.display_name?.toLowerCase().includes(q) ||
                    p.initials?.toLowerCase().includes(q)
                  );
                })
                .map((p) => {
                  const isSelected = selectedPartnerId === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => setSelectedPartnerId(p.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        marginBottom: 6,
                        borderRadius: 10,
                        backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.22)' : 'rgba(255,255,255,0.04)',
                        borderWidth: 1,
                        borderColor: isSelected ? theme.colors.primary : 'rgba(255,255,255,0.08)',
                      }}
                    >
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: isSelected ? '800' : '600' }}>
                        {p.display_name} ({p.initials})
                      </Text>
                      {isSelected && <Text style={{ color: theme.colors.primary, fontWeight: '900' }}>✓</Text>}
                    </TouchableOpacity>
                  );
                })}
            </ScrollView>

            <TouchableOpacity
              onPress={handleSaveWaitlist}
              disabled={joiningWaitlist || !selectedPartnerId}
              style={{
                backgroundColor: !selectedPartnerId ? 'rgba(59, 130, 246, 0.4)' : theme.colors.primary,
                paddingVertical: 14,
                borderRadius: 12,
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>
                {joiningWaitlist
                  ? 'Guardando...'
                  : myWaitlistEntry
                  ? 'Actualizar Pareja'
                  : 'Anótame en la Fila'}
              </Text>
            </TouchableOpacity>

            {myWaitlistEntry && (
              <TouchableOpacity
                onPress={() => handleRemoveWaitlist(myWaitlistEntry.id)}
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  borderWidth: 1,
                  borderColor: theme.colors.danger,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <Text style={{ color: theme.colors.danger, fontWeight: '800', fontSize: 14 }}>
                  Salir de la Fila
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => setShowWaitlistModal(false)}
              style={{ paddingVertical: 10, alignItems: 'center' }}
            >
              <Text style={{ color: theme.colors.textDim, fontWeight: '700' }}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing.m,
  },
  loadingText: {
    color: theme.colors.textDim,
    fontSize: 16,
  },
  scroll: {
    padding: theme.spacing.l,
    paddingTop: theme.spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
  },
  greeting: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  greetingSub: {
    color: theme.colors.textDim,
    fontSize: 14,
    marginTop: 2,
  },
  logoutBtn: {
    backgroundColor: theme.colors.card,
    paddingHorizontal: theme.spacing.m,
    paddingVertical: theme.spacing.s,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  logoutText: {
    color: theme.colors.textDim,
    fontWeight: '600',
    fontSize: 13,
  },
  myStatsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.l,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    marginBottom: theme.spacing.l,
    alignItems: 'center',
  },
  profileTapHint: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: theme.spacing.m,
  },
  myStatsAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: theme.spacing.m,
    overflow: 'hidden',
  },
  myStatsImage: {
    width: '100%',
    height: '100%',
  },
  myStatsInitials: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
  },
  myStatsGrid: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    color: theme.colors.text,
    fontSize: 24,
    fontWeight: '900',
  },
  statLabel: {
    color: theme.colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  newMatchBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.l,
    borderRadius: theme.borderRadius.l,
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.s,
    borderWidth: 1.5,
    borderColor: '#60a5fa',
    shadowColor: '#3b82f6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.85,
    shadowRadius: 18,
    elevation: 10,
  },
  newMatchIcon: {
    fontSize: 24,
  },
  newMatchText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  storeBtn: {
    backgroundColor: 'rgba(234, 179, 8, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.3)',
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.m,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.xl,
    gap: theme.spacing.m,
  },
  storeBtnIcon: {
    fontSize: 32,
  },
  storeBtnTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  storeBtnSub: {
    color: theme.colors.textDim,
    fontSize: 12,
  },
  rankingSection: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.l,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  rankingTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
    marginBottom: theme.spacing.m,
  },
  periodSelector: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: theme.borderRadius.s,
    padding: 3,
    marginBottom: theme.spacing.m,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: theme.spacing.s,
    alignItems: 'center',
    borderRadius: theme.borderRadius.s,
  },
  periodActive: {
    backgroundColor: theme.colors.secondary,
  },
  periodText: {
    color: theme.colors.textDim,
    fontWeight: '600',
    fontSize: 13,
  },
  periodTextActive: {
    color: '#fff',
  },
  tabSelector: {
    flexDirection: 'row',
    gap: theme.spacing.s,
    marginBottom: theme.spacing.l,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: theme.spacing.s,
    alignItems: 'center',
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  tabActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  tabText: {
    color: theme.colors.textDim,
    fontWeight: '600',
    fontSize: 13,
  },
  tabTextActive: {
    color: '#fff',
  },
  rankItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  rankItemMe: {
    backgroundColor: 'rgba(59,130,246,0.1)',
    marginHorizontal: -theme.spacing.m,
    paddingHorizontal: theme.spacing.m,
    borderRadius: theme.borderRadius.s,
  },
  rankMedal: {
    fontSize: 20,
    width: 36,
    textAlign: 'center',
  },
  rankInfo: {
    flex: 1,
    marginLeft: theme.spacing.s,
  },
  rankName: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  rankDetail: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: 2,
  },
  rankWins: {
    color: theme.colors.success,
    fontSize: 24,
    fontWeight: '900',
  },
  emptyText: {
    color: theme.colors.textDim,
    textAlign: 'center',
    fontStyle: 'italic',
    paddingVertical: theme.spacing.xl,
  },
  actionRow: { flexDirection: 'row', paddingHorizontal: theme.spacing.l, marginBottom: theme.spacing.l },
  actionBtn: {
    flex: 1, backgroundColor: theme.colors.card, padding: 12, borderRadius: theme.borderRadius.l,
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.cardBorder,
  },
  actionBtnIcon: { fontSize: 24, marginRight: 8 },
  actionBtnTitle: { color: theme.colors.text, fontSize: 15, fontWeight: 'bold' },
  actionBtnSub: { color: theme.colors.textDim, fontSize: 12 },
  // Live Match Banner
  liveBannerContainer: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.m,
    marginBottom: theme.spacing.l,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  liveBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: theme.spacing.s,
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.danger,
  },
  liveBannerTitle: {
    color: theme.colors.danger,
    fontWeight: '800',
    fontSize: 15,
  },
  liveMatchCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m,
    marginTop: theme.spacing.s,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  liveMatchTeams: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.s,
  },
  liveTeamName: {
    flex: 1,
    fontWeight: '800',
    fontSize: 14,
  },
  liveScoreBadge: {
    alignItems: 'center',
    paddingHorizontal: theme.spacing.m,
  },
  liveScore: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '900',
  },
  liveMeta: {
    color: theme.colors.textDim,
    fontSize: 11,
  },
  liveWatchBtn: {
    color: theme.colors.primary,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
  },
  waitlistContainer: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.l,
    marginBottom: theme.spacing.l,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  waitlistTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: theme.spacing.m,
  },
  waitlistItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.m,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  waitlistRank: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: '900',
    width: 30,
  },
  waitlistPlayers: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  waitlistName: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  waitlistAnd: {
    color: theme.colors.textDim,
    fontSize: 13,
  },
});
