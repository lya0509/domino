import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Alert, RefreshControl, Image, Platform, StatusBar, TextInput, Modal
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { sounds } from '../lib/sounds';
import { Profile } from '../types';
import { MatchGraph } from '../components/MatchGraph';
import { RainbowText } from '../components/RainbowText';
import { LegalModal, LegalTab } from '../components/LegalModal';
import { offlineSync } from '../lib/offlineSync';
import { reconcileUserPendingBets } from '../lib/bettingService';

interface Props {
  profileId: string | null;
  isOwnProfile: boolean;
  onBack: () => void;
  onAdminChanged?: (isAdmin: boolean) => void;
}

interface DuoRecord {
  duoId: string;
  partnerId: string;
  partnerName: string;
  partnerInitials: string;
  isActive: boolean;
  wins: number;
  losses: number;
  totalMatches: number;
}

interface RivalRecord {
  playerId: string;
  name: string;
  initials: string;
  count: number; // veces que me ganó O yo le gané
}

export const ProfileScreen: React.FC<Props> = ({ profileId, isOwnProfile, onBack, onAdminChanged }) => {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [duos, setDuos] = useState<DuoRecord[]>([]);
  const [stats, setStats] = useState({ wins: 0, losses: 0, total: 0, zapatosGiven: 0, zapatosReceived: 0 });
  const [theyWonMore, setTheyWonMore] = useState<RivalRecord[]>([]);
  const [iWonMore, setIWonMore] = useState<RivalRecord[]>([]);
  const [recentMatches, setRecentMatches] = useState<any[]>([]);
  // Full history + full rival lists for the "Ver todo" modal (cards show top 3)
  const [allMyMatches, setAllMyMatches] = useState<any[]>([]);
  const [showAllRivals, setShowAllRivals] = useState(false);
  const [allRivalsTab, setAllRivalsTab] = useState<'won' | 'lost'>('lost');
  const [betHistory, setBetHistory] = useState<any[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [secretTaps, setSecretTaps] = useState(0);
  const [showSecretPin, setShowSecretPin] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const tapTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Modal Legal y Privacidad
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [legalTab, setLegalTab] = useState<LegalTab>('terms');

  const openLegalModal = (tab: LegalTab) => {
    setLegalTab(tab);
    setShowLegalModal(true);
  };

  const fetchData = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);

    try {
      // Reconcile any pending winning bets for own profile first so balance is 100% accurate
      if (isOwnProfile && offlineSync.getIsOnline()) {
        await reconcileUserPendingBets(profileId);
      }

      const [profileData, allProfiles, duosRes, matchesRes, betsRes] = await Promise.all([
        (async () => {
          if (!offlineSync.getIsOnline()) {
            return offlineSync.getCachedProfilesSync().find(p => p.id === profileId) || null;
          }
          const { data } = await supabase.from('profiles').select('*').eq('id', profileId).single();
          return data;
        })(),
        offlineSync.getProfiles(),
        offlineSync.getIsOnline()
          ? supabase.from('duos').select('*').or(`player1_id.eq.${profileId},player2_id.eq.${profileId}`)
          : Promise.resolve({ data: [] as any[] }),
        (async () => {
          if (!offlineSync.getIsOnline()) {
            const cached = await offlineSync.getCachedMatches();
            return cached.filter((m: any) =>
              m.status === 'completed' &&
              [m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2].includes(profileId)
            );
          }
          const { data } = await supabase
            .from('matches')
            .select('id, status, winner_team, is_zapato, team1_player1, team1_player2, team2_player1, team2_player2, team1_total, team2_total, limit_score, rounds, created_at')
            .eq('status', 'completed')
            .or(`team1_player1.eq.${profileId},team1_player2.eq.${profileId},team2_player1.eq.${profileId},team2_player2.eq.${profileId}`);
          return data || [];
        })(),
        offlineSync.getIsOnline()
          ? supabase
              .from('bets')
              .select('id, amount_wagered, multiplier, bet_on_team, status, created_at, match_id')
              .eq('user_id', profileId)
              .order('created_at', { ascending: false })
              .limit(10)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      if (profileData) {
        // Admin comes only from the server (verify_admin_pin), never from a local flag
        setProfile(profileData as Profile);
        offlineSync.updateProfileInCache(profileData as Profile);
      }

      const pMap: Record<string, Profile> = {};
      (allProfiles || []).forEach((p: Profile) => { pMap[p.id] = p; });
      setProfileMap(pMap);

      const duosData = duosRes.data || [];
      const matches = matchesRes || [];

      let wins = 0, losses = 0, zapatosGiven = 0, zapatosReceived = 0;
      matches.forEach((m: any) => {
        const team1 = [m.team1_player1, m.team1_player2].filter(Boolean);
        const team2 = [m.team2_player1, m.team2_player2].filter(Boolean);
        const inTeam1 = team1.includes(profileId);
        const inTeam2 = team2.includes(profileId);

        if (!inTeam1 && !inTeam2) return;
        if (!m.winner_team) return;

        const won = (inTeam1 && m.winner_team === 1) || (inTeam2 && m.winner_team === 2);
        if (won) {
          wins++;
          if (m.is_zapato) zapatosGiven++;
        } else {
          losses++;
          if (m.is_zapato) zapatosReceived++;
        }
      });
      setStats({ wins, losses, total: wins + losses, zapatosGiven, zapatosReceived });

      // Build recent matches history
      const myMatches = [...matches];
      myMatches.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRecentMatches(myMatches.slice(0, 5));
      setAllMyMatches(myMatches);

      // Compute rival stats
      const theyWonCounter: Record<string, number> = {};
      const iWonCounter: Record<string, number> = {};

      matches.forEach((m: any) => {
        const team1 = [m.team1_player1, m.team1_player2].filter(Boolean);
        const team2 = [m.team2_player1, m.team2_player2].filter(Boolean);
        const inTeam1 = team1.includes(profileId);
        const inTeam2 = team2.includes(profileId);

        if (!inTeam1 && !inTeam2) return;
        if (!m.winner_team) return;

        const rivalTeam = inTeam1 ? team2 : team1;
        const iWon = (inTeam1 && m.winner_team === 1) || (!inTeam1 && m.winner_team === 2);

        rivalTeam.forEach((rivalId: string) => {
          if (!rivalId) return;
          if (iWon) {
            iWonCounter[rivalId] = (iWonCounter[rivalId] || 0) + 1;
          } else {
            theyWonCounter[rivalId] = (theyWonCounter[rivalId] || 0) + 1;
          }
        });
      });

      const buildRivals = (counter: Record<string, number>): RivalRecord[] =>
        Object.entries(counter)
          .sort((a, b) => b[1] - a[1])
          .map(([playerId, count]) => ({
            playerId,
            name: pMap[playerId]?.display_name || 'Desconocido',
            initials: pMap[playerId]?.initials || '??',
            count,
          }));

      setTheyWonMore(buildRivals(theyWonCounter));
      setIWonMore(buildRivals(iWonCounter));

      if (betsRes.data) {
        setBetHistory(betsRes.data);
      }

      // Build duo records
      // Collapse legacy duplicate rows (A,B)/(B,A) into one per partner, preferring the active one
      const duoByPartner: Record<string, any> = {};
      (duosData || []).forEach((d: any) => {
        const pid = d.player1_id === profileId ? d.player2_id : d.player1_id;
        const prev = duoByPartner[pid];
        if (!prev || (prev.is_active === false && d.is_active !== false)) duoByPartner[pid] = d;
      });
      const duoRecords: DuoRecord[] = Object.values(duoByPartner).map((d: any) => {
        const partnerId = d.player1_id === profileId ? d.player2_id : d.player1_id;
        const partner = pMap[partnerId];

        let duoWins = 0, duoLosses = 0;
        matches.forEach((m: any) => {
          if (!m.winner_team) return;
          const team1 = [m.team1_player1, m.team1_player2].filter(Boolean);
          const team2 = [m.team2_player1, m.team2_player2].filter(Boolean);
          const togetherInTeam1 = team1.includes(profileId) && team1.includes(partnerId);
          const togetherInTeam2 = team2.includes(profileId) && team2.includes(partnerId);
          if (togetherInTeam1) {
            if (m.winner_team === 1) duoWins++; else duoLosses++;
          } else if (togetherInTeam2) {
            if (m.winner_team === 2) duoWins++; else duoLosses++;
          }
        });

        return {
          duoId: d.id,
          partnerId,
          partnerName: partner?.display_name || 'Desconocido',
          partnerInitials: partner?.initials || '??',
          isActive: d.is_active !== false,
          wins: duoWins,
          losses: duoLosses,
          totalMatches: duoWins + duoLosses,
        };
      });

      setDuos(duoRecords);
    } catch (err) {
      console.error('Error fetching profile data:', err);
    } finally {
      setLoading(false);
    }
  }, [profileId, isOwnProfile]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handlePickAvatar = async () => {
    if (!profileId || !isOwnProfile) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
        base64: true,
      });

      if (result.canceled || !result.assets[0].base64) return;

      setUploadingAvatar(true);
      const base64Data = result.assets[0].base64;
      const ext = result.assets[0].uri.split('.').pop()?.toLowerCase() || 'jpg';
      const fileName = `${profileId}-${Date.now()}.${ext}`;
      const filePath = `${profileId}/${fileName}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, decode(base64Data), {
          contentType: `image/${ext}`,
          upsert: true,
        });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
      const publicUrl = data.publicUrl;

      // Update profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', profileId);

      if (updateError) throw updateError;

      // Update local state
      setProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : null);
      Alert.alert('Éxito', 'Foto de perfil actualizada correctamente.');

    } catch (error: any) {
      console.error('Error uploading avatar:', error);
      Alert.alert('Error', 'No se pudo subir la foto de perfil.');
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleProfileSecretTap = () => {
    if (!isOwnProfile) return;

    if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
    tapTimeoutRef.current = setTimeout(() => {
      setSecretTaps(0);
    }, 3500);

    setSecretTaps(prev => {
      const newTaps = prev + 1;
      if (newTaps >= 7) {
        if (tapTimeoutRef.current) clearTimeout(tapTimeoutRef.current);
        if (profile?.is_admin) {
          Alert.alert(
            '🛡️ Modo Administrador Activo',
            'Ya tienes el Modo Administrador activado.\n\n¿Deseas desactivarlo para volver a ser usuario regular?',
            [
              { text: 'Mantener Activo', style: 'cancel' },
              {
                text: 'Desactivar Modo Admin',
                style: 'destructive',
                onPress: handleDisableAdmin,
              }
            ]
          );
        } else {
          setShowSecretPin(true);
        }
        return 0;
      }
      return newTaps;
    });
  };

  const handlePinSubmit = async () => {
    const cleanPin = pinInput.trim();
    setShowSecretPin(false);
    setPinInput('');
    if (!cleanPin) return;
    // Only the server knows the PIN: the app never compares it or shows it
    try {
      const { data: ok, error } = await supabase.rpc('verify_admin_pin', {
        p_pin: cleanPin,
        p_enable: true,
      });
      if (error) throw error;
      if (ok !== true) {
        Alert.alert('Error', 'PIN incorrecto.');
        return;
      }
      setProfile(prev => prev ? { ...prev, is_admin: true } : null);
      if (onAdminChanged) onAdminChanged(true);
      sounds.playSound('chaching');
      Alert.alert('¡Admin Activado! 👑', 'Modo Administrador activado en tu cuenta.');
    } catch (e: any) {
      console.error('Error activating admin:', e);
      Alert.alert('Error', e.message || 'No se pudo activar el modo');
    }
  };

  const handleDisableAdmin = () => {
    Alert.alert(
      '🛡️ Desactivar Modo Administrador',
      '¿Deseas desactivar el Modo Administrador y volver a ser un usuario regular?',
      [
        { text: 'Mantener Activo', style: 'cancel' },
        {
          text: 'Sí, Desactivar',
          style: 'destructive',
          onPress: async () => {
            try {
              // Old builds kept a local admin flag; drop it
              await AsyncStorage.removeItem('@domino_admin_override');

              // An admin may clear their own is_admin (protect_profile_sensitive_fields)
              if (profileId) {
                const { error } = await supabase.from('profiles').update({ is_admin: false }).eq('id', profileId);
                if (error) throw error;
              }
              setProfile(prev => prev ? { ...prev, is_admin: false } : null);
              if (onAdminChanged) onAdminChanged(false);

              Alert.alert('✅ Desactivado', 'El Modo Administrador ha sido desactivado correctamente.');
            } catch (e: any) {
              console.error('Error disabling admin:', e);
              Alert.alert('Error', e.message || 'No se pudo desactivar el modo');
            }
          },
        },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      '⚠️ Eliminar Cuenta y Datos',
      '¿Estás seguro de que deseas eliminar permanentemente tu cuenta?\n\nEsta acción es irreversible: se borrarán tus estadísticas, logros, datos de perfil y perderás el acceso a la plataforma según la normativa de protección de datos.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sí, Eliminar Todo',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              // 1. The server deletes the data (or anonymizes it when match history needs the profile)
              //    and closes the login; only report success when it confirms
              const { data, error } = await supabase.rpc('delete_user_account');
              if (error) throw error;
              if (!data?.deleted) throw new Error('El servidor no confirmó el borrado.');

              // 2. Limpiar almacenamiento local del dispositivo
              await AsyncStorage.removeItem('@domino_admin_override');
              await AsyncStorage.removeItem('@domino_match');
              if (Platform.OS === 'web' && typeof window !== 'undefined') {
                window.localStorage.removeItem('@domino_admin_override');
                window.localStorage.removeItem('@domino_match');
              }

              // 3. Cerrar sesión en Supabase Auth
              await supabase.auth.signOut();

              Alert.alert('Cuenta Eliminada', 'Tu cuenta y todos tus datos personales han sido eliminados.');
              onBack();
            } catch (err: any) {
              console.error('Error deleting account:', err);
              Alert.alert('Error', err.message || 'No se pudo eliminar la cuenta por completo.');
            } finally {
              setLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleCancelDuo = (duo: DuoRecord) => {
    Alert.alert(
      'Cancelar Duo',
      `¿Estás seguro que quieres cancelar tu duo con ${duo.partnerName}? Su historial de partidas no se borrará.`,
      [
        { text: 'No, mantener', style: 'cancel' },
        {
          text: 'Sí, cancelar',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase
                .from('duos')
                .update({ is_active: false })
                .or(`and(player1_id.eq.${profileId},player2_id.eq.${duo.partnerId}),and(player1_id.eq.${duo.partnerId},player2_id.eq.${profileId})`)
                .select('id')
                .then(({ data, error }) => {
                  // RLS silently updates 0 rows when no UPDATE policy exists (see fix_duos_duplicates.sql)
                  if (error || !data || data.length === 0) {
                    Alert.alert('Error', 'No se pudo cancelar el duo. Intenta de nuevo.');
                  }
                });
              fetchData(); // Recargar
            } catch (err) {
              Alert.alert('Error', 'No se pudo cancelar el duo. Intenta de nuevo.');
            }
          },
        },
      ]
    );
  };

  const isMatchWon = (m: any) => {
    const inTeam1 = [m.team1_player1, m.team1_player2].includes(profileId);
    return (inTeam1 && m.winner_team === 1) || (!inTeam1 && m.winner_team === 2);
  };
  const decidedMatches = allMyMatches.filter((m) => !!m.winner_team);
  const wonMatches = decidedMatches.filter(isMatchWon);
  const lostMatches = decidedMatches.filter((m) => !isMatchWon(m));
  const sumCounts = (list: RivalRecord[]) => list.reduce((acc, r) => acc + r.count, 0);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Cargando perfil...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const activeDuos = duos.filter(d => d.isActive);
  const inactiveDuos = duos.filter(d => !d.isActive);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <TouchableOpacity activeOpacity={0.9} onPress={handleProfileSecretTap}>
          <Text style={styles.headerTitle}>{isOwnProfile ? 'Mi Perfil' : 'Perfil de Jugador'}</Text>
        </TouchableOpacity>
        <View style={{ width: 60 }} />
      </View>

      {/* Modal Secreto de PIN de Administrador */}
      <Modal visible={showSecretPin} transparent animationType="fade">
        <View style={styles.pinModalOverlay}>
          <View style={styles.pinModalBox}>
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ fontSize: 36, marginBottom: 6 }}>👑</Text>
              <Text style={styles.pinModalTitle}>Acceso de Administrador</Text>
              <Text style={styles.pinModalDesc}>
                Ingresa el PIN de 8 dígitos para habilitar el Modo Administrador.
              </Text>
            </View>

            <TextInput
              style={styles.pinModalInput}
              secureTextEntry
              placeholder="PIN Maestro"
              placeholderTextColor="rgba(255,255,255,0.4)"
              value={pinInput}
              onChangeText={setPinInput}
              keyboardType="numeric"
              maxLength={8}
              autoFocus
            />

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.pinModalBtn, { backgroundColor: 'rgba(255,255,255,0.1)' }]}
                onPress={() => {
                  setShowSecretPin(false);
                  setPinInput('');
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.pinModalBtnText}>Cancelar</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.pinModalBtn, { backgroundColor: theme.colors.primary }]}
                onPress={handlePinSubmit}
                activeOpacity={0.8}
              >
                <Text style={[styles.pinModalBtnText, { fontWeight: '900', color: '#fff' }]}>Activar 👑</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
      >

        {/* Credencial Digital de Socio VIP */}
        <View style={styles.vipCredentialCard}>
          {/* Header of Credential */}
          <TouchableOpacity activeOpacity={0.9} onPress={handleProfileSecretTap} style={styles.credentialHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 18, marginRight: 8 }}>🁣</Text>
              <View>
                <Text style={styles.credentialClubName}>DOMINO DEL CAFETÍN</Text>
                <Text style={styles.credentialSub}>CREDENCIAL OFICIAL DE SOCIO</Text>
              </View>
            </View>
            <View style={styles.credentialChip}>
              <Text style={styles.credentialChipText}>💳 VIP</Text>
            </View>
          </TouchableOpacity>

          {/* Central Avatar & Info */}
          <View style={styles.credentialBody}>
            <TouchableOpacity
              style={[
                styles.avatar,
                profile?.equipped_items?.border && { borderWidth: 4, borderColor: profile.equipped_items.border, padding: 2 }
              ]}
              onPress={isOwnProfile ? handlePickAvatar : undefined}
              disabled={!isOwnProfile || uploadingAvatar}
              activeOpacity={isOwnProfile ? 0.8 : 1}
            >
              {uploadingAvatar ? (
                <ActivityIndicator color="#fff" />
              ) : profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={[styles.avatarImage, profile?.equipped_items?.border && { width: 72, height: 72, borderRadius: 36 }]} />
              ) : (
                <Text style={styles.avatarText}>{profile?.initials}</Text>
              )}
              {isOwnProfile && (
                <View style={styles.editAvatarBadge}>
                  <Text style={styles.editAvatarText}>✏️</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity activeOpacity={0.8} onPress={handleProfileSecretTap} style={{ alignItems: 'center' }}>
              {profile?.equipped_items?.color === 'rainbow' ? (
                <RainbowText style={[styles.profileName, { textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 }]}>
                  {profile.display_name}
                </RainbowText>
              ) : (
                <Text style={[
                  styles.profileName,
                  profile?.equipped_items?.color && { color: profile.equipped_items.color, textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 2 }
                ]}>
                  {profile?.display_name || 'Desconocido'}
                </Text>
              )}
            </TouchableOpacity>

            {profile?.equipped_items?.title && (
              <Text style={{ color: '#fbbf24', fontWeight: '800', marginTop: 4, fontSize: 13, letterSpacing: 0.5 }}>
                ⭐ {profile.equipped_items.title}
              </Text>
            )}

            {profile?.is_admin && (
              <TouchableOpacity 
                onPress={isOwnProfile ? handleDisableAdmin : undefined}
                style={{ backgroundColor: theme.colors.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginTop: 8 }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 }}>
                  🛡️ ADMINISTRADOR {isOwnProfile ? '(Toca para quitar)' : ''}
                </Text>
              </TouchableOpacity>
            )}

            {/* Betting Points */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, backgroundColor: 'rgba(234, 179, 8, 0.12)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(234, 179, 8, 0.35)' }}>
              <Text style={{ fontSize: 15 }}>🪙 </Text>
              <Text style={{ color: '#fbbf24', fontWeight: '800', fontSize: 15 }}>{profile?.betting_points || 0} pts</Text>
            </View>
          </View>

          {/* Footer of Credential: Member ID & Status */}
          <TouchableOpacity activeOpacity={0.9} onPress={handleProfileSecretTap} style={styles.credentialFooter}>
            <View>
              <Text style={styles.credentialFooterLabel}>ID DE SOCIO</Text>
              <Text style={styles.credentialFooterVal}>
                #CAF-{profileId ? profileId.substring(0, 8).toUpperCase() : '0000'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.credentialFooterLabel}>ESTADO</Text>
              <Text style={[styles.credentialFooterVal, { color: '#4ade80' }]}>● ACTIVO</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Medals Showcase */}
        {(() => {
          const winRate = stats.total > 0 ? (stats.wins / stats.total) : 0;
          const hasLoyalDuo = activeDuos.some(d => d.totalMatches >= 10);
          
          const achievements = [
            { id: 'zapatero_1', title: 'Zapatero', icon: '👟', desc: 'Primer zapato', unlocked: stats.zapatosGiven >= 1 },
            { id: 'zapatero_10', title: 'Maestro', icon: '🔥', desc: '10 zapatos', unlocked: stats.zapatosGiven >= 10 },
            { id: 'zapatero_50', title: 'Dios Z.', icon: '👑', desc: '50 zapatos', unlocked: stats.zapatosGiven >= 50 },
            { id: 'racha', title: 'Fuego', icon: '🚀', desc: 'Racha de 3', unlocked: (profile?.streak_count || 0) >= 3 },
            { id: 'dominador', title: 'Dominador', icon: '⚔️', desc: '+60% WinRate', unlocked: stats.total >= 10 && winRate >= 0.6 },
            { id: 'leal', title: 'Leal', icon: '🤝', desc: '10 ptas Dúo', unlocked: hasLoyalDuo },
            { id: 'rico', title: 'Rico', icon: '💰', desc: '100k pts', unlocked: (profile?.betting_points || 0) >= 100000 },
            { id: 'veterano', title: 'Veterano', icon: '🎖️', desc: '100 ptas', unlocked: stats.total >= 100 },
          ];

          return (
            <View style={[styles.card, { marginTop: 16 }]}>
              <Text style={styles.cardTitle}>🏆 Vitrina de Medallas</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }}>
                {achievements.map(a => (
                  <View key={a.id} style={{ alignItems: 'center', width: 75, opacity: a.unlocked ? 1 : 0.3 }}>
                    <View style={{ 
                      width: 50, height: 50, borderRadius: 25, 
                      backgroundColor: a.unlocked ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255,255,255,0.05)',
                      borderWidth: 2, borderColor: a.unlocked ? theme.colors.warning : theme.colors.cardBorder,
                      justifyContent: 'center', alignItems: 'center', marginBottom: 4
                    }}>
                      <Text style={{ fontSize: 24, filter: a.unlocked ? 'none' : 'grayscale(100%)' }}>{a.icon}</Text>
                    </View>
                    <Text style={{ color: a.unlocked ? theme.colors.warning : theme.colors.textDim, fontSize: 11, fontWeight: 'bold', textAlign: 'center' }} numberOfLines={1}>{a.title}</Text>
                    <Text style={{ color: theme.colors.textDim, fontSize: 9, textAlign: 'center' }}>{a.desc}</Text>
                  </View>
                ))}
              </View>
            </View>
          );
        })()}

        {/* Personal Stats */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📊 Estadísticas Personales</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.success }]}>{stats.wins}</Text>
              <Text style={styles.statLabel}>Ganadas</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.danger }]}>{stats.losses}</Text>
              <Text style={styles.statLabel}>Perdidas</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats.total}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: theme.colors.accent }]}>{stats.zapatosGiven}</Text>
              <Text style={styles.statLabel}>Zapatos 👟</Text>
            </View>
          </View>
          {stats.total > 0 && (
            <View style={styles.winRateBar}>
              <View style={[styles.winRateFill, { width: `${(stats.wins / stats.total) * 100}%` }]} />
            </View>
          )}
          {stats.total > 0 && (
            <Text style={styles.winRateText}>
              {Math.round((stats.wins / stats.total) * 100)}% de victorias
            </Text>
          )}
        </View>

        {/* Recent Matches */}
        {recentMatches.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>⏱ Últimas 5 Partidas</Text>
            {recentMatches.map((m, i) => {
              const team1 = [m.team1_player1, m.team1_player2].filter(Boolean);
              const team2 = [m.team2_player1, m.team2_player2].filter(Boolean);
              const inTeam1 = team1.includes(profileId);
              const rivalTeam = inTeam1 ? team2 : team1;
              const isNullMatch = !m.winner_team;
              const iWon = (inTeam1 && m.winner_team === 1) || (!inTeam1 && m.winner_team === 2);
              const myScore = inTeam1 ? m.team1_total : m.team2_total;
              const rivalScore = inTeam1 ? m.team2_total : m.team1_total;

              const rivalNames = rivalTeam.length > 0
                ? rivalTeam.map((id: string) => profileMap[id]?.display_name || 'Desconocido').join(' y ')
                : 'Nadie';

              let badgeColor = isNullMatch ? theme.colors.textDim : (iWon ? theme.colors.success : theme.colors.danger);
              let badgeText = isNullMatch ? '-' : (iWon ? 'W' : 'L');

              return (
                <View key={m.id} style={styles.matchHistoryCard}>
                  <TouchableOpacity
                    style={styles.rivalRow}
                    onPress={() => setExpandedMatch(expandedMatch === m.id ? null : m.id)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.duoAvatar, { backgroundColor: badgeColor }]}>
                      <Text style={styles.duoAvatarText}>{badgeText}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rivalName, { fontSize: 14 }]}>vs {rivalNames}</Text>
                      <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>
                        {new Date(m.created_at).toLocaleDateString()} {m.is_zapato ? '👟' : ''} {isNullMatch ? '(Anulada)' : ''}
                      </Text>
                    </View>
                    <Text style={[styles.rivalBadgeText, { color: badgeColor, fontSize: 18 }]}>
                      {myScore} - {rivalScore}
                    </Text>
                  </TouchableOpacity>

                  {expandedMatch === m.id && (
                    <View style={styles.graphContainer}>
                      <Text style={styles.graphTitle}>El VAR del Dominó (Puntos por Ronda)</Text>
                      <MatchGraph rounds={m.rounds} limitScore={m.limit_score} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Rivals — me han ganado más */}
        {theyWonMore.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>😤 Me han ganado más</Text>
            <Text style={styles.rivalTotalText}>
              Total: {lostMatches.length} partidas perdidas · {theyWonMore.length} rivales
            </Text>
            {theyWonMore.slice(0, 3).map((r, i) => (
              <View key={r.playerId} style={styles.rivalRow}>
                <Text style={styles.rivalRank}>#{i + 1}</Text>
                <View style={[styles.duoAvatar, { backgroundColor: theme.colors.danger }]}>
                  <Text style={styles.duoAvatarText}>{r.initials}</Text>
                </View>
                <Text style={styles.rivalName}>{r.name}</Text>
                <View style={styles.rivalBadge}>
                  <Text style={styles.rivalBadgeText}>{r.count}x</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={styles.seeAllBtn}
              onPress={() => { setAllRivalsTab('lost'); setShowAllRivals(true); }}
            >
              <Text style={styles.seeAllBtnText}>Ver todo →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Rivals — yo más les he ganado */}
        {iWonMore.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>😎 Yo más les he ganado</Text>
            <Text style={styles.rivalTotalText}>
              Total: {wonMatches.length} partidas ganadas · {iWonMore.length} rivales
            </Text>
            {iWonMore.slice(0, 3).map((r, i) => (
              <View key={r.playerId} style={styles.rivalRow}>
                <Text style={styles.rivalRank}>#{i + 1}</Text>
                <View style={[styles.duoAvatar, { backgroundColor: theme.colors.success }]}>
                  <Text style={styles.duoAvatarText}>{r.initials}</Text>
                </View>
                <Text style={styles.rivalName}>{r.name}</Text>
                <View style={[styles.rivalBadge, { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: theme.colors.success }]}>
                  <Text style={[styles.rivalBadgeText, { color: theme.colors.success }]}>{r.count}x</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={styles.seeAllBtn}
              onPress={() => { setAllRivalsTab('won'); setShowAllRivals(true); }}
            >
              <Text style={styles.seeAllBtnText}>Ver todo →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Ver todo: all won/lost matches + full rival list */}
        <Modal visible={showAllRivals} animationType="slide" transparent onRequestClose={() => setShowAllRivals(false)}>
          <View style={styles.allRivalsOverlay}>
            <View style={styles.allRivalsSheet}>
              <View style={styles.allRivalsHeader}>
                <Text style={styles.cardTitle}>📊 Historial de Rivalidades</Text>
                <TouchableOpacity onPress={() => setShowAllRivals(false)} accessibilityLabel="Cerrar">
                  <Text style={styles.allRivalsClose}>✕</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.allRivalsTabs}>
                <TouchableOpacity
                  style={[styles.allRivalsTab, allRivalsTab === 'lost' && { borderColor: theme.colors.danger }]}
                  onPress={() => setAllRivalsTab('lost')}
                >
                  <Text style={[styles.allRivalsTabText, allRivalsTab === 'lost' && { color: theme.colors.danger }]}>
                    😤 Perdidas ({lostMatches.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.allRivalsTab, allRivalsTab === 'won' && { borderColor: theme.colors.success }]}
                  onPress={() => setAllRivalsTab('won')}
                >
                  <Text style={[styles.allRivalsTabText, allRivalsTab === 'won' && { color: theme.colors.success }]}>
                    😎 Ganadas ({wonMatches.length})
                  </Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={{ flexGrow: 0 }}>
                <Text style={styles.allRivalsSection}>
                  {allRivalsTab === 'lost' ? 'Quiénes me han ganado' : 'A quiénes les he ganado'} ({sumCounts(allRivalsTab === 'lost' ? theyWonMore : iWonMore)})
                </Text>
                {(allRivalsTab === 'lost' ? theyWonMore : iWonMore).map((r, i) => (
                  <View key={r.playerId} style={styles.rivalRow}>
                    <Text style={styles.rivalRank}>#{i + 1}</Text>
                    <Text style={styles.rivalName}>{r.name}</Text>
                    <Text style={[styles.rivalBadgeText, { color: allRivalsTab === 'lost' ? theme.colors.danger : theme.colors.success }]}>
                      {r.count}x
                    </Text>
                  </View>
                ))}
                <Text style={styles.allRivalsSection}>Partidas</Text>
                {(allRivalsTab === 'lost' ? lostMatches : wonMatches).map((m) => {
                  const inTeam1 = [m.team1_player1, m.team1_player2].includes(profileId);
                  const rivalTeam = (inTeam1 ? [m.team2_player1, m.team2_player2] : [m.team1_player1, m.team1_player2]).filter(Boolean);
                  const myScore = inTeam1 ? m.team1_total : m.team2_total;
                  const rivalScore = inTeam1 ? m.team2_total : m.team1_total;
                  return (
                    <View key={m.id} style={styles.rivalRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.rivalName, { fontSize: 14 }]}>
                          vs {rivalTeam.map((id: string) => profileMap[id]?.display_name || 'Desconocido').join(' y ') || 'Nadie'}
                        </Text>
                        <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>
                          {new Date(m.created_at).toLocaleDateString()} {m.is_zapato ? '👟' : ''}
                        </Text>
                      </View>
                      <Text style={[styles.rivalBadgeText, { color: allRivalsTab === 'lost' ? theme.colors.danger : theme.colors.success, fontSize: 16 }]}>
                        {myScore} - {rivalScore}
                      </Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Active Duos */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🤝 Mis Duos Activos</Text>
          {activeDuos.length === 0 ? (
            <Text style={styles.emptyText}>
              No tienes duos activos aún.{'\n'}Al terminar una partida, podrás confirmar un duo con tu compañero.
            </Text>
          ) : (
            activeDuos.map(duo => (
              <View key={duo.duoId} style={styles.duoCard}>
                <View style={styles.duoAvatar}>
                  <Text style={styles.duoAvatarText}>{duo.partnerInitials}</Text>
                </View>
                <View style={styles.duoInfo}>
                  <Text style={styles.duoName}>{duo.partnerName}</Text>
                  <Text style={styles.duoStats}>
                    {duo.wins}G - {duo.losses}P · {duo.totalMatches} partidas juntos
                  </Text>
                </View>
                {isOwnProfile && (
                  <TouchableOpacity
                    style={styles.cancelBtn}
                    onPress={() => handleCancelDuo(duo)}
                  >
                    <Text style={styles.cancelBtnText}>Cancelar</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))
          )}
        </View>

        {/* Inactive Duos */}
        {inactiveDuos.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>⏸ Duos Anteriores</Text>
            {inactiveDuos.map(duo => (
              <View key={duo.duoId} style={[styles.duoCard, styles.duoCardInactive]}>
                <View style={[styles.duoAvatar, styles.duoAvatarInactive]}>
                  <Text style={styles.duoAvatarText}>{duo.partnerInitials}</Text>
                </View>
                <View style={styles.duoInfo}>
                  <Text style={[styles.duoName, { color: theme.colors.textDim }]}>{duo.partnerName}</Text>
                  <Text style={styles.duoStats}>
                    {duo.wins}G - {duo.losses}P · {duo.totalMatches} partidas juntos
                  </Text>
                </View>
                <View style={styles.inactiveBadge}>
                  <Text style={styles.inactiveBadgeText}>Inactivo</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Betting History */}
        {betHistory.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>🎲 Últimas Apuestas</Text>
            {betHistory.map((bet) => {
              const isResolved = bet.status !== 'pending';
              const wonBet = bet.status === 'won';
              const isCancelled = bet.status === 'cancelled';
              const mult = Number(bet.multiplier) > 0 ? Number(bet.multiplier) : 2.0;
              const payout = Math.floor(Number(bet.amount_wagered || 0) * mult);

              let resultText = 'En curso ⏳';
              let resultColor = theme.colors.textDim;
              if (isResolved) {
                if (isCancelled) {
                  resultText = `Reembolsado (+${bet.amount_wagered} pts)`;
                  resultColor = '#60a5fa';
                } else {
                  resultText = wonBet ? `+${payout} pts 🤑` : `-${bet.amount_wagered} pts 💸`;
                  resultColor = wonBet ? theme.colors.success : theme.colors.danger;
                }
              }

              return (
                <View key={bet.id} style={styles.rivalRow}>
                  <Text style={styles.rivalRank}>🎲</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rivalName, { fontSize: 14 }]}>
                      Apuesta: {bet.amount_wagered} pts (x{mult})
                    </Text>
                    <Text style={{ color: theme.colors.textDim, fontSize: 12 }}>
                      Equipo {bet.bet_on_team}
                    </Text>
                  </View>
                  <View style={[styles.rivalBadge, { borderColor: resultColor, backgroundColor: 'transparent' }]}>
                    <Text style={[styles.rivalBadgeText, { color: resultColor }]}>{resultText}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* QR Invite Card */}
        {isOwnProfile && (
          <View style={[styles.card, { alignItems: 'center', borderColor: 'rgba(59, 130, 246, 0.4)', borderWidth: 1, paddingVertical: 20 }]}>
            <Text style={[styles.cardTitle, { color: '#60a5fa', textAlign: 'center', marginBottom: 6 }]}>📲 Pase de Invitación VIP</Text>
            <Text style={{ color: theme.colors.textDim, fontSize: 13, textAlign: 'center', marginBottom: 16, paddingHorizontal: 12, lineHeight: 18 }}>
              Muestra este código QR a un compañero en el cafetín para que lo escanee con su cámara y pueda registrarse en la aplicación.
            </Text>

            <View style={{ padding: 12, backgroundColor: '#ffffff', borderRadius: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 }}>
              <Image
                source={{
                  uri: `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
                    Platform.OS === 'web' && typeof window !== 'undefined'
                      ? `${window.location.origin}/?invite=CAFETIN`
                      : 'https://domino-mauve.vercel.app/?invite=CAFETIN'
                  )}`
                }}
                style={{ width: 170, height: 170 }}
                resizeMode="contain"
              />
            </View>

            <View style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(59, 130, 246, 0.3)' }}>
              <Text style={{ color: '#93c5fd', fontWeight: 'bold', fontSize: 12 }}>
                Pase Válido: CAFETIN
              </Text>
            </View>

            <TouchableOpacity
              style={[styles.cancelBtn, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary, width: '100%', alignItems: 'center', paddingVertical: 12 }]}
              onPress={() => {
                const url = Platform.OS === 'web' && typeof window !== 'undefined'
                  ? `${window.location.origin}/?invite=CAFETIN`
                  : 'https://domino-mauve.vercel.app/?invite=CAFETIN';
                if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
                  navigator.clipboard.writeText(url);
                  Alert.alert('¡Copiado!', 'Enlace de invitación copiado al portapapeles.');
                } else {
                  Alert.alert('Enlace de Invitación', url);
                }
              }}
            >
              <Text style={[styles.cancelBtnText, { color: '#fff', fontWeight: 'bold' }]}>🔗 Copiar Enlace para WhatsApp</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sección Legal & Seguridad */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>⚖️ Legal & Seguridad</Text>
          <Text style={{ color: theme.colors.textDim, fontSize: 13, marginBottom: 14, lineHeight: 18 }}>
            Consulta las normativas oficiales, términos del club y políticas de protección de datos.
          </Text>

          <View style={styles.legalButtonsList}>
            <TouchableOpacity
              style={styles.legalRowBtn}
              onPress={() => openLegalModal('terms')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Ver Términos y Condiciones de Uso"
            >
              <Text style={styles.legalRowIcon}>📜</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.legalRowTitle}>Términos y Condiciones de Uso</Text>
                <Text style={styles.legalRowSubtitle}>Normas de convivencia y Fair Play</Text>
              </View>
              <Text style={styles.legalRowArrow}>➜</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.legalRowBtn}
              onPress={() => openLegalModal('privacy')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Ver Política de Privacidad y Protección de Datos"
            >
              <Text style={styles.legalRowIcon}>🔒</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.legalRowTitle}>Política de Privacidad y Datos</Text>
                <Text style={styles.legalRowSubtitle}>Minimización y derechos ARCO</Text>
              </View>
              <Text style={styles.legalRowArrow}>➜</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.legalRowBtn}
              onPress={() => openLegalModal('rules')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Ver Reglamento Oficial de Torneos VIP"
            >
              <Text style={styles.legalRowIcon}>🏆</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.legalRowTitle}>Reglamento de Torneos VIP</Text>
                <Text style={styles.legalRowSubtitle}>Pozos de premios, validación y pagos</Text>
              </View>
              <Text style={styles.legalRowArrow}>➜</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.legalRowBtn}
              onPress={() => openLegalModal('cookies')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Ver Política de Almacenamiento Local y Cookies"
            >
              <Text style={styles.legalRowIcon}>🍪</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.legalRowTitle}>Almacenamiento Local y Cookies</Text>
                <Text style={styles.legalRowSubtitle}>Tecnologías esenciales y memoria</Text>
              </View>
              <Text style={styles.legalRowArrow}>➜</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.legalRowBtn}
              onPress={() => openLegalModal('contact')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Ver Canales de Contacto y Soporte Oficial"
            >
              <Text style={styles.legalRowIcon}>📬</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.legalRowTitle}>Contacto y Soporte Oficial</Text>
                <Text style={styles.legalRowSubtitle}>Canales de atención del club</Text>
              </View>
              <Text style={styles.legalRowArrow}>➜</Text>
            </TouchableOpacity>
          </View>

          {isOwnProfile && (
            <TouchableOpacity
              style={styles.deleteAccountBtn}
              onPress={handleDeleteAccount}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Eliminar mi cuenta y datos personales definitivamente"
            >
              <Text style={styles.deleteAccountBtnText}>⚠️ Eliminar mi cuenta y datos personales</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <LegalModal
        visible={showLegalModal}
        onClose={() => setShowLegalModal(false)}
        initialTab={legalTab}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: theme.colors.textDim, fontSize: 16 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.l, paddingVertical: theme.spacing.m,
    borderBottomWidth: 1, borderBottomColor: theme.colors.cardBorder,
  },
  headerTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '800' },
  backBtn: { paddingVertical: 6 },
  backBtnText: { color: theme.colors.primary, fontSize: 15, fontWeight: '600' },
  scroll: { padding: theme.spacing.l, paddingBottom: 40 },
  vipCredentialCard: {
    backgroundColor: '#11141b',
    borderRadius: 20,
    padding: 16,
    marginBottom: theme.spacing.xl,
    borderWidth: 1.5,
    borderColor: 'rgba(234, 179, 8, 0.45)',
    shadowColor: '#eab308',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 8,
  },
  credentialHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    paddingBottom: 10,
  },
  credentialClubName: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  credentialSub: {
    color: theme.colors.textDim,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 1,
  },
  credentialChip: {
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    borderWidth: 1,
    borderColor: '#eab308',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  credentialChipText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800',
  },
  credentialBody: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  credentialFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
    paddingTop: 10,
    marginTop: 4,
  },
  credentialFooterLabel: {
    color: theme.colors.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  credentialFooterVal: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center', alignItems: 'center',
    marginBottom: theme.spacing.m,
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  avatarText: { color: '#fff', fontSize: 30, fontWeight: '900' },
  editAvatarBadge: {
    position: 'absolute', bottom: -4, right: -4,
    backgroundColor: theme.colors.card, borderRadius: 12,
    width: 24, height: 24, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: theme.colors.cardBorder,
  },
  editAvatarText: { fontSize: 12 },
  profileName: { color: theme.colors.text, fontSize: 26, fontWeight: '900' },
  card: {
    backgroundColor: theme.colors.card, borderRadius: theme.borderRadius.l,
    padding: theme.spacing.l, borderWidth: 1, borderColor: theme.colors.cardBorder,
    marginBottom: theme.spacing.l,
  },
  cardTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '800', marginBottom: theme.spacing.l },
  statsGrid: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: theme.spacing.m },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { color: theme.colors.text, fontSize: 28, fontWeight: '900' },
  statLabel: { color: theme.colors.textDim, fontSize: 11, marginTop: 2 },
  winRateBar: {
    height: 6, backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 3, overflow: 'hidden', marginBottom: 6,
  },
  winRateFill: { height: '100%', backgroundColor: theme.colors.success, borderRadius: 3 },
  winRateText: { color: theme.colors.textDim, fontSize: 12, textAlign: 'center' },
  emptyText: {
    color: theme.colors.textDim, textAlign: 'center',
    fontStyle: 'italic', lineHeight: 22,
  },
  duoCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: theme.spacing.m,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
    gap: theme.spacing.m,
  },
  duoCardInactive: { opacity: 0.6 },
  duoAvatar: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: theme.colors.primary,
    justifyContent: 'center', alignItems: 'center',
  },
  duoAvatarInactive: { backgroundColor: theme.colors.textDim },
  duoAvatarText: { color: '#fff', fontWeight: '900', fontSize: 14 },
  duoInfo: { flex: 1 },
  duoName: { color: theme.colors.text, fontSize: 16, fontWeight: '700' },
  duoStats: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  cancelBtn: {
    backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1,
    borderColor: theme.colors.danger, borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing.m, paddingVertical: 6,
  },
  cancelBtnText: { color: theme.colors.danger, fontSize: 12, fontWeight: '700' },
  inactiveBadge: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing.m, paddingVertical: 4,
    borderWidth: 1, borderColor: theme.colors.cardBorder,
  },
  inactiveBadgeText: { color: theme.colors.textDim, fontSize: 11, fontWeight: '600' },
  rivalTotalText: { color: theme.colors.textDim, fontSize: 12, marginBottom: 8 },
  seeAllBtn: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 4, marginTop: 4 },
  seeAllBtnText: { color: theme.colors.primary, fontSize: 14, fontWeight: '700' },
  allRivalsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  allRivalsSheet: {
    backgroundColor: theme.colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '85%',
  },
  allRivalsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  allRivalsClose: { color: theme.colors.textDim, fontSize: 22, padding: 4 },
  allRivalsTabs: { flexDirection: 'row', gap: 8, marginVertical: 12 },
  allRivalsTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    alignItems: 'center',
  },
  allRivalsTabText: { color: theme.colors.textDim, fontWeight: '700', fontSize: 13 },
  allRivalsSection: { color: theme.colors.text, fontWeight: '800', fontSize: 14, marginTop: 12, marginBottom: 6 },
  rivalRow: {
    flexDirection: 'row', alignItems: 'center', gap: theme.spacing.m,
    paddingVertical: theme.spacing.m,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  rivalRank: { color: theme.colors.textDim, fontSize: 13, fontWeight: '700', width: 24, textAlign: 'center' },
  rivalName: { color: theme.colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  rivalBadge: {
    backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing.m, paddingVertical: 4,
    borderWidth: 1, borderColor: theme.colors.danger,
  },
  rivalBadgeText: { color: theme.colors.danger, fontSize: 13, fontWeight: '900' },
  matchHistoryCard: {
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  graphContainer: {
    paddingBottom: theme.spacing.m,
  },
  graphTitle: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginTop: theme.spacing.s,
    marginBottom: theme.spacing.xs,
  },
  pinModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  pinModalBox: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
  },
  pinModalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  pinModalDesc: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 12,
    lineHeight: 18,
  },
  pinModalInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 10,
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  pinModalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinModalBtnText: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '700',
  },
  legalButtonsList: {
    gap: 10,
    marginBottom: 16,
  },
  legalRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.07)',
  },
  legalRowIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  legalRowTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  legalRowSubtitle: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 2,
  },
  legalRowArrow: {
    color: '#60a5fa',
    fontSize: 14,
    fontWeight: '800',
    marginLeft: 8,
  },
  deleteAccountBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  deleteAccountBtnText: {
    color: '#ef4444',
    fontSize: 13,
    fontWeight: '800',
  },
});
