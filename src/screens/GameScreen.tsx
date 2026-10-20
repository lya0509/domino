import React, { useState, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, SafeAreaView, Platform, Alert, KeyboardAvoidingView } from 'react-native';
import { theme } from '../theme';
import { Match, Round, Player } from '../types';
import * as Sharing from 'expo-sharing';
import { ProgressChart } from '../components/ProgressChart';
import { WagerStatusBanner } from '../components/WagerConsent';
import { supabase } from '../lib/supabase';
import * as Haptics from 'expo-haptics';
import { sounds } from '../lib/sounds';
import { offlineSync } from '../lib/offlineSync';
import { realtimeManager } from '../lib/realtimeManager';
import { fetchActiveWaitlist, callWaitlistDuo } from '../lib/waitlistService';

let captureRef: any;
let ConfettiCannon: any;

if (Platform.OS !== 'web') {
  captureRef = require('react-native-view-shot').captureRef;
  ConfettiCannon = require('react-native-confetti-cannon').default;
}

interface Props {
  match: Match;
  onUpdateMatch: (match: Match, fromRemote?: boolean) => void;
  onEndMatch: (winnerId: string) => void;
  currentUserProfileId?: string | null;
  isAdmin?: boolean;
  onBack?: () => void;
}

export const GameScreen: React.FC<Props> = ({ match, onUpdateMatch, onEndMatch, currentUserProfileId, isAdmin, onBack }) => {
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [endingType, setEndingType] = useState<'normal' | 'trancado'>('normal');
  const [winnerData, setWinnerData] = useState<{ id: string, isZapato: boolean } | null>(null);
  const [showDuoModal, setShowDuoModal] = useState(false);
  const [duoPendingWinnerId, setDuoPendingWinnerId] = useState<string | null>(null);

  const [scorerId, setScorerId] = useState<string>('');
  const [pointsStr, setPointsStr] = useState<string>('');

  const [isSubModalOpen, setIsSubModalOpen] = useState(false);
  const [subPlayerToReplace, setSubPlayerToReplace] = useState<Player | null>(null);
  const [subProfiles, setSubProfiles] = useState<any[]>([]);
  const [isSelectSubModalOpen, setIsSelectSubModalOpen] = useState(false);
  const [tableColor, setTableColor] = useState<string | null>(null);
  const proximityAlertSent = useRef(false);

  const viewRef = useRef(null);
  const winnerRef = useRef(null);

  useEffect(() => {
    const fetchTableColor = async () => {
      if (!match.created_by) return;
      const cached = offlineSync.getCachedProfilesSync().find(p => p.id === match.created_by);
      if (cached?.equipped_items?.table_color) {
        setTableColor(cached.equipped_items.table_color);
        return;
      }
      if (!offlineSync.getIsOnline()) return;
      const { data } = await supabase.from('profiles').select('equipped_items').eq('id', match.created_by).single();
      if (data?.equipped_items?.table_color) {
        setTableColor(data.equipped_items.table_color);
      }
    };
    fetchTableColor();
  }, [match.created_by]);

  // Calculate totals
  const getTotals = () => {
    const totals: Record<string, number> = {};
    match.players.forEach(p => {
      const key = match.gameMode === 'teams' ? `team${p.teamNumber}` : p.id;
      totals[key] = 0;
    });
    match.rounds.forEach(r => {
      if (totals[r.scorerId] !== undefined) {
        totals[r.scorerId] += r.points;
      }
    });
    return totals;
  };

  const totals = getTotals();

  // Check for winner
  useEffect(() => {
    if (winnerData) return;
    for (const [key, score] of Object.entries(totals)) {
      if (score >= match.limitScore) {
        let isZapato = false;
        if (match.gameMode === 'teams') {
          const loserKey = key === 'team1' ? 'team2' : 'team1';
          if (totals[loserKey] === 0) isZapato = true;
        } else {
          const otherScores = Object.entries(totals).filter(([k]) => k !== key).map(([_, s]) => s);
          if (otherScores.every(s => s === 0)) isZapato = true;
        }
        setWinnerData({ id: key, isZapato });
        if (isZapato) {
          sounds.playSound('slap');
        } else {
          sounds.playSound('clap');
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  }, [totals, match.limitScore, winnerData]);

  // Proximity Alert Helper (Match DB sync is handled in App.tsx handleUpdateMatch with offline queue + broadcast)
  const syncToSupabase = async (updatedMatch: Match) => {
    if (updatedMatch.isGuestMode || !updatedMatch.id || !updatedMatch.id.includes('-')) return;
    try {
      const currentTotals = { team1: 0, team2: 0 };
      updatedMatch.rounds.forEach(r => {
        if (r.scorerId === 'tie') return;
        if (r.scorerId === 'team1' || r.scorerId === 'team2') {
          currentTotals[r.scorerId] += r.points;
        } else {
          const player = updatedMatch.players.find(p => p.id === r.scorerId);
          if (player) {
            const key = `team${player.teamNumber}` as keyof typeof currentTotals;
            currentTotals[key] += r.points;
          }
        }
      });

      const highestScore = Math.max(currentTotals.team1, currentTotals.team2);
      if (
        !proximityAlertSent.current &&
        updatedMatch.limitScore > 0 &&
        highestScore >= updatedMatch.limitScore - 10 &&
        offlineSync.getIsOnline()
      ) {
        proximityAlertSent.current = true;
        await realtimeManager.broadcastProximityAlert({
          matchId: updatedMatch.id,
          highestScore,
          limitScore: updatedMatch.limitScore,
          pointsLeft: Math.max(1, updatedMatch.limitScore - highestScore),
        });
      }
    } catch (e) {
      console.error('Error checking proximity alert:', e);
    }
  };

  // Realtime Subscription (Broadcast + Postgres Changes)
  useEffect(() => {
    if (match.isGuestMode || !match.id || !match.id.includes('-')) return;

    const unsub = realtimeManager.subscribeToMatch(match.id, (newMatchData) => {
      if (
        newMatchData.rounds &&
        (newMatchData.rounds.length !== match.rounds.length ||
          (newMatchData.substitutions || []).length !== (match.substitutions || []).length)
      ) {
        onUpdateMatch(
          {
            ...match,
            rounds: newMatchData.rounds,
            substitutions: newMatchData.substitutions || [],
            players: newMatchData.players_json || match.players,
            status: newMatchData.status || match.status,
          },
          true
        );
      }
    });

    return () => {
      unsub();
    };
  }, [match.id, match.rounds.length, (match.substitutions || []).length]);

  const handleOpenScoreModal = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (match.isGuestMode) {
      setScorerId(id);
      setEndingType('normal');
      setPointsStr('');
      setIsAddModalOpen(true);
      return;
    }

    const isParticipant = match.players.some(p => p.profileId === currentUserProfileId);
    
    if (!isParticipant && !isAdmin) {
      Alert.alert('Solo Lectura', 'Solo los jugadores de la partida pueden anotar puntos.');
      return;
    }

    setScorerId(id);
    setEndingType('normal');
    setPointsStr('');
    setIsAddModalOpen(true);
  };

  const handleAddPoints = () => {
    const pts = parseInt(pointsStr, 10);
    if (isNaN(pts) || pts < 0) {
      Alert.alert('Error', 'Ingresa un puntaje válido.');
      return;
    }
    const type = scorerId === 'tie' ? 'trancado' : endingType;
    
    const newRound: Round = {
      id: Math.random().toString(36).substring(7),
      roundNumber: match.rounds.length + 1,
      scorerId: scorerId,
      points: pts,
      endingType: type,
    };
    const newMatch = { ...match, rounds: [...match.rounds, newRound] };
    onUpdateMatch(newMatch, false);
    syncToSupabase(newMatch);
    
    sounds.playSound('pop');
    
    setPointsStr('');
    setScorerId('');
    setIsAddModalOpen(false);
  };

  const handleUndo = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (match.rounds.length > 0) {
      const newRounds = match.rounds.slice(0, -1);
      const newMatch = { ...match, rounds: newRounds };
      onUpdateMatch(newMatch, false);
      syncToSupabase(newMatch);
      if (winnerData) setWinnerData(null);
    }
  };

  const getEntityName = (id: string) => {
    if (id === 'team1') {
      const teamPlayers = match.players.filter(p => p.teamNumber === 1);
      return teamPlayers.map(p => p.initials).join(' & ');
    }
    if (id === 'team2') {
      const teamPlayers = match.players.filter(p => p.teamNumber === 2);
      return teamPlayers.map(p => p.initials).join(' & ');
    }
    const p = match.players.find(pl => pl.id === id);
    return p ? p.initials : 'Empate';
  };

  const entities = match.gameMode === 'teams'
    ? [{ id: 'team1', label: getEntityName('team1'), color: theme.colors.primary },
       { id: 'team2', label: getEntityName('team2'), color: theme.colors.secondary }]
    : match.players.map((p, i) => ({
        id: p.id, label: p.initials,
        color: i % 2 === 0 ? theme.colors.primary : theme.colors.secondary,
      }));

  const captureAndShare = async (ref: React.RefObject<any>) => {
    if (Platform.OS === 'web') {
      Alert.alert('No Disponible', 'Compartir captura no está disponible en web.');
      return;
    }
    try {
      if (ref.current) {
        const uri = await captureRef(ref, {
          format: 'png',
          quality: 0.9,
        });
        await Sharing.shareAsync(uri, {
          dialogTitle: '¡Mira este resultado en Dominó!',
        });
      }
    } catch (error) {
      console.error('Error sharing image:', error);
      Alert.alert('Error', 'No se pudo compartir la imagen');
    }
  };

  const handleOpenSubstitution = async () => {
    setIsSubModalOpen(true);
    if (!match.isGuestMode) {
      const profiles = await offlineSync.getProfiles();
      if (profiles) setSubProfiles(profiles);
    }
  };

  const handleConfirmSub = (profile: any) => {
    if (!subPlayerToReplace) return;
    const totals = getTotals();
    const teamScore = match.gameMode === 'teams' ? totals[`team${subPlayerToReplace.teamNumber}`] : totals[subPlayerToReplace.id];

    const newSub = {
      originalId: subPlayerToReplace.id,
      originalProfileId: subPlayerToReplace.profileId,
      subName: typeof profile === 'string' ? profile : profile.display_name,
      subInitials: typeof profile === 'string' ? profile.substring(0, 2).toUpperCase() : profile.initials,
      subProfileId: typeof profile === 'string' ? undefined : profile.id,
      teamScoreAtSub: teamScore || 0,
    };

    const updatedPlayers = match.players.map(p => {
      if (p.id === subPlayerToReplace.id) {
        return { ...p, name: newSub.subName, initials: newSub.subInitials, profileId: newSub.subProfileId };
      }
      return p;
    });

    const newMatch = {
      ...match,
      players: updatedPlayers,
      substitutions: [...(match.substitutions || []), newSub]
    };
    onUpdateMatch(newMatch, false);
    syncToSupabase(newMatch);

    setIsSelectSubModalOpen(false);
    setSubPlayerToReplace(null);
    Alert.alert('Cambio Exitoso', `Entró ${newSub.subName} por ${subPlayerToReplace.name}`);
  };

  const handleFinishMatch = async (winnerId: string) => {
    if (currentUserProfileId && match.gameMode === 'teams' && !match.isGuestMode && offlineSync.getIsOnline()) {
      const myTeam = match.players.filter(p => p.profileId === currentUserProfileId);
      if (myTeam.length > 0) {
        const teammate = match.players.find(
          p => p.teamNumber === myTeam[0].teamNumber && p.profileId !== currentUserProfileId
        );
        if (teammate?.profileId) {
          try {
            const { data: existingDuo } = await supabase
              .from('duos')
              .select('*')
              .or(`and(player1_id.eq.${currentUserProfileId},player2_id.eq.${teammate.profileId}),and(player1_id.eq.${teammate.profileId},player2_id.eq.${currentUserProfileId})`);

            // Only ask when there is no ACTIVE duo in either order (a cancelled duo can be reactivated)
            const hasActiveDuo = (existingDuo || []).some((d: any) => d.is_active !== false);
            if (!hasActiveDuo) {
              setDuoPendingWinnerId(winnerId);
              setShowDuoModal(true);
              return;
            }
          } catch {}
        }
      }
    }
    onEndMatch(winnerId);
  };

  const handleCallNextWaitlistDuo = async () => {
    try {
      const queue = await fetchActiveWaitlist();

      if (!queue || queue.length === 0) {
        Alert.alert('Lista de Espera Vacía', 'No hay ningún dúo esperando en la lista en este momento.');
        return;
      }

      const nextDuo = queue[0];
      const p1Name = nextDuo.player1?.display_name || 'Jugador 1';
      const p2Name = nextDuo.player2?.display_name || 'Jugador 2';

      await callWaitlistDuo(nextDuo, 'La Mesa');
      sounds.playSound('pop');
      Alert.alert(
        '🚨 ¡Dúo Llamado a la Mesa!',
        `Se ha activado la alarma para ${p1Name} & ${p2Name}. Tienen 30 segundos para sentarse a jugar.`
      );
    } catch (e: any) {
      console.error('Error calling waitlist duo:', e);
      Alert.alert('Error', 'No se pudo enviar la llamada al dúo.');
    }
  };

  // Build two-column history data
  const buildColumnData = () => {
    if (entities.length < 2) return { left: entities[0], right: entities[0], rows: [] };
    const left = entities[0];
    const right = entities[1];
    const rows = match.rounds.map(r => ({
      id: r.id,
      leftPoints: r.scorerId === left.id ? r.points : null,
      rightPoints: r.scorerId === right.id ? r.points : null,
      isTrancado: r.endingType === 'trancado',
      isTie: r.scorerId === 'tie',
      tiePoints: r.points
    }));
    return { left, right, rows };
  };

  const columnData = buildColumnData();

  // Salida / Mano calculation
  const hasOrder = match.players.every(p => p.order !== undefined);
  const currentManoIndex = match.rounds.length % 4;
  const currentManoPlayer = match.players.find(p => p.order === currentManoIndex);

  return (
    <SafeAreaView style={[styles.container, tableColor ? { backgroundColor: tableColor } : {}]}>
      <View ref={viewRef} collapsable={false} style={styles.shareContainer}>
        <View style={styles.header}>
          {onBack ? (
            <TouchableOpacity onPress={onBack} style={styles.backBtn}>
              <Text style={styles.backBtnText}>Volver</Text>
            </TouchableOpacity>
          ) : <View style={{ width: 60 }} />}
          
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Partida Activa</Text>
            <Text style={styles.headerSubtitle}>Meta: {match.limitScore} pts</Text>
          </View>
          
          <View style={{ width: 60 }} />
        </View>

        {/* Salida Indicator */}
        {hasOrder && currentManoPlayer && (
          <View style={{ backgroundColor: theme.colors.card, marginHorizontal: 16, marginTop: 8, padding: 8, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: theme.colors.cardBorder }}>
            <Text style={{ color: theme.colors.text, fontWeight: 'bold' }}>🎲 Salida actual: <Text style={{ color: theme.colors.primary }}>{currentManoPlayer.name}</Text></Text>
          </View>
        )}

        {!match.isGuestMode && match.gameMode === 'teams' && !match.tournament_id && (
          <View style={{ marginHorizontal: 16, marginTop: 8 }}>
            <WagerStatusBanner matchId={match.id} />
          </View>
        )}

        {/* Scoreboard */}
        <View style={styles.scoreboard}>
          {entities.map(ent => (
            <TouchableOpacity 
              key={ent.id} 
              style={[styles.scoreCard, { borderColor: ent.color, borderWidth: 1.5 }]}
              activeOpacity={0.7}
              onPress={() => handleOpenScoreModal(ent.id)}
            >
              <Text style={styles.scoreName}>{ent.label}</Text>
              <Text style={[styles.scoreValue, { color: ent.color }]}>{totals[ent.id] || 0}</Text>
              <Text style={styles.scoreLimit}>/{match.limitScore}</Text>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, {
                  backgroundColor: ent.color,
                  width: `${Math.min(((totals[ent.id] || 0) / match.limitScore) * 100, 100)}%`,
                }]} />
              </View>
              <Text style={{ color: theme.colors.textDim, fontSize: 11, marginTop: 12, fontWeight: 'bold', opacity: 0.8 }}>👆 TOCA PARA ANOTAR</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Action Buttons */}
      <View style={{ gap: 8, paddingHorizontal: 16, marginTop: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity style={[styles.addBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.primary, flex: 1 }]} onPress={() => handleOpenScoreModal('tie')}>
            <Text style={[styles.addBtnText, { color: theme.colors.primary }]}>Empate</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.undoBtn, { flex: 1 }]} onPress={handleUndo}>
            <Text style={styles.undoBtnText}>Deshacer</Text>
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity 
            style={[styles.addBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.textDim, flex: 1 }]} 
            onPress={handleOpenSubstitution}>
            <Text style={[styles.addBtnText, { color: theme.colors.textDim }]}>Cambio (Sustituir)</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.addBtn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.danger, flex: 1 }]} 
            onPress={() => {
              const msg = '¿Seguro que quieres anular esta partida? Nadie ganará ni perderá puntos y se devolverán las apuestas.';
              if (Platform.OS === 'web') {
                if (window.confirm(msg)) {
                  onEndMatch('null');
                }
              } else {
                Alert.alert('Anular Partida', msg, [
                  { text: 'No', style: 'cancel' },
                  { text: 'Sí, anular', style: 'destructive', onPress: () => onEndMatch('null') }
                ]);
              }
            }}>
            <Text style={[styles.addBtnText, { color: theme.colors.danger }]}>Anular Partida</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Two-Column History */}
      <ScrollView style={styles.history} contentContainerStyle={{ paddingBottom: 40 }}>
        {entities.length >= 2 && (
          <View style={styles.columnsContainer}>
            {/* Column Headers */}
            <View style={styles.columnHeaders}>
              <View style={styles.columnHeader}>
                <View style={[styles.columnDot, { backgroundColor: columnData.left.color }]} />
                <Text style={styles.columnHeaderText}>{columnData.left.label}</Text>
              </View>
              <View style={styles.columnDivider} />
              <View style={styles.columnHeader}>
                <View style={[styles.columnDot, { backgroundColor: columnData.right.color }]} />
                <Text style={styles.columnHeaderText}>{columnData.right.label}</Text>
              </View>
            </View>

            {/* Rows */}
            {columnData.rows.length === 0 ? (
              <Text style={styles.noHistory}>No hay rondas registradas aún.</Text>
            ) : (
              columnData.rows.map((row) => (
                <View key={row.id} style={styles.columnRow}>
                  <View style={styles.columnCell}>
                    {row.leftPoints !== null && (
                      <Text style={[styles.cellPoints, { color: columnData.left.color }]}>
                        {row.leftPoints}
                      </Text>
                    )}
                  </View>
                  <View style={styles.rowDivider}>
                    {row.isTie ? (
                      <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>{row.tiePoints}</Text>
                    ) : row.isTrancado ? (
                      <Text style={styles.trancadoBadge}>T</Text>
                    ) : null}
                  </View>
                  <View style={styles.columnCell}>
                    {row.rightPoints !== null && (
                      <Text style={[styles.cellPoints, { color: columnData.right.color }]}>
                        {row.rightPoints}
                      </Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>

      {/* ZAPATO / WINNER MODAL */}
      <Modal visible={!!winnerData} animationType="fade" transparent>
        <View style={styles.winnerOverlay}>
          {!!winnerData && Platform.OS !== 'web' && ConfettiCannon && (
            <ConfettiCannon
              count={150}
              origin={{x: -10, y: 0}}
              autoStart={true}
              fadeOut={true}
              fallSpeed={3000}
            />
          )}
          <View
            ref={winnerRef}
            collapsable={false}
            style={[styles.winnerContent, winnerData?.isZapato && styles.zapatoContent]}
          >
            {winnerData?.isZapato ? (
              <>
                <Text style={styles.zapatoEmoji}>👟</Text>
                <Text style={styles.zapatoTitle}>¡ZAPATO!</Text>
                <Text style={styles.zapatoSubtitle}>¡Qué humillación, los dejaron en 0!</Text>
              </>
            ) : (
              <Text style={styles.winnerTitle}>¡PARTIDA FINALIZADA!</Text>
            )}

            <Text style={styles.winnerText}>Ganador:</Text>
            <Text style={[styles.winnerName, winnerData?.isZapato && { color: theme.colors.danger }]}>
              {winnerData ? getEntityName(winnerData.id) : ''}
            </Text>

            {/* Final scores in modal for sharing context */}
            <View style={styles.finalScores}>
              {entities.map(ent => (
                <View key={ent.id} style={styles.finalScoreItem}>
                  <Text style={styles.finalScoreLabel}>{ent.label}</Text>
                  <Text style={[styles.finalScoreValue, { color: ent.color }]}>{totals[ent.id] || 0}</Text>
                </View>
              ))}
            </View>

            <TouchableOpacity style={styles.shareBtn} onPress={() => captureAndShare(winnerRef)}>
              <Text style={styles.shareBtnText}>📸 Compartir Resultado</Text>
            </TouchableOpacity>

            {!match.isGuestMode && (
              <TouchableOpacity 
                style={[styles.shareBtn, { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: '#f59e0b', marginBottom: theme.spacing.m }]} 
                onPress={handleCallNextWaitlistDuo}
              >
                <Text style={[styles.shareBtnText, { color: '#f59e0b', fontWeight: 'bold' }]}>
                  🚨 Llamar al Siguiente Dúo a la Mesa
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.finishBtn} onPress={() => handleFinishMatch(winnerData?.id || '')}>
              <Text style={styles.finishBtnText}>Terminar Partida</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* SUB MODALS */}
      <Modal visible={isSubModalOpen} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>¿Quién sale de la partida?</Text>
            {match.players.map(p => (
              <TouchableOpacity key={p.id} style={[styles.duoCard, { paddingVertical: 12 }]} onPress={() => {
                setSubPlayerToReplace(p);
                setIsSubModalOpen(false);
                setIsSelectSubModalOpen(true);
              }}>
                <View style={styles.duoAvatar}><Text style={styles.duoAvatarText}>{p.initials}</Text></View>
                <Text style={styles.duoName}>{p.name}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 16, alignSelf: 'center' }]} onPress={() => setIsSubModalOpen(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={isSelectSubModalOpen} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>¿Quién entra por {subPlayerToReplace?.name}?</Text>
            {match.isGuestMode ? (
              <View style={{ width: '100%' }}>
                <TextInput
                  style={styles.input}
                  placeholder="Nombre del nuevo jugador"
                  placeholderTextColor={theme.colors.textDim}
                  onSubmitEditing={(e) => handleConfirmSub(e.nativeEvent.text)}
                />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 300, width: '100%' }}>
                {subProfiles.map(prof => (
                  <TouchableOpacity key={prof.id} style={[styles.duoCard, { paddingVertical: 12 }]} onPress={() => handleConfirmSub(prof)}>
                    <View style={styles.duoAvatar}><Text style={styles.duoAvatarText}>{prof.initials}</Text></View>
                    <Text style={styles.duoName}>{prof.display_name}</Text>
                  </TouchableOpacity>
                ))}
                <Text style={{color: theme.colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 16, fontStyle: 'italic'}}>
                  *En partidas con apuestas, solo puedes sustituir por jugadores registrados en la app.
                </Text>
              </ScrollView>
            )}
            <TouchableOpacity style={[styles.cancelBtn, { marginTop: 16, alignSelf: 'center' }]} onPress={() => setIsSelectSubModalOpen(false)}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* DUO CONFIRMATION MODAL */}
      <Modal visible={showDuoModal} animationType="slide" transparent>
        <View style={styles.winnerOverlay}>
          <View style={styles.winnerContent}>
            <Text style={{ fontSize: 40, marginBottom: 8 }}>👥</Text>
            <Text style={[styles.winnerTitle, { fontSize: 20, marginBottom: 12 }]}>¡Buen juego!</Text>
            <Text style={[styles.winnerText, { textAlign: 'center', marginBottom: 20, fontSize: 16 }]}>
              ¿Quieres guardar a{' '}
              <Text style={{ color: theme.colors.primary, fontWeight: '900' }}>
                {(() => {
                  if (!currentUserProfileId) return 'tu compañero';
                  const myTeam = match.players.filter(p => p.profileId === currentUserProfileId);
                  if (myTeam.length === 0) return 'tu compañero';
                  const teammate = match.players.find(
                    p => p.teamNumber === myTeam[0].teamNumber && p.profileId !== currentUserProfileId
                  );
                  return teammate?.name || 'tu compañero';
                })()}
              </Text>
              {' '}como tu duo?
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, width: '100%' }}>
              <TouchableOpacity
                style={[styles.finishBtn, { flex: 1, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.cardBorder }]}
                onPress={() => {
                  setShowDuoModal(false);
                  onEndMatch(duoPendingWinnerId || '');
                }}
              >
                <Text style={[styles.finishBtnText, { color: theme.colors.textDim }]}>No</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.finishBtn, { flex: 1 }]}
                onPress={async () => {
                  if (currentUserProfileId) {
                    const myTeam = match.players.filter(p => p.profileId === currentUserProfileId);
                    if (myTeam.length > 0) {
                      const teammate = match.players.find(
                        p => p.teamNumber === myTeam[0].teamNumber && p.profileId !== currentUserProfileId
                      );
                      if (teammate?.profileId) {
                        try {
                          // Reuse any existing row (either order) instead of inserting a mirrored duplicate
                          const { data: rows } = await supabase
                            .from('duos')
                            .select('id')
                            .or(`and(player1_id.eq.${currentUserProfileId},player2_id.eq.${teammate.profileId}),and(player1_id.eq.${teammate.profileId},player2_id.eq.${currentUserProfileId})`)
                            .limit(1);
                          if (rows && rows.length > 0) {
                            await supabase.from('duos').update({ is_active: true }).eq('id', rows[0].id);
                          } else {
                            const [p1, p2] = [currentUserProfileId, teammate.profileId].sort();
                            await supabase.from('duos').insert({ player1_id: p1, player2_id: p2 });
                          }
                        } catch (e) {
                          // Network error: the prompt will simply appear again next match
                        }
                      }
                    }
                  }
                  setShowDuoModal(false);
                  onEndMatch(duoPendingWinnerId || '');
                }}
              >
                <Text style={styles.finishBtnText}>¡Sí! 🤝</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add Points Modal */}
      <Modal visible={isAddModalOpen} animationType="slide" transparent>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {scorerId === 'tie' ? 'Empate' : `Anotando a ${getEntityName(scorerId)}`}
            </Text>

            {scorerId !== 'tie' && (
              <View style={styles.toggleContainer}>
                <TouchableOpacity style={[styles.toggleBtn, endingType === 'normal' && styles.toggleActive]} onPress={() => setEndingType('normal')}>
                  <Text style={styles.toggleText}>Normal</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.toggleBtn, endingType === 'trancado' && styles.toggleActive]} onPress={() => setEndingType('trancado')}>
                  <Text style={styles.toggleText}>Trancada (T)</Text>
                </TouchableOpacity>
              </View>
            )}

            <View>
              <Text style={styles.label}>
                {scorerId === 'tie' ? 'Puntos del empate (no se suman a nadie)' : 'Puntos sumados'}
              </Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={pointsStr}
                onChangeText={setPointsStr}
                placeholder="Ej: 45"
                placeholderTextColor={theme.colors.textDim}
                autoFocus
              />
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setIsAddModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={handleAddPoints}>
                <Text style={styles.modalConfirmText}>Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  shareContainer: { backgroundColor: theme.colors.background, paddingTop: theme.spacing.xl },
  header: { padding: theme.spacing.m, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { padding: 8, width: 60 },
  backBtnText: { color: theme.colors.primary, fontWeight: 'bold' },
  headerTitle: { color: theme.colors.text, fontSize: 24, fontWeight: 'bold' },
  headerSubtitle: { color: theme.colors.textDim, fontSize: 16 },
  scoreboard: { flexDirection: 'row', flexWrap: 'wrap', padding: theme.spacing.m, gap: theme.spacing.m },
  scoreCard: {
    flex: 1, minWidth: '45%', backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.m, padding: theme.spacing.m, alignItems: 'center',
    borderWidth: 1, borderColor: theme.colors.cardBorder,
  },
  scoreName: { color: theme.colors.textDim, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  scoreValue: { fontSize: 54, fontWeight: '900' },
  scoreLimit: { color: theme.colors.textDim, fontSize: 14, marginBottom: 8 },
  progressBg: { width: '100%', height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  actions: { flexDirection: 'row', padding: theme.spacing.m, gap: theme.spacing.m },
  addBtn: {
    flex: 2, backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.m, borderRadius: theme.borderRadius.l, alignItems: 'center',
  },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  undoBtn: {
    flex: 1, backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.cardBorder,
    paddingVertical: theme.spacing.m, borderRadius: theme.borderRadius.l, alignItems: 'center',
  },
  undoBtnText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  history: { flex: 1, paddingHorizontal: theme.spacing.m },
  // Two-column layout
  columnsContainer: {
    backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.m,
    borderWidth: 1, borderColor: theme.colors.cardBorder, overflow: 'hidden',
  },
  columnHeaders: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder, paddingVertical: theme.spacing.m },
  columnHeader: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  columnDot: { width: 8, height: 8, borderRadius: 4 },
  columnHeaderText: { color: theme.colors.text, fontSize: 14, fontWeight: '800' },
  columnDivider: { width: 1, backgroundColor: theme.colors.cardBorder },
  columnRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.03)' },
  columnCell: { flex: 1, paddingVertical: theme.spacing.s, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  cellPoints: { fontSize: 22, fontWeight: '900' },
  rowDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center', alignItems: 'center' },
  trancadoBadge: { color: theme.colors.accent, fontSize: 10, fontWeight: '900', backgroundColor: 'rgba(245,158,11,0.2)', paddingHorizontal: 4, paddingVertical: 1, borderRadius: 4 },
  noHistory: { color: theme.colors.textDim, textAlign: 'center', marginTop: theme.spacing.xl, fontStyle: 'italic', paddingBottom: theme.spacing.xl },
  // Add Points Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: theme.colors.background, borderTopLeftRadius: theme.borderRadius.l,
    borderTopRightRadius: theme.borderRadius.l, padding: theme.spacing.l,
    borderWidth: 1, borderColor: theme.colors.cardBorder,
  },
  modalTitle: { color: theme.colors.text, fontSize: 24, fontWeight: 'bold', marginBottom: theme.spacing.m },
  toggleContainer: { flexDirection: 'row', backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.s, padding: 4, marginBottom: theme.spacing.m },
  toggleBtn: { flex: 1, padding: theme.spacing.s, alignItems: 'center', borderRadius: theme.borderRadius.s },
  toggleActive: { backgroundColor: theme.colors.accent },
  toggleText: { color: '#fff', fontWeight: 'bold' },
  label: { color: theme.colors.textDim, marginBottom: 8, marginTop: theme.spacing.m, fontSize: 14 },
  subLabel: { color: theme.colors.textDim, marginBottom: 4, fontSize: 12, textAlign: 'center' },
  winnerSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  winnerBtn: { paddingHorizontal: theme.spacing.m, paddingVertical: theme.spacing.s, borderRadius: theme.borderRadius.m, borderWidth: 1, borderColor: theme.colors.cardBorder },
  winnerBtnText: { color: theme.colors.textDim, fontWeight: '600' },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s, padding: theme.spacing.m, color: '#fff',
    fontSize: 24, textAlign: 'center', fontWeight: 'bold',
  },
  trancadoInputs: { flexDirection: 'row', justifyContent: 'space-between' },
  helperText: { color: theme.colors.accent, fontSize: 12, marginTop: theme.spacing.m, textAlign: 'center', fontStyle: 'italic' },
  modalActions: { flexDirection: 'row', marginTop: theme.spacing.xl, gap: theme.spacing.m },
  modalCancel: { flex: 1, padding: theme.spacing.m, borderRadius: theme.borderRadius.full, borderWidth: 1, borderColor: theme.colors.cardBorder, alignItems: 'center' },
  modalCancelText: { color: theme.colors.textDim, fontWeight: 'bold' },
  modalConfirm: { flex: 2, backgroundColor: theme.colors.success, padding: theme.spacing.m, borderRadius: theme.borderRadius.full, alignItems: 'center' },
  modalConfirmText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  // Winner/ZAPATO modal
  winnerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: theme.spacing.xl },
  winnerContent: {
    backgroundColor: theme.colors.card, padding: theme.spacing.xl, borderRadius: theme.borderRadius.l,
    alignItems: 'center', borderWidth: 2, borderColor: theme.colors.primary,
  },
  zapatoContent: {
    borderColor: theme.colors.danger,
    shadowColor: theme.colors.danger, shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, shadowRadius: 20, elevation: 10,
  },
  winnerTitle: { color: theme.colors.primary, fontSize: 24, fontWeight: '900', marginBottom: theme.spacing.m },
  zapatoEmoji: { fontSize: 56, marginBottom: theme.spacing.s },
  zapatoTitle: { color: theme.colors.danger, fontSize: 48, fontWeight: '900', marginBottom: theme.spacing.s, textTransform: 'uppercase' },
  zapatoSubtitle: { color: theme.colors.textDim, fontSize: 16, fontStyle: 'italic', marginBottom: theme.spacing.l, textAlign: 'center' },
  winnerText: { color: theme.colors.textDim, fontSize: 16, marginBottom: 4 },
  winnerName: { color: theme.colors.text, fontSize: 32, fontWeight: 'bold', marginBottom: theme.spacing.m, textAlign: 'center' },
  // Final scores inside modal
  finalScores: { flexDirection: 'row', gap: theme.spacing.xl, marginBottom: theme.spacing.xl },
  finalScoreItem: { alignItems: 'center' },
  finalScoreLabel: { color: theme.colors.textDim, fontSize: 12, marginBottom: 4 },
  finalScoreValue: { fontSize: 36, fontWeight: '900' },
  shareBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)', paddingVertical: theme.spacing.m, paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.full, marginBottom: theme.spacing.m, width: '100%', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)',
  },
  shareBtnText: { color: theme.colors.text, fontSize: 16, fontWeight: 'bold' },
  finishBtn: {
    backgroundColor: theme.colors.primary, paddingVertical: theme.spacing.m, paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.full, width: '100%', alignItems: 'center',
  },
  finishBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  // Missing Modal Styles
  duoCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)', padding: theme.spacing.m, borderRadius: theme.borderRadius.m, marginBottom: theme.spacing.s, borderWidth: 1, borderColor: theme.colors.cardBorder },
  duoAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: theme.spacing.m },
  duoAvatarText: { color: '#fff', fontWeight: 'bold' },
  duoName: { color: theme.colors.text, fontSize: 16, fontWeight: 'bold' },
  cancelBtn: { padding: theme.spacing.m },
  cancelBtnText: { color: theme.colors.textDim, fontWeight: 'bold' },
});
