import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, ScrollView, Modal, Alert, Image, TextInput, KeyboardAvoidingView, Platform, SafeAreaView
} from 'react-native';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { ProgressChart } from '../components/ProgressChart';
import { RainbowText } from '../components/RainbowText';
import { sounds } from '../lib/sounds';
import { Player, Round, Profile } from '../types';
import { offlineSync } from '../lib/offlineSync';
import { realtimeManager } from '../lib/realtimeManager';
import { placeMatchBet, reconcileUserPendingBets, settleMatchBetsAndWagers } from '../lib/bettingService';
import { fetchActiveWaitlist, joinOrUpdateWaitlist, removeWaitlistEntry } from '../lib/waitlistService';

interface Props {
  matchId: string;
  currentUserProfileId: string | null;
  onBack: () => void;
}

interface ChatMessage {
  id: string;
  user_id: string;
  message: string;
  created_at: string;
  profile?: { display_name: string; initials: string; equipped_items?: any };
}

export const LiveMatchScreen: React.FC<Props> = ({ matchId, currentUserProfileId, onBack }) => {
  const [matchData, setMatchData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isParticipant, setIsParticipant] = useState(false);
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>(() => offlineSync.getCachedProfilesSync());
  const [showModal, setShowModal] = useState(false);
  const [selectedPartner, setSelectedPartner] = useState<Profile | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');

  // Betting states
  const [bettingPoints, setBettingPoints] = useState(0);
  const [multiplierT1, setMultiplierT1] = useState(2.00);
  const [multiplierT2, setMultiplierT2] = useState(2.00);
  const [activeBets, setActiveBets] = useState<any[]>([]);
  const [showBetModal, setShowBetModal] = useState(false);
  const [betTeam, setBetTeam] = useState<1 | 2>(1);
  const [betAmount, setBetAmount] = useState('10');
  const [placingBet, setPlacingBet] = useState(false);
  const [lastMessageTime, setLastMessageTime] = useState(0);
  const settledMatchRef = useRef(false);

  const refreshUserPointsAndBets = async () => {
    if (!currentUserProfileId) return;
    await reconcileUserPendingBets(currentUserProfileId);
    const [{ data: betsData }, { data: prof }] = await Promise.all([
      supabase.from('bets').select('*').eq('match_id', matchId).eq('user_id', currentUserProfileId),
      supabase.from('profiles').select('betting_points').eq('id', currentUserProfileId).single(),
    ]);
    if (betsData) setActiveBets(betsData);
    if (prof) setBettingPoints(prof.betting_points || 0);
  };

  const fetchBets = async () => {
    if (!currentUserProfileId) return;
    const { data } = await supabase.from('bets').select('*').eq('match_id', matchId).eq('user_id', currentUserProfileId);
    if (data) setActiveBets(data);
  };

  const checkAndSettleCompletedMatch = async (mData: any) => {
    if (!mData) return;
    const limit = mData.limit_score || 100;
    const t1 = mData.team1_total || 0;
    const t2 = mData.team2_total || 0;
    const isDone = mData.status === 'completed' || t1 >= limit || t2 >= limit;
    if (isDone && !settledMatchRef.current) {
      settledMatchRef.current = true;
      const winTeam = mData.winner_team || (t1 >= limit ? 1 : t2 >= limit ? 2 : null);
      if (winTeam) {
        await settleMatchBetsAndWagers({
          matchId: mData.id || matchId,
          winnerTeam: winTeam,
          isWagerMatch: mData.is_wager_match,
          wagerAmount: mData.wager_amount,
          team1Player1: mData.team1_player1,
          team1Player2: mData.team1_player2,
          team2Player1: mData.team2_player1,
          team2Player2: mData.team2_player2,
        });
      }
      await refreshUserPointsAndBets();
    }
  };

  const fetchMatch = async () => {
    const { data, error } = await supabase
      .from('matches')
      .select('*')
      .eq('id', matchId)
      .single();

    if (data && !error) {
      setMatchData(data);
      if (currentUserProfileId) {
        const participants = [
          data.team1_player1, data.team1_player2,
          data.team2_player1, data.team2_player2
        ].filter(Boolean);
        setIsParticipant(participants.includes(currentUserProfileId));

        await refreshUserPointsAndBets();
        calculateMultipliers(data);
      }
      await checkAndSettleCompletedMatch(data);
    }
    setLoading(false);
  };

  const calculateMultipliers = async (matchInfo: any) => {
    const cachedMatches = await offlineSync.getCachedMatches();
    let data = cachedMatches.filter((m: any) => m.status === 'completed');
    if (data.length === 0 && offlineSync.getIsOnline()) {
      const { data: netData } = await supabase
        .from('matches')
        .select('winner_team, team1_player1, team1_player2, team2_player1, team2_player2')
        .eq('status', 'completed');
      data = netData || [];
    }

    const getStats = (p1: string, p2: string) => {
      let total = 0, wins = 0;
      data?.forEach((m: any) => {
        const t1 = [m.team1_player1, m.team1_player2];
        const t2 = [m.team2_player1, m.team2_player2];
        if (t1.includes(p1) && t1.includes(p2)) { total++; if (m.winner_team === 1) wins++; }
        if (t2.includes(p1) && t2.includes(p2)) { total++; if (m.winner_team === 2) wins++; }
      });
      return { total, wins };
    };

    const s1 = getStats(matchInfo.team1_player1, matchInfo.team1_player2);
    const s2 = getStats(matchInfo.team2_player1, matchInfo.team2_player2);

    const calcMult = (s: { total: number; wins: number }) => {
      if (s.total === 0) return 2.0;
      let wr = s.wins / s.total;
      if (wr < 0.1) wr = 0.1;
      if (wr > 0.9) wr = 0.9;
      // Same 1.20x–3.50x clamp as the place_bet RPC, which sets the real multiplier
      return Math.min(3.5, Math.max(1.2, parseFloat((1 / wr).toFixed(2))));
    };

    setMultiplierT1(calcMult(s1));
    setMultiplierT2(calcMult(s2));
  };

  const fetchChatMessages = async () => {
    try {
      const { data } = await supabase
        .from('live_chat')
        .select(`
          id, user_id, message, created_at,
          profile:profiles(display_name, initials, equipped_items)
        `)
        .eq('match_id', matchId)
        .order('created_at', { ascending: false })
        .limit(20);
      
      const mappedData = (data || []).map((msg: any) => ({
        ...msg,
        profile: Array.isArray(msg.profile) ? msg.profile[0] : msg.profile
      }));
      setChatMessages(mappedData);
    } catch (err) {
      console.log('Error fetching chat:', err);
    }
  };

  const handleSendChat = async () => {
    if (!newMessage.trim() || !currentUserProfileId) return;
    
    const now = Date.now();
    if (now - lastMessageTime < 2000) {
      Alert.alert('Calma 🐢', 'Espera 2 segundos entre cada mensaje para evitar el spam.');
      return;
    }
    setLastMessageTime(now);

    const msg = newMessage.trim();
    setNewMessage('');
    const { error } = await supabase.from('live_chat').insert({
      match_id: matchId,
      user_id: currentUserProfileId,
      message: msg
    });

    if (error) {
      console.log('Failed to send message:', error);
      Alert.alert('Error', 'No se pudo enviar el mensaje: ' + error.message);
    }
  };

  const fetchWaitlistAndProfiles = async () => {
    const [profData, wlData] = await Promise.all([
      offlineSync.getProfiles(),
      fetchActiveWaitlist(),
    ]);
    if (profData) setProfiles(profData);
    if (wlData) setWaitlist(wlData);
  };

  useEffect(() => {
    settledMatchRef.current = false;
    fetchMatch();
    fetchChatMessages();
    fetchWaitlistAndProfiles();

    // Dual-channel match subscription (Instant Broadcast + Postgres Changes)
    const unsubMatch = realtimeManager.subscribeToMatch(matchId, (incoming) => {
      setMatchData((prev: any) => {
        const merged = { ...(prev || {}), ...incoming };
        checkAndSettleCompletedMatch(merged);
        return merged;
      });
    });

    const channel = supabase
      .channel(`match-live-aux-${matchId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_chat', filter: `match_id=eq.${matchId}` },
        () => { fetchChatMessages(); sounds.playSound('pop'); }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bets', filter: `match_id=eq.${matchId}` },
        () => {
          refreshUserPointsAndBets();
        }
      )
      .subscribe();

    const waitlistChannel = supabase
      .channel(`live-waitlist-${matchId}-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist' }, fetchWaitlistAndProfiles)
      .subscribe();

    const unsubWaitlistBroadcast = realtimeManager.onWaitlistChange(() => {
      fetchWaitlistAndProfiles();
    });

    return () => {
      unsubMatch();
      supabase.removeChannel(channel);
      supabase.removeChannel(waitlistChannel);
      unsubWaitlistBroadcast();
    };
  }, [matchId, currentUserProfileId]);

  const myWaitlistEntry = currentUserProfileId 
    ? waitlist.find(w => w.creator_id === currentUserProfileId || w.player1?.id === currentUserProfileId || w.player2?.id === currentUserProfileId || w.player1_id === currentUserProfileId || w.player2_id === currentUserProfileId)
    : null;

  const handleOpenJoin = () => {
    setEditingEntryId(null);
    setSelectedPartner(null);
    setShowModal(true);
  };

  const handleOpenEdit = () => {
    if (!myWaitlistEntry) return;
    setEditingEntryId(myWaitlistEntry.id);
    const partner = myWaitlistEntry.player1?.id === currentUserProfileId 
      ? myWaitlistEntry.player2 
      : myWaitlistEntry.player1;
    setSelectedPartner(partner);
    setShowModal(true);
  };

  const handleLeaveWaitlist = async () => {
    if (!myWaitlistEntry) return;
    Alert.alert('Salir de fila', '¿Seguro que quieres salir de la lista de espera?', [
      { text: 'No' },
      { text: 'Sí, salir', style: 'destructive', onPress: async () => {
        await removeWaitlistEntry(myWaitlistEntry.id);
        setShowModal(false);
        fetchWaitlistAndProfiles();
      }}
    ]);
  };

  const handleSaveWaitlist = async () => {
    if (!currentUserProfileId || !selectedPartner) return;
    const res = await joinOrUpdateWaitlist({
      currentUserId: currentUserProfileId,
      partnerId: selectedPartner.id,
      existingWaitlistId: editingEntryId || myWaitlistEntry?.id || null,
    });
    if (!res.success) {
      Alert.alert('Error', res.error || 'No se pudo pedir mesa.');
      return;
    }
    sounds.playSound('pop');
    setShowModal(false);
    fetchWaitlistAndProfiles();
  };

  // Players at the table may only bet on their own team (betting against yourself invites throwing the game)
  const myTeamNumber: 1 | 2 | null = !matchData || !currentUserProfileId
    ? null
    : [matchData.team1_player1, matchData.team1_player2].includes(currentUserProfileId)
      ? 1
      : [matchData.team2_player1, matchData.team2_player2].includes(currentUserProfileId)
        ? 2
        : null;
  const bettingClosed = !matchData || (matchData.team1_total || 0) >= 50 || (matchData.team2_total || 0) >= 50;
  const myPendingOnTeam = activeBets
    .filter((b) => b.status === 'pending' && Number(b.bet_on_team) === betTeam)
    .reduce((acc, b) => acc + Number(b.amount_wagered || 0), 0);

  const handlePlaceBet = async () => {
    if (!currentUserProfileId) return Alert.alert('Error', 'Debes iniciar sesión para apostar.');
    if (bettingClosed) return Alert.alert('Apuestas cerradas', 'Alguien ya llegó a 50 puntos.');
    if (myTeamNumber && betTeam !== myTeamNumber) {
      return Alert.alert('No permitido', 'Como jugador solo puedes apostar por tu propio equipo.');
    }
    const amount = parseInt(betAmount, 10);
    if (isNaN(amount) || amount <= 0) return Alert.alert('Error', 'Ingresa una cantidad válida.');
    if (amount > bettingPoints) return Alert.alert('Error', 'No tienes suficientes puntos.');

    const mult = betTeam === 1 ? multiplierT1 : multiplierT2;

    // Block double taps while the place_bet RPC is in flight
    if (placingBet) return;
    setPlacingBet(true);
    const result = await placeMatchBet({
      userId: currentUserProfileId,
      matchId,
      betOnTeam: betTeam,
      amount,
      multiplier: mult,
    }).finally(() => setPlacingBet(false));

    if (!result.success) {
      Alert.alert('Error', result.error || 'No se pudo realizar la apuesta.');
    } else {
      const finalMult = result.multiplier || mult;
      setBettingPoints(result.newBalance);
      setShowBetModal(false);
      fetchBets();
      sounds.playSound('pop');
      Alert.alert('Apuesta Registrada', `Has apostado ${amount} pts al Equipo ${betTeam} con multiplicador x${finalMult}. ¡Si ganan recibirás ${Math.floor(amount * finalMult)} pts automáticamente!`);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Conectando a partida en vivo...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!matchData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>No se encontró la partida.</Text>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backBtnText}>← Volver</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const players: Player[] = matchData.players_json || [];
  const rounds: Round[] = matchData.rounds || [];
  const limitScore = matchData.limit_score || 100;

  const team1Players = players.filter(p => p.teamNumber === 1);
  const team2Players = players.filter(p => p.teamNumber === 2);

  const team1Label = team1Players.map(p => p.initials).join(' & ') || 'Equipo 1';
  const team2Label = team2Players.map(p => p.initials).join(' & ') || 'Equipo 2';

  const team1Total = matchData.team1_total || 0;
  const team2Total = matchData.team2_total || 0;

  const isCompleted = matchData.status === 'completed' || team1Total >= limitScore || team2Total >= limitScore;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'padding'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25}>
        {/* Header */}
        <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← Salir</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>
            {isCompleted ? '✅ Partida Terminada' : '🔴 En Vivo'}
          </Text>
          <Text style={styles.headerSub}>Meta: {limitScore} pts</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      {/* Role Badge */}
      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>
          {isParticipant ? '⚡ Eres participante' : '👁️ Modo espectador'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Scoreboard */}
        <View style={styles.scoreboard}>
          <View style={styles.scoreCard}>
            <Text style={styles.scoreName}>{team1Label}</Text>
            <Text style={[styles.scoreValue, { color: theme.colors.primary }]}>{team1Total}</Text>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { backgroundColor: theme.colors.primary, width: `${Math.min((team1Total / limitScore) * 100, 100)}%` }]} />
            </View>
          </View>
          <View style={styles.vsContainer}><Text style={styles.vsText}>VS</Text></View>
          <View style={styles.scoreCard}>
            <Text style={styles.scoreName}>{team2Label}</Text>
            <Text style={[styles.scoreValue, { color: theme.colors.secondary }]}>{team2Total}</Text>
            <View style={styles.progressBg}>
              <View style={[styles.progressFill, { backgroundColor: theme.colors.secondary, width: `${Math.min((team2Total / limitScore) * 100, 100)}%` }]} />
            </View>
          </View>
        </View>

        {/* Betting UI */}
        {matchData.status === 'active' && currentUserProfileId && (
          <View style={styles.bettingContainer}>
            <View style={styles.bettingHeader}>
              <Text style={styles.bettingTitle}>🎯 Zona de Apuestas</Text>
              <Text style={styles.bettingPoints}>Tus puntos: <Text style={{fontWeight: 'bold', color: theme.colors.primary}}>{bettingPoints} pts</Text></Text>
            </View>

            {team1Total >= 50 || team2Total >= 50 ? (
              <Text style={styles.betClosed}>Las apuestas están cerradas (alguien llegó a 50 puntos).</Text>
            ) : (
              <View style={styles.betActions}>
                {myTeamNumber !== 2 && (
                <TouchableOpacity style={[styles.betBtn, { borderColor: theme.colors.primary }]} onPress={() => { setBetTeam(1); setShowBetModal(true); }}>
                  <Text style={[styles.betBtnText, { color: theme.colors.primary }]}>{myTeamNumber === 1 ? 'Apuesta por tu equipo' : 'Apuesta a Eq. 1'}</Text>
                  <Text style={[styles.betMult, { color: theme.colors.primary }]}>x{multiplierT1}</Text>
                </TouchableOpacity>
                )}
                {myTeamNumber !== 1 && (
                <TouchableOpacity style={[styles.betBtn, { borderColor: theme.colors.secondary }]} onPress={() => { setBetTeam(2); setShowBetModal(true); }}>
                  <Text style={[styles.betBtnText, { color: theme.colors.secondary }]}>{myTeamNumber === 2 ? 'Apuesta por tu equipo' : 'Apuesta a Eq. 2'}</Text>
                  <Text style={[styles.betMult, { color: theme.colors.secondary }]}>x{multiplierT2}</Text>
                </TouchableOpacity>
                )}
              </View>
            )}

            {activeBets.length > 0 && (
              <View style={styles.myBetsList}>
                <Text style={{color: theme.colors.textDim, marginBottom: 8, fontWeight: 'bold'}}>Mis Apuestas en esta Partida:</Text>
                {activeBets.map(b => {
                  const isWon = b.status === 'won';
                  const isLost = b.status === 'lost';
                  const payout = Math.floor(b.amount_wagered * b.multiplier);
                  return (
                    <View key={b.id} style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)'}}>
                      <View>
                        <Text style={{color: theme.colors.text, fontSize: 13, fontWeight: '600'}}>
                          {b.amount_wagered} pts al Eq. {b.bet_on_team} (x{b.multiplier})
                        </Text>
                        <Text style={{color: theme.colors.textDim, fontSize: 11}}>
                          Retorno: {payout} pts
                        </Text>
                      </View>
                      <View style={{
                        paddingHorizontal: 8,
                        paddingVertical: 4,
                        borderRadius: 6,
                        backgroundColor: isWon ? 'rgba(16, 185, 129, 0.15)' : isLost ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'
                      }}>
                        <Text style={{
                          fontSize: 12,
                          fontWeight: 'bold',
                          color: isWon ? '#10b981' : isLost ? '#ef4444' : '#f59e0b'
                        }}>
                          {isWon ? `✅ Ganada (+${payout} pts)` : isLost ? '❌ Perdida' : '⏳ En juego'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Acciones Waitlist */}
        {!isCompleted && currentUserProfileId && !isParticipant && (
          <View style={styles.waitlistActions}>
            {myWaitlistEntry ? (
              <TouchableOpacity style={styles.waitlistBtnEdit} onPress={handleOpenEdit}>
                <Text style={styles.waitlistBtnText}>✏️ Editar mi turno en fila</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.waitlistBtnJoin} onPress={handleOpenJoin}>
                <Text style={styles.waitlistBtnJoinText}>✋ Pedir Mesa (Unirse a fila)</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Waitlist List */}
        <View style={styles.history}>
          <View style={styles.waitlistContainer}>
            <Text style={styles.waitlistTitle}>📋 Lista de Espera</Text>
            {waitlist.length === 0 ? (
              <Text style={{ color: theme.colors.textDim, fontStyle: 'italic', paddingVertical: 8 }}>
                No hay nadie en fila. ¡Sé el primero en pedir mesa!
              </Text>
            ) : (
              waitlist.map((item, index) => (
                <View key={item.id} style={styles.waitlistItem}>
                  <Text style={styles.waitlistRank}>#{index + 1}</Text>
                  <View style={styles.waitlistPlayers}>
                    {item.player1?.avatar_url && <Image source={{ uri: item.player1.avatar_url }} style={styles.wlAvatar} />}
                    <Text style={styles.waitlistName}>{item.player1?.display_name || 'Desconocido'}</Text>
                    <Text style={styles.waitlistAnd}>&</Text>
                    {item.player2?.avatar_url && <Image source={{ uri: item.player2.avatar_url }} style={styles.wlAvatar} />}
                    <Text style={styles.waitlistName}>{item.player2?.display_name || 'Desconocido'}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          <Text style={styles.historyTitle}>📜 Historial de Rondas</Text>
          
          {rounds.length > 0 && <ProgressChart rounds={rounds} limitScore={limitScore} />}

          <View style={styles.historyTable}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, { color: theme.colors.primary }]}>{team1Label}</Text>
              <Text style={styles.tableHeaderDivider}>|</Text>
              <Text style={[styles.tableHeaderText, { color: theme.colors.secondary }]}>{team2Label}</Text>
            </View>
            {rounds.length === 0 ? (
              <Text style={styles.emptyText}>La partida acaba de iniciar...</Text>
            ) : (
              rounds.map((r, idx) => (
                <View key={r.id || idx} style={styles.tableRow}>
                  <View style={styles.tableCell}>
                    {r.scorerId === 'team1' && (
                      <Text style={[styles.cellPoints, { color: theme.colors.primary }]}>
                        {r.points}{r.endingType === 'trancado' ? ' T' : ''}
                      </Text>
                    )}
                  </View>
                  <View style={styles.tableRowDivider} />
                  <View style={styles.tableCell}>
                    {r.scorerId === 'team2' && (
                      <Text style={[styles.cellPoints, { color: theme.colors.secondary }]}>
                        {r.points}{r.endingType === 'trancado' ? ' T' : ''}
                      </Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        </View>

        {/* Live Chat Section */}
        <View style={[styles.chatSection, { margin: 16 }]}>
          <Text style={styles.chatTitle}>💬 Chat en Vivo</Text>
          <ScrollView style={styles.chatBox} nestedScrollEnabled={true} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' }}>
            {chatMessages.length === 0 ? (
              <Text style={styles.chatEmpty}>Aún no hay mensajes.</Text>
            ) : (
              chatMessages.slice().reverse().map(msg => {
                const isSticker = ['👍', '🥾', '🤡', '🔥', '💔'].includes(msg.message.trim());
                return (
                  <View key={msg.id} style={styles.chatMsgRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
                      {msg.profile?.equipped_items?.color === 'rainbow' ? (
                        <RainbowText style={[styles.chatName, { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 }]}>
                          {msg.profile?.display_name || 'Desconocido'}:
                        </RainbowText>
                      ) : (
                        <Text style={[styles.chatName, { color: msg.profile?.equipped_items?.color || theme.colors.text }]}>
                          {msg.profile?.display_name || 'Anónimo'}:
                        </Text>
                      )}
                    </View>
                    <Text style={[styles.chatText, isSticker && { fontSize: 40, lineHeight: 45 }]}>
                      {msg.message}
                    </Text>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
      </ScrollView>

      {Platform.OS === 'web' ? (
        <View style={{ flex: 1, maxHeight: 300 }}>
          {/* Reacciones */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, gap: 12 }}>
            {['👍', '🥾', '🤡', '🔥', '💔'].map(emoji => (
              <TouchableOpacity 
                key={emoji} 
                onPress={async () => {
                  if (!currentUserProfileId || !matchId) return;
                  const { error } = await supabase.from('live_chat').insert({ match_id: matchId, user_id: currentUserProfileId, message: emoji });
                  if (error) Alert.alert('Error', error.message);
                }}
                style={{ backgroundColor: theme.colors.card, padding: 8, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.cardBorder }}
              >
                <Text style={{ fontSize: 24 }}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Chat Input */}
          <View style={styles.chatInputContainer}>
            <TextInput
              style={styles.chatInput}
              placeholder="Escribe un mensaje..."
              placeholderTextColor={theme.colors.textDim}
              value={newMessage}
              onChangeText={setNewMessage}
              onSubmitEditing={handleSendChat}
            />
            <TouchableOpacity style={styles.chatSendBtn} onPress={handleSendChat}>
              <Text style={styles.chatSendText}>Enviar</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 25}>
          {/* Reactions Row */}
          <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8, gap: 12 }}>
            {['👍', '🥾', '🤡', '🔥', '💔'].map(emoji => (
              <TouchableOpacity 
                key={emoji} 
                onPress={async () => {
                  if (!currentUserProfileId || !matchId) return;
                  const { error } = await supabase.from('live_chat').insert({ match_id: matchId, user_id: currentUserProfileId, message: emoji });
                  if (error) Alert.alert('Error', error.message);
                }}
                style={{ backgroundColor: theme.colors.card, padding: 8, borderRadius: 20, borderWidth: 1, borderColor: theme.colors.cardBorder }}
              >
                <Text style={{ fontSize: 24 }}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Chat Input */}
          <View style={styles.chatInputContainer}>
            <TextInput
              style={styles.chatInput}
              placeholder="Escribe un mensaje..."
              placeholderTextColor={theme.colors.textDim}
              value={newMessage}
              onChangeText={setNewMessage}
              onSubmitEditing={handleSendChat}
            />
            <TouchableOpacity style={styles.chatSendBtn} onPress={handleSendChat}>
              <Text style={styles.chatSendText}>Enviar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Bet Modal */}
      <Modal visible={showBetModal} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Apostar al Equipo {betTeam}</Text>
            <Text style={styles.modalSubtitle}>
              Multiplicador: x{betTeam === 1 ? multiplierT1 : multiplierT2}
            </Text>
            <Text style={{color: theme.colors.text, marginTop: 10, alignSelf: 'flex-start'}}>¿Cuántos puntos deseas apostar?</Text>
            <Text style={{color: theme.colors.textDim, fontSize: 12, marginBottom: 10, alignSelf: 'flex-start'}}>Saldo disponible: {bettingPoints}</Text>
            {myPendingOnTeam > 0 && (
              <Text style={styles.betTopUpNote}>
                Ya llevas {myPendingOnTeam} pts en el Eq. {betTeam}. Lo que pongas ahora se suma con la cuota actual.
              </Text>
            )}
            <View style={styles.betQuickRow}>
              {[1000, 3000].map((inc) => (
                <TouchableOpacity
                  key={inc}
                  style={styles.betQuickBtn}
                  onPress={() => setBetAmount(String(Math.min(bettingPoints, (parseInt(betAmount, 10) || 0) + inc)))}
                >
                  <Text style={styles.betQuickText}>+{inc}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.betQuickBtn} onPress={() => setBetAmount(String(bettingPoints))}>
                <Text style={styles.betQuickText}>Todo 🔥</Text>
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.modalInput}
              keyboardType="number-pad"
              value={betAmount}
              onChangeText={setBetAmount}
              placeholder="10"
              placeholderTextColor="#888"
            />
            
            <View style={styles.modalBtns}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setShowBetModal(false)}>
                <Text style={styles.modalBtnCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnSave]} onPress={handlePlaceBet} disabled={placingBet}>
                <Text style={styles.modalBtnSaveText}>Apostar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Waitlist Modal */}
      <Modal visible={showModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingEntryId ? 'Editar Dúo' : 'Pedir Mesa'}</Text>
            
            <View style={styles.selectedDuoContainer}>
              <View style={styles.duoMember}>
                <Text style={styles.duoMemberLabel}>Tú</Text>
                <Text style={styles.duoMemberName}>
                  {profiles.find(p => p.id === currentUserProfileId)?.display_name}
                </Text>
              </View>
              <Text style={styles.duoAnd}>&</Text>
              <View style={styles.duoMember}>
                <Text style={styles.duoMemberLabel}>Compañero</Text>
                <Text style={styles.duoMemberName}>
                  {selectedPartner ? selectedPartner.display_name : '(Selecciona abajo)'}
                </Text>
              </View>
            </View>

            <Text style={styles.selectLabel}>Selecciona a tu compañero:</Text>
            <ScrollView style={styles.profilesScroll} horizontal showsHorizontalScrollIndicator={false}>
              {profiles.filter(p => p.id !== currentUserProfileId).map(p => {
                const isSel = selectedPartner?.id === p.id;
                // Si el jugador ya esta en la fila (y no es con el que me estoy editando) o esta jugando
                const inWaitlist = waitlist.some(w => w.id !== editingEntryId && (w.player1?.id === p.id || w.player2?.id === p.id));
                const inGame = [matchData.team1_player1, matchData.team1_player2, matchData.team2_player1, matchData.team2_player2].includes(p.id);
                const disabled = inWaitlist || inGame;

                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.profileChip, isSel && styles.profileChipSelected, disabled && styles.profileChipDisabled]}
                    onPress={() => !disabled && setSelectedPartner(p)}
                    activeOpacity={disabled ? 1 : 0.7}
                  >
                    <View style={[styles.profileAvatar, isSel && styles.profileAvatarSelected]}>
                      {p.avatar_url ? (
                        <Image source={{ uri: p.avatar_url }} style={styles.modalAvatarImg} />
                      ) : (
                        <Text style={styles.profileAvatarText}>{p.initials}</Text>
                      )}
                    </View>
                    <Text style={[styles.profileName, isSel && styles.profileNameSelected, disabled && {textDecorationLine:'line-through'}]}>
                      {p.display_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setShowModal(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              {editingEntryId && (
                <TouchableOpacity style={styles.modalLeaveBtn} onPress={handleLeaveWaitlist}>
                  <Text style={styles.modalLeaveText}>Salir de Fila</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity 
                style={[styles.modalSaveBtn, !selectedPartner && {opacity: 0.5}]} 
                onPress={handleSaveWaitlist}
                disabled={!selectedPartner}
              >
                <Text style={styles.modalSaveText}>Guardar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: theme.colors.textDim, fontSize: 16 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.l, paddingVertical: theme.spacing.m,
    borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder,
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  headerSub: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  backBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  backBtnText: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
  roleBadge: {
    alignSelf: 'center', marginVertical: theme.spacing.m,
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing.l, paddingVertical: theme.spacing.s,
    borderWidth: 1, borderColor: theme.colors.cardBorder,
  },
  roleBadgeText: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  scoreboard: {
    flexDirection: 'row', paddingHorizontal: theme.spacing.m,
    alignItems: 'center', gap: theme.spacing.s, marginBottom: theme.spacing.m,
  },
  scoreCard: {
    flex: 1, backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.cardBorder,
  },
  scoreName: { color: theme.colors.textDim, fontSize: 13, fontWeight: '700', marginBottom: 4, textAlign: 'center' },
  scoreValue: { fontSize: 52, fontWeight: '900', marginBottom: 8 },
  progressBg: { width: '100%', height: 5, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  vsContainer: { alignItems: 'center', paddingHorizontal: 4 },
  vsText: { color: theme.colors.textDim, fontWeight: '900', fontSize: 16 },
  history: { flex: 1, paddingHorizontal: theme.spacing.m },
  historyTable: {
    backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.m,
    borderWidth: 1, borderColor: theme.colors.cardBorder, overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row', paddingVertical: theme.spacing.m,
    borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder,
  },
  tableHeaderText: { flex: 1, textAlign: 'center', fontWeight: '800', fontSize: 14 },
  tableHeaderDivider: { color: theme.colors.cardBorder, fontWeight: '900' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)', minHeight: 40 },
  tableCell: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.s },
  tableRowDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.05)' },
  cellPoints: { fontSize: 20, fontWeight: '900' },
  emptyText: { color: theme.colors.textDim, textAlign: 'center', padding: theme.spacing.xl, fontStyle: 'italic' },
  
  // Waitlist styles
  waitlistActions: { paddingHorizontal: theme.spacing.m, marginBottom: theme.spacing.m },
  waitlistBtnJoin: { backgroundColor: theme.colors.primary, padding: theme.spacing.m, borderRadius: theme.borderRadius.full, alignItems: 'center' },
  waitlistBtnJoinText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  waitlistBtnEdit: { backgroundColor: 'rgba(255,255,255,0.1)', padding: theme.spacing.m, borderRadius: theme.borderRadius.full, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.cardBorder },
  waitlistBtnText: { color: theme.colors.text, fontWeight: 'bold', fontSize: 14 },
  
  waitlistContainer: { backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.m, padding: theme.spacing.m, marginBottom: theme.spacing.l, borderWidth: 1, borderColor: theme.colors.cardBorder },
  waitlistTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '800', marginBottom: theme.spacing.s },
  waitlistItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.s, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  waitlistRank: { color: theme.colors.primary, fontSize: 16, fontWeight: '900', width: 30 },
  waitlistPlayers: { flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  wlAvatar: { width: 20, height: 20, borderRadius: 10 },
  waitlistName: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  waitlistAnd: { color: theme.colors.textDim, fontSize: 12 },
  
  historyTitle: { color: theme.colors.textDim, fontSize: 14, fontWeight: '700', marginBottom: theme.spacing.s, marginLeft: 4 },

  // Modal styles
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: theme.colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: theme.spacing.xl, paddingBottom: 40 },
  modalTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '900', marginBottom: theme.spacing.l },
  selectedDuoContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.l, backgroundColor: theme.colors.card, padding: theme.spacing.m, borderRadius: theme.borderRadius.m, marginBottom: theme.spacing.l },
  duoMember: { alignItems: 'center' },
  duoMemberLabel: { color: theme.colors.textDim, fontSize: 12, marginBottom: 4 },
  duoMemberName: { color: theme.colors.primary, fontSize: 16, fontWeight: 'bold' },
  duoAnd: { color: theme.colors.textDim, fontSize: 24, fontWeight: '300' },
  selectLabel: { color: theme.colors.textDim, fontSize: 14, marginBottom: theme.spacing.s },
  profilesScroll: { flexDirection: 'row', marginBottom: theme.spacing.xl },
  profileChip: { alignItems: 'center', marginRight: theme.spacing.m, opacity: 0.8 },
  profileChipSelected: { opacity: 1 },
  profileChipDisabled: { opacity: 0.3 },
  profileAvatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,255,255,0.1)', justifyContent: 'center', alignItems: 'center', marginBottom: 4, borderWidth: 2, borderColor: 'transparent' },
  profileAvatarSelected: { borderColor: theme.colors.primary },
  modalAvatarImg: { width: '100%', height: '100%', borderRadius: 25 },
  profileAvatarText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  profileName: { color: theme.colors.textDim, fontSize: 12, maxWidth: 60, textAlign: 'center' },
  profileNameSelected: { color: theme.colors.primary, fontWeight: 'bold' },
  
  modalActions: { flexDirection: 'row', gap: theme.spacing.s },
  modalCancelBtn: { flex: 1, padding: theme.spacing.m, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: theme.borderRadius.full, alignItems: 'center' },
  modalBtnCancelText: { color: theme.colors.text, fontWeight: 'bold' },
  modalBtnSaveText: { color: '#fff', fontWeight: 'bold' },
  betTopUpNote: { color: theme.colors.accent, fontSize: 12, marginBottom: 10, alignSelf: 'flex-start' },
  betQuickRow: { flexDirection: 'row', gap: 8, width: '100%', marginBottom: 10 },
  betQuickBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.cardBorder, alignItems: 'center' },
  betQuickText: { color: theme.colors.text, fontWeight: '700', fontSize: 13 },
  modalInput: { backgroundColor: theme.colors.background, width: '100%', borderRadius: 8, padding: 12, color: theme.colors.text, fontSize: 16, marginBottom: 24, borderWidth: 1, borderColor: theme.colors.cardBorder },
  
  bettingContainer: { marginHorizontal: 16, marginBottom: 16, backgroundColor: theme.colors.card, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: theme.colors.cardBorder },
  bettingHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' },
  bettingTitle: { fontSize: 16, fontWeight: 'bold', color: theme.colors.text },
  bettingPoints: { fontSize: 14, color: theme.colors.text },
  betClosed: { color: theme.colors.danger, fontStyle: 'italic', textAlign: 'center' },
  betActions: { flexDirection: 'row', gap: 12 },
  betBtn: { flex: 1, padding: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  betBtnText: { fontWeight: 'bold', marginBottom: 4 },
  betMult: { fontSize: 12 },
  myBetsList: { marginTop: 16, padding: 12, backgroundColor: theme.colors.background, borderRadius: 8 },
  modalLeaveBtn: { flex: 1, padding: theme.spacing.m, backgroundColor: 'rgba(239,68,68,0.2)', borderRadius: theme.borderRadius.full, alignItems: 'center' },
  modalLeaveText: { color: theme.colors.danger, fontWeight: '600' },
  modalSaveBtn: { flex: 1.5, padding: theme.spacing.m, backgroundColor: theme.colors.primary, borderRadius: theme.borderRadius.full, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontWeight: 'bold' },
  chatSection: { backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.l, padding: theme.spacing.m, borderWidth: 1, borderColor: theme.colors.cardBorder },
  chatTitle: { color: theme.colors.text, fontSize: 16, fontWeight: '800', marginBottom: theme.spacing.s },
  chatBox: { maxHeight: 200, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: theme.borderRadius.m, padding: theme.spacing.s },
  chatEmpty: { color: theme.colors.textDim, fontSize: 13, fontStyle: 'italic', textAlign: 'center', padding: theme.spacing.m },
  chatMsgRow: { flexDirection: 'row', marginBottom: 6, flexWrap: 'wrap' },
  chatName: { fontWeight: '700', marginRight: 6, fontSize: 14 },
  chatText: { color: theme.colors.text, fontSize: 14, flexShrink: 1 },
  chatInputContainer: { flexDirection: 'row', padding: theme.spacing.m, backgroundColor: theme.colors.card, borderTopWidth: 1, borderTopColor: theme.colors.cardBorder, alignItems: 'center', gap: theme.spacing.m },
  chatInput: { flex: 1, backgroundColor: theme.colors.background, color: theme.colors.text, paddingHorizontal: theme.spacing.m, paddingVertical: 10, borderRadius: theme.borderRadius.full, borderWidth: 1, borderColor: theme.colors.cardBorder },
  chatSendBtn: { backgroundColor: theme.colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: theme.borderRadius.full },
  chatSendText: { color: '#fff', fontWeight: '800' },
  modalSubtitle: { color: theme.colors.primary, fontSize: 14, marginBottom: theme.spacing.s },
  modalBtns: { flexDirection: 'row', gap: theme.spacing.s },
  modalBtn: { flex: 1, padding: theme.spacing.m, borderRadius: theme.borderRadius.full, alignItems: 'center' },
  modalBtnCancel: { backgroundColor: 'rgba(255,255,255,0.1)' },
  modalBtnSave: { backgroundColor: theme.colors.primary },
  modalCancelText: { color: theme.colors.text, fontWeight: 'bold' },
});
