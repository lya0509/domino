import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, SafeAreaView, KeyboardAvoidingView, Platform, Modal, Alert, Image, StatusBar } from 'react-native';
import { theme } from '../theme';
import { GameMode, Player, Match, Profile } from '../types';
import { supabase } from '../lib/supabase';

interface Props {
  onStartMatch: (match: Omit<Match, 'id' | 'rounds' | 'status'>, waitlistId?: string) => void;
  isGuestMode: boolean;
  onBack?: () => void;
  initialSlots?: (Profile | null)[];
  waitlistId?: string;
}

export const SetupScreen: React.FC<Props> = ({ onStartMatch, isGuestMode, onBack, initialSlots, waitlistId }) => {
  const [mode] = useState<GameMode>('teams');
  const [limitScore, setLimitScore] = useState<number>(100);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [isWagerMatch, setIsWagerMatch] = useState(false);
  const [wagerAmount, setWagerAmount] = useState<number>(0);

  // Slots for team mode (profile IDs or null)
  const [slots, setSlots] = useState<(Profile | null)[]>(initialSlots || [null, null, null, null]);

  // Guest mode fallback inputs
  const [t1p1, setT1p1] = useState('J1');
  const [t1p2, setT1p2] = useState('J2');
  const [t2p1, setT2p1] = useState('J3');
  const [t2p2, setT2p2] = useState('J4');

  // Individual mode
  const [players, setPlayers] = useState([{ name: 'Jugador 1' }, { name: 'Jugador 2' }]);

  // Add player modal
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newName, setNewName] = useState('');
  const [newInitials, setNewInitials] = useState('');

  // Salida Config
  const [showSalidaConfig, setShowSalidaConfig] = useState(false);
  const [salidaStep, setSalidaStep] = useState<1 | 2>(1);
  const [starterId, setStarterId] = useState<string | null>(null);
  const [rightPlayerId, setRightPlayerId] = useState<string | null>(null);

  useEffect(() => {
    if (!isGuestMode) {
      fetchProfiles();
    }
  }, [isGuestMode]);

  const fetchProfiles = async () => {
    setLoadingProfiles(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('display_name');
      if (error) {
        console.error('Error fetching profiles:', error.message);
      } else {
        setProfiles(data as Profile[]);
      }
    } catch (err) {
      console.error('Failed to fetch profiles:', err);
    } finally {
      setLoadingProfiles(false);
    }
  };

  const isPlayerSelected = (profileId: string) => {
    return slots.some(s => s?.id === profileId);
  };

  const handleSelectPlayer = (profile: Profile) => {
    // If already selected, deselect
    if (isPlayerSelected(profile.id)) {
      setSlots(slots.map(s => s?.id === profile.id ? null : s));
      return;
    }

    // Find first empty slot
    const emptyIndex = slots.findIndex(s => s === null);
    if (emptyIndex === -1) {
      Alert.alert('Lleno', 'Ya seleccionaste 4 jugadores. Deselecciona uno primero.');
      return;
    }
    const newSlots = [...slots];
    newSlots[emptyIndex] = profile;
    setSlots(newSlots);
  };

  const handleRemoveSlot = (index: number) => {
    const newSlots = [...slots];
    newSlots[index] = null;
    setSlots(newSlots);
  };

  const handleAddNewPlayer = async () => {
    if (!newName.trim() || !newInitials.trim()) {
      Alert.alert('Error', 'Ingresa nombre e iniciales.');
      return;
    }
    // Note: This inserts a profile directly. In practice, only the user themselves
    // should create their profile via registration. This is a convenience feature.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // We can't create auth users from client, so we just inform the user
      Alert.alert(
        'Registro Necesario',
        `"${newName.trim()}" necesita registrarse en la app con su propio teléfono para aparecer en la lista de jugadores reales. \n\nSi no desea registrarse, puedes usar la opción de "Invitado" que ya está en la lista.`,
        [{ text: 'Entendido' }]
      );
      setShowAddPlayer(false);
      setNewName('');
      setNewInitials('');
    } catch (err) {
      console.error(err);
    }
  };

  const handleStart = () => {
    if (isGuestMode) {
      // Guest mode — use text inputs
      let matchPlayers: Player[] = [];
      if (mode === 'teams') {
        matchPlayers = [
          { id: 't1_p1', name: t1p1, initials: t1p1.substring(0, 2).toUpperCase(), teamNumber: 1 },
          { id: 't1_p2', name: t1p2, initials: t1p2.substring(0, 2).toUpperCase(), teamNumber: 1 },
          { id: 't2_p1', name: t2p1, initials: t2p1.substring(0, 2).toUpperCase(), teamNumber: 2 },
          { id: 't2_p2', name: t2p2, initials: t2p2.substring(0, 2).toUpperCase(), teamNumber: 2 },
        ];
      } else {
        matchPlayers = players.map((p, i) => ({
          id: `p${i}`,
          name: p.name,
          initials: p.name.substring(0, 2).toUpperCase(),
        }));
      }
      onStartMatch({ gameMode: mode, limitScore, players: matchPlayers, isGuestMode: true });
    } else {
      // Authenticated mode — use selected profiles
      if (mode === 'teams') {
        const filledSlots = slots.filter(s => s !== null);
        if (filledSlots.length < 4) {
          Alert.alert('Faltan Jugadores', `Selecciona los 4 jugadores para los equipos. Tienes ${filledSlots.length} de 4.`);
          return;
        }

        // Validate betting points if it's a wager match
        if (isWagerMatch && wagerAmount > 0) {
          const invalidPlayers = filledSlots.filter(s => (s?.betting_points || 0) < wagerAmount);
          if (invalidPlayers.length > 0) {
            Alert.alert(
              'Saldo Insuficiente',
              `Los siguientes jugadores no tienen puntos suficientes (${wagerAmount} pts):\n${invalidPlayers.map(p => p?.display_name).join(', ')}`
            );
            return;
          }
        }

        setShowSalidaConfig(true);
        setSalidaStep(1);
        setStarterId(null);
        setRightPlayerId(null);
      } else {
        // Individual mode with profile selection
        const selectedProfiles = slots.filter(Boolean) as Profile[];
        if (selectedProfiles.length < 2) {
          Alert.alert('Faltan Jugadores', 'Selecciona al menos 2 jugadores.');
          return;
        }
        const matchPlayers: Player[] = selectedProfiles.map((s, i) => ({
          id: `p${i}`,
          name: s.display_name,
          initials: s.initials,
          profileId: s.id,
        }));
        onStartMatch({ 
          gameMode: mode, 
          limitScore, 
          players: matchPlayers,
          is_wager_match: isWagerMatch,
          wager_amount: isWagerMatch ? wagerAmount : 0
        }, waitlistId);
      }
    }
  };

  const finalizeStart = (finalRightPlayerId?: string) => {
    setShowSalidaConfig(false);
    let matchPlayers: Player[] = [];

    if (!starterId) {
      matchPlayers = slots.map((s, i) => ({
        id: i < 2 ? `t1_p${i + 1}` : `t2_p${i - 1}`,
        name: s!.display_name,
        initials: s!.initials,
        teamNumber: (i < 2 ? 1 : 2) as 1 | 2,
        profileId: s!.id,
        order: i,
      }));
    } else {
      const rightId = finalRightPlayerId || rightPlayerId!;
      const getProfile = (id: string) => slots.find(s => s!.id === id)!;
      const getPartner = (id: string) => {
        const index = slots.findIndex(s => s!.id === id);
        if (index === 0) return slots[1]!;
        if (index === 1) return slots[0]!;
        if (index === 2) return slots[3]!;
        if (index === 3) return slots[2]!;
        return slots[0]!;
      };

      const mano = getProfile(starterId);
      const right = getProfile(rightId);
      const manoPartner = getPartner(starterId);
      const rightPartner = getPartner(rightId);

      const orderedProfiles = [mano, right, manoPartner, rightPartner];
      
      matchPlayers = orderedProfiles.map((s, i) => {
        const origIndex = slots.findIndex(orig => orig!.id === s.id);
        const teamNum = origIndex < 2 ? 1 : 2;
        return {
          id: origIndex < 2 ? `t1_p${origIndex + 1}` : `t2_p${origIndex - 1}`,
          name: s.display_name,
          initials: s.initials,
          teamNumber: teamNum as 1 | 2,
          profileId: s.id,
          order: i
        };
      });
    }

    onStartMatch({ 
      gameMode: mode, 
      limitScore, 
      players: matchPlayers,
      is_wager_match: isWagerMatch,
      wager_amount: isWagerMatch ? wagerAmount : 0
    }, waitlistId);
  };

  const addPlayer = () => {
    if (players.length < 4) setPlayers([...players, { name: `Jugador ${players.length + 1}` }]);
  };

  const removePlayer = () => {
    if (players.length > 2) setPlayers(players.slice(0, -1));
  };

  const renderSlot = (index: number, teamLabel: string) => {
    const profile = slots[index];
    return (
      <TouchableOpacity
        style={[styles.slot, profile && styles.slotFilled]}
        onPress={() => profile && handleRemoveSlot(index)}
      >
        {profile ? (
          <View style={styles.slotContent}>
            {profile.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.slotAvatarImg} />
            ) : (
              <Text style={styles.slotInitials}>{profile.initials}</Text>
            )}
            <Text style={styles.slotName}>{profile.display_name}</Text>
            <Text style={styles.slotRemove}>✕</Text>
          </View>
        ) : (
          <Text style={styles.slotEmpty}>Toca un jugador ↓</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View style={styles.headerRow}>
            {onBack && (
              <TouchableOpacity onPress={onBack} style={styles.backBtn}>
                <Text style={styles.backBtnText}>Volver</Text>
              </TouchableOpacity>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Configuración</Text>
              <Text style={styles.subtitle}>
                {isGuestMode ? 'Modo invitado — sin estadísticas' : 'Selecciona los jugadores'}
              </Text>
            </View>
          </View>

          {/* Limit Score */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Puntuación Límite: {limitScore}</Text>
            <View style={styles.scoreChips}>
              {[50, 100, 150, 200, 500].map((score) => (
                <TouchableOpacity
                  key={score}
                  style={[styles.chip, limitScore === score && styles.chipActive]}
                  onPress={() => setLimitScore(score)}
                >
                  <Text style={[styles.chipText, limitScore === score && styles.chipTextActive]}>{score}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Wager Settings (Only for Authenticated Mode) */}
          {!isGuestMode && (
            <View style={styles.section}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: theme.spacing.m }}>
                <View>
                  <Text style={[styles.sectionTitle, { marginBottom: 2, color: isWagerMatch ? theme.colors.accent : theme.colors.text }]}>
                    Duelo VIP (Apuestas)
                  </Text>
                  <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>
                    Juega por puntos (Pozo = Apuesta × 4)
                  </Text>
                </View>
                <TouchableOpacity 
                  style={[styles.chip, isWagerMatch ? { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent } : {}]} 
                  onPress={() => setIsWagerMatch(!isWagerMatch)}
                >
                  <Text style={[styles.chipText, isWagerMatch ? { color: '#fff' } : {}]}>
                    {isWagerMatch ? 'Activado' : 'Desactivado'}
                  </Text>
                </TouchableOpacity>
              </View>

              {isWagerMatch && (
                <View style={{ marginTop: theme.spacing.s }}>
                  <Text style={{ color: theme.colors.textDim, marginBottom: theme.spacing.s }}>
                    Apuesta por jugador: {wagerAmount} pts (Total pozo: {wagerAmount * 4} pts)
                  </Text>
                  <View style={styles.scoreChips}>
                    {[10, 50, 100, 500, 1000].map((amount) => (
                      <TouchableOpacity
                        key={amount}
                        style={[styles.chip, wagerAmount === amount && { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent }]}
                        onPress={() => setWagerAmount(amount)}
                      >
                        <Text style={[styles.chipText, wagerAmount === amount && { color: '#fff' }]}>{amount}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Players Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {isGuestMode ? 'Jugadores / Equipos' : 'Selecciona Jugadores'}
            </Text>

            {isGuestMode ? (
              /* Guest mode: text inputs */
              mode === 'teams' ? (
                <View>
                  <Text style={[styles.label, { color: theme.colors.primary, marginTop: 8 }]}>Equipo 1 (Azul)</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Jugador 1</Text>
                      <TextInput style={styles.input} value={t1p1} onChangeText={setT1p1} placeholderTextColor={theme.colors.textDim} />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Jugador 2</Text>
                      <TextInput style={styles.input} value={t1p2} onChangeText={setT1p2} placeholderTextColor={theme.colors.textDim} />
                    </View>
                  </View>
                  <Text style={[styles.label, { color: theme.colors.secondary, marginTop: 8 }]}>Equipo 2 (Morado)</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Jugador 3</Text>
                      <TextInput style={styles.input} value={t2p1} onChangeText={setT2p1} placeholderTextColor={theme.colors.textDim} />
                    </View>
                    <View style={[styles.inputGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Jugador 4</Text>
                      <TextInput style={styles.input} value={t2p2} onChangeText={setT2p2} placeholderTextColor={theme.colors.textDim} />
                    </View>
                  </View>
                </View>
              ) : (
                <View>
                  {players.map((p, i) => (
                    <View key={i} style={styles.inputGroup}>
                      <Text style={styles.label}>Jugador {i + 1}</Text>
                      <TextInput
                        style={styles.input}
                        value={p.name}
                        onChangeText={(val) => {
                          const newPlayers = [...players];
                          newPlayers[i].name = val;
                          setPlayers(newPlayers);
                        }}
                        placeholderTextColor={theme.colors.textDim}
                      />
                    </View>
                  ))}
                  <View style={styles.playerActions}>
                    <TouchableOpacity style={styles.actionBtn} onPress={removePlayer} disabled={players.length <= 2}>
                      <Text style={styles.actionBtnText}>- Quitar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={addPlayer} disabled={players.length >= 4}>
                      <Text style={styles.actionBtnText}>+ Agregar</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
            ) : (
              /* Authenticated mode: pick from profiles */
              <View>
                {/* Team Slots */}
                <Text style={[styles.teamLabel, { color: theme.colors.primary }]}>Equipo 1 (Azul)</Text>
                <View style={styles.slotsRow}>
                  {renderSlot(0, 'J1')}
                  {renderSlot(1, 'J2')}
                </View>

                <Text style={[styles.teamLabel, { color: theme.colors.secondary }]}>Equipo 2 (Morado)</Text>
                <View style={styles.slotsRow}>
                  {renderSlot(2, 'J3')}
                  {renderSlot(3, 'J4')}
                </View>

                {/* Available Players */}
                <Text style={styles.availableTitle}>Jugadores Registrados</Text>
                {loadingProfiles ? (
                  <Text style={styles.loadingText}>Cargando jugadores...</Text>
                ) : profiles.length === 0 ? (
                  <Text style={styles.loadingText}>No hay jugadores registrados aún.</Text>
                ) : (
                  <View style={styles.profileGrid}>
                    {profiles.map(p => {
                      const selected = isPlayerSelected(p.id);
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={[styles.profileChip, selected && styles.profileChipSelected]}
                          onPress={() => handleSelectPlayer(p)}
                        >
                          <View style={[styles.profileAvatar, selected && styles.profileAvatarSelected]}>
                            {p.avatar_url ? (
                              <Image source={{ uri: p.avatar_url }} style={styles.chipAvatarImg} />
                            ) : (
                              <Text style={styles.profileAvatarText}>{p.initials}</Text>
                            )}
                          </View>
                          <Text style={[styles.profileName, selected && styles.profileNameSelected]} numberOfLines={1}>
                            {p.display_name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                <TouchableOpacity style={styles.addPlayerBtn} onPress={() => setShowAddPlayer(true)}>
                  <Text style={styles.addPlayerText}>+ ¿No aparece? Dile que se registre</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Start Button */}
          <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
            <Text style={styles.startBtnText}>¡INICIAR PARTIDA!</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add Player Info Modal */}
      <Modal visible={showAddPlayer} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Agregar Jugador</Text>
            <Text style={styles.modalSubtitle}>
              Para aparecer en la lista, cada jugador necesita registrarse en la app desde su propio teléfono.
            </Text>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowAddPlayer(false)}>
              <Text style={styles.modalCloseBtnText}>Entendido</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Salida Config Modal */}
      <Modal visible={showSalidaConfig} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: theme.colors.card, padding: 24, borderRadius: 16 }}>
            {salidaStep === 1 ? (
              <>
                <Text style={{ fontSize: 20, fontWeight: 'bold', color: theme.colors.text, marginBottom: 16, textAlign: 'center' }}>¿Quién sale con el doble 6?</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                  {slots.filter(Boolean).map(s => (
                    <TouchableOpacity 
                      key={s!.id}
                      style={{ backgroundColor: theme.colors.primary, padding: 12, borderRadius: 8, width: '45%', alignItems: 'center' }}
                      onPress={() => {
                        setStarterId(s!.id);
                        setSalidaStep(2);
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: 'bold' }}>{s!.display_name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={{ marginTop: 24, padding: 12, alignItems: 'center' }} onPress={() => finalizeStart()}>
                  <Text style={{ color: theme.colors.textDim }}>Omitir paso</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 20, fontWeight: 'bold', color: theme.colors.text, marginBottom: 16, textAlign: 'center' }}>¿Quién está sentado a la derecha de {slots.find(s => s?.id === starterId)?.display_name}?</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                  {(() => {
                    const starterIndex = slots.findIndex(s => s?.id === starterId);
                    const opponentIndices = starterIndex < 2 ? [2, 3] : [0, 1];
                    return opponentIndices.map(idx => slots[idx]!).map(s => (
                      <TouchableOpacity 
                        key={s.id}
                        style={{ backgroundColor: theme.colors.secondary, padding: 12, borderRadius: 8, width: '45%', alignItems: 'center' }}
                        onPress={() => {
                          setRightPlayerId(s.id);
                          finalizeStart(s.id);
                        }}
                      >
                        <Text style={{ color: '#fff', fontWeight: 'bold' }}>{s.display_name}</Text>
                      </TouchableOpacity>
                    ));
                  })()}
                </View>
                <TouchableOpacity style={{ paddingVertical: 10, paddingHorizontal: 20, marginTop: 24, alignItems: 'center' }} onPress={() => setSalidaStep(1)}>
                  <Text style={{ color: theme.colors.textDim }}>Volver</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  scroll: { padding: theme.spacing.l, paddingTop: theme.spacing.xxl },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: theme.spacing.xl },
  backBtn: { marginRight: theme.spacing.m, marginTop: 4 },
  backBtnText: { color: theme.colors.primary, fontSize: 16, fontWeight: '600' },
  title: { fontSize: 32, fontWeight: 'bold', color: theme.colors.text },
  subtitle: { fontSize: 14, color: theme.colors.textDim },
  section: {
    marginBottom: theme.spacing.xl,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.m,
    borderRadius: theme.borderRadius.m,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: theme.colors.text, marginBottom: theme.spacing.m },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: theme.borderRadius.l,
    padding: 4,
  },
  toggleBtn: { flex: 1, paddingVertical: theme.spacing.s, alignItems: 'center', borderRadius: theme.borderRadius.l },
  toggleActive: { backgroundColor: theme.colors.primary },
  toggleText: { color: theme.colors.textDim, fontWeight: '600' },
  toggleTextActive: { color: theme.colors.text },
  scoreChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: theme.spacing.m,
    paddingVertical: theme.spacing.s,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
  },
  chipActive: { backgroundColor: theme.colors.secondary, borderColor: theme.colors.secondary },
  chipText: { color: theme.colors.textDim, fontWeight: 'bold' },
  chipTextActive: { color: theme.colors.text },
  inputGroup: { marginBottom: theme.spacing.m },
  label: { color: theme.colors.textDim, marginBottom: 4, fontSize: 12 },
  input: {
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.s,
    padding: theme.spacing.m,
    color: theme.colors.text,
    fontSize: 16,
  },
  playerActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: theme.spacing.s },
  actionBtn: {
    padding: theme.spacing.s,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: theme.borderRadius.s,
    flex: 0.48,
    alignItems: 'center',
  },
  actionBtnText: { color: theme.colors.text, fontWeight: '600' },
  // Team slots
  teamLabel: { fontWeight: '700', fontSize: 14, marginTop: theme.spacing.m, marginBottom: theme.spacing.s },
  slotsRow: { flexDirection: 'row', gap: theme.spacing.s, marginBottom: theme.spacing.s },
  slot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 70,
    borderStyle: 'dashed',
  },
  slotFilled: { borderStyle: 'solid', borderColor: theme.colors.primary, backgroundColor: 'rgba(59,130,246,0.1)' },
  slotContent: { alignItems: 'center' },
  slotAvatarImg: { width: 40, height: 40, borderRadius: 20, marginBottom: 4 },
  slotInitials: { color: theme.colors.text, fontSize: 20, fontWeight: '900' },
  slotName: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  slotRemove: { color: theme.colors.danger, fontSize: 12, marginTop: 4, fontWeight: 'bold' },
  slotEmpty: { color: theme.colors.textDim, fontSize: 12, fontStyle: 'italic' },
  // Available players
  availableTitle: { color: theme.colors.textDim, fontSize: 13, fontWeight: '700', marginTop: theme.spacing.l, marginBottom: theme.spacing.s },
  loadingText: { color: theme.colors.textDim, fontStyle: 'italic', textAlign: 'center', paddingVertical: theme.spacing.m },
  profileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.s },
  profileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: theme.borderRadius.full,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    gap: 8,
  },
  profileChipSelected: { backgroundColor: 'rgba(59,130,246,0.2)', borderColor: theme.colors.primary },
  profileAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileAvatarSelected: { backgroundColor: theme.colors.primary },
  chipAvatarImg: { width: '100%', height: '100%', borderRadius: 14 },
  profileAvatarText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  profileName: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600', maxWidth: 100 },
  profileNameSelected: { color: theme.colors.text },
  addPlayerBtn: { marginTop: theme.spacing.m, alignItems: 'center' },
  addPlayerText: { color: theme.colors.textDim, fontSize: 12, textDecorationLine: 'underline' },
  // Start button
  startBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.l,
    borderRadius: theme.borderRadius.full,
    alignItems: 'center',
    marginTop: theme.spacing.m,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 8,
  },
  startBtnText: { color: theme.colors.text, fontSize: 18, fontWeight: 'bold' },
  // Modal
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: theme.spacing.xl },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.borderRadius.l,
    padding: theme.spacing.xl,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    alignItems: 'center',
  },
  modalTitle: { color: theme.colors.text, fontSize: 22, fontWeight: '900', marginBottom: theme.spacing.m },
  modalSubtitle: { color: theme.colors.textDim, fontSize: 14, textAlign: 'center', marginBottom: theme.spacing.xl, lineHeight: 22 },
  modalCloseBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: theme.spacing.m,
    paddingHorizontal: theme.spacing.xl,
    borderRadius: theme.borderRadius.full,
  },
  modalCloseBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
