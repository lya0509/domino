import React, { useState, useEffect } from 'react';
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
  const [profiles, setProfiles] = useState<Profile[]>([]);
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
  const [lastMessageTime, setLastMessageTime] = useState(0);

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

        const { data: prof } = await supabase.from('profiles').select('betting_points').eq('id', currentUserProfileId).single();
        if (prof) setBettingPoints(prof.betting_points || 0);

        fetchBets();
        calculateMultipliers(data);
      }
    }
    setLoading(false);
  };

  const fetchBets = async () => {
    const { data } = await supabase.from('bets').select('*').eq('match_id', matchId).eq('user_id', currentUserProfileId);
    if (data) setActiveBets(data);
  };

  const calculateMultipliers = async (matchInfo: any) => {
    const { data } = await supabase.from('matches').select('winner_team, team1_player1, team1_player2, team2_player1, team2_player2').eq('status', 'completed');
    
    const getStats = (p1: string, p2: string) => {
      let total = 0, wins = 0;
      data?.forEach(m => {
        const t1 = [m.team1_player1, m.team1_player2];
        const t2 = [m.team2_player1, m.team2_player2];
        if (t1.includes(p1) && t1.includes(p2)) { total++; if (m.winner_team === 1) wins++; }
        if (t2.includes(p1) && t2.includes(p2)) { total++; if (m.winner_team === 2) wins++; }
      });
      return { total, wins };
    };

    const s1 = getStats(matchInfo.team1_player1, matchInfo.team1_player2);
    const s2 = getStats(matchInfo.team2_player1, matchInfo.team2_player2);

    const calcMult = (s: {total: number, wins: number}) => {
      if (s.total === 0) return 2.0;
      let wr = s.wins / s.total;
      if (wr < 0.1) wr = 0.1;
      if (wr > 0.9) wr = 0.9;
      return parseFloat((1 / wr).toFixed(2));
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

  useEffect(() => {
    fetchMatch();
    fetchChatMessages();

    const channel = supabase
      .channel(`match-live-${matchId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
        (payload) => { setMatchData(payload.new); }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'live_chat', filter: `match_id=eq.${matchId}` },
        () => { fetchChatMessages(); sounds.playSound('pop'); }
      )
      .subscribe();

    const fetchWaitlistAndProfiles = async () => {
      const { data: profData } = await supabase.from('profiles').select('*').order('display_name');
      if (profData) setProfiles(profData);
      const { data: wlData } = await supabase
        .from('waitlist')
        .select(`
          id, created_at, status, creator_id,
          player1:profiles!waitlist_player1_id_fkey(id, display_name, initials, avatar_url),
          player2:profiles!waitlist_player2_id_fkey(id, display_name, initials, avatar_url)
        `)
        .eq('status', 'waiting')
        .order('created_at', { ascending: true });
      if (wlData) setWaitlist(wlData);
    };

    fetchWaitlistAndProfiles();

    const waitlistChannel = supabase
      .channel(`live-waitlist-${matchId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'waitlist' }, fetchWaitlistAndProfiles)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(waitlistChannel);
    };
  }, [matchId]);

  const myWaitlistEntry = currentUserProfileId 
    ? waitlist.find(w => w.player1?.id === currentUserProfileId || w.player2?.id === currentUserProfileId)
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
        await supabase.from('waitlist').update({ status: 'cancelled' }).eq('id', myWaitlistEntry.id);
        setShowModal(false);
      }}
    ]);
  };

  const handleSaveWaitlist = async () => {
    if (!currentUserProfileId || !selectedPartner) return;
    
    if (editingEntryId) {
      const { error } = await supabase.from('waitlist').update({
        player1_id: currentUserProfileId,
        player2_id: selectedPartner.id
      }).eq('id', editingEntryId);
      if (error) Alert.alert('Error', 'No se pudo editar: ' + error.message);
    } else {
      const { error } = await supabase.from('waitlist').insert({
        creator_id: currentUserProfileId,
        player1_id: currentUserProfileId,
        player2_id: selectedPartner.id,
        status: 'waiting'
      });
      if (error) Alert.alert('Error', 'No se pudo pedir mesa: ' + error.message);
    }
    setShowModal(false);
  };

  const handlePlaceBet = async () => {
    const amount = parseInt(betAmount);
    if (isNaN(amount) || amount <= 0) return Alert.alert('Error', 'Ingresa una cantidad válida.');
    if (amount > bettingPoints) return Alert.alert('Error', 'No tienes suficientes puntos.');

    const mult = betTeam === 1 ? multiplierT1 : multiplierT2;

    const { error } = await supabase.from('bets').insert({
      user_id: currentUserProfileId,
      match_id: matchId,
      bet_on_team: betTeam,
      amount_wagered: amount,
      multiplier: mult,
      status: 'pending'
    });

    if (error) {
      Alert.alert('Error', 'No se pudo realizar la apuesta.');
    } else {
      const newPoints = bettingPoints - amount;
      setBettingPoints(newPoints);
      await supabase.from('profiles').update({ betting_points: newPoints }).eq('id', currentUserProfileId);
      setShowBetModal(false);
      fetchBets();
      Alert.alert('Apuesta Registrada', `Has apostado ${amount} pts al Equipo ${betTeam} con multiplicador x${mult}`);
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
        {!isParticipant && matchData.status === 'active' && currentUserProfileId && (
          <View style={styles.bettingContainer}>
            <View style={styles.bettingHeader}>
              <Text style={styles.bettingTitle}>🎯 Zona de Apuestas</Text>
              <Text style={styles.bettingPoints}>Tus puntos: <Text style={{fontWeight: 'bold', color: theme.colors.primary}}>{bettingPoints} pts</Text></Text>
            </View>

            {team1Total >= 50 || team2Total >= 50 ? (
              <Text style={styles.betClosed}>Las apuestas están cerradas (alguien llegó a 50 puntos).</Text>
            ) : (
              <View style={styles.betActions}>
                <TouchableOpacity style={[styles.betBtn, { borderColor: theme.colors.primary }]} onPress={() => { setBetTeam(1); setShowBetModal(true); }}>
                  <Text style={[styles.betBtnText, { color: theme.colors.primary }]}>Apuesta a Eq. 1</Text>
                  <Text style={[styles.betMult, { color: theme.colors.primary }]}>x{multiplierT1}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.betBtn, { borderColor: theme.colors.secondary }]} onPress={() => { setBetTeam(2); setShowBetModal(true); }}>
                  <Text style={[styles.betBtnText, { color: theme.colors.secondary }]}>Apuesta a Eq. 2</Text>
                  <Text style={[styles.betMult, { color: theme.colors.secondary }]}>x{multiplierT2}</Text>
                </TouchableOpacity>
              </View>
            )}

            {activeBets.length > 0 && (
              <View style={styles.myBetsList}>
                <Text style={{color: theme.colors.textDim, marginBottom: 4, fontWeight: 'bold'}}>Mis Apuestas Activas:</Text>
                {activeBets.map(b => (
                  <Text key={b.id} style={{color: theme.colors.text}}>
                    Apostaste <Text style={{fontWeight: 'bold'}}>{b.amount_wagered} pts</Text> al Eq. {b.bet_on_team} (Paga: {Math.floor(b.amount_wagered * b.multiplier)} pts)
                  </Text>
                ))}
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
              <TouchableOpacity style={[styles.modalBtn, styles.modalBtnSave]} onPress={handlePlaceBet}>
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
