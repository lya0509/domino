import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  SafeAreaView, ActivityIndicator, Alert, RefreshControl, Image, Platform, StatusBar, TextInput
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { theme } from '../theme';
import { supabase } from '../lib/supabase';
import { Profile } from '../types';
import { MatchGraph } from '../components/MatchGraph';
import { RainbowText } from '../components/RainbowText';

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
  const [betHistory, setBetHistory] = useState<any[]>([]);
  const [profileMap, setProfileMap] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);
  const [secretTaps, setSecretTaps] = useState(0);
  const [showSecretPin, setShowSecretPin] = useState(false);
  const [pinInput, setPinInput] = useState('');

  const fetchData = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);

    try {
      // Fetch profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .single();
      if (profileData) setProfile(profileData as Profile);

      // Fetch all profiles for name lookup
      const { data: allProfiles } = await supabase.from('profiles').select('*');
      const pMap: Record<string, Profile> = {};
      (allProfiles || []).forEach((p: Profile) => { pMap[p.id] = p; });
      setProfileMap(pMap);

      // Fetch this user's duos (both directions)
      const { data: duosData } = await supabase
        .from('duos')
        .select('*')
        .or(`player1_id.eq.${profileId},player2_id.eq.${profileId}`);

      const { data: matchesData } = await supabase
        .from('matches')
        .select('*')
        .eq('status', 'completed');

      const matches = matchesData || [];

      let wins = 0, losses = 0, zapatosGiven = 0, zapatosReceived = 0;
      matches.forEach((m: any) => {
        const team1 = [m.team1_player1, m.team1_player2].filter(Boolean);
        const team2 = [m.team2_player1, m.team2_player2].filter(Boolean);
        const inTeam1 = team1.includes(profileId);
        const inTeam2 = team2.includes(profileId);

        if (!inTeam1 && !inTeam2) return; // Skip matches where user didn't play
        if (!m.winner_team) return; // Ignorar partidas sin ganador

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
      const myMatches = matches.filter((m: any) => {
        const allPlayers = [m.team1_player1, m.team1_player2, m.team2_player1, m.team2_player2].filter(Boolean);
        return allPlayers.includes(profileId);
      });
      myMatches.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRecentMatches(myMatches.slice(0, 5));

      // Compute rival stats
      const theyWonCounter: Record<string, number> = {};
      const iWonCounter: Record<string, number> = {};

      matches.forEach((m: any) => {
        const team1 = [m.team1_player1, m.team1_player2].filter(Boolean);
        const team2 = [m.team2_player1, m.team2_player2].filter(Boolean);
        const inTeam1 = team1.includes(profileId);
        const inTeam2 = team2.includes(profileId);

        if (!inTeam1 && !inTeam2) return; // Ignore matches where user did not play
        if (!m.winner_team) return; // Ignorar partidas sin ganador

        const myTeam = inTeam1 ? team1 : team2;
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
          .slice(0, 3)
          .map(([playerId, count]) => ({
            playerId,
            name: pMap[playerId]?.display_name || 'Desconocido',
            initials: pMap[playerId]?.initials || '??',
            count,
          }));

      setTheyWonMore(buildRivals(theyWonCounter));
      setIWonMore(buildRivals(iWonCounter));

      // Fetch bets
      const { data: betsData, error: betsError } = await supabase
        .from('bets')
        .select(`
          id, amount_wagered, bet_on_team, status, created_at,
          matches ( id, winner_team, team1_player1, team1_player2, team2_player1, team2_player2 )
        `)
        .eq('user_id', profileId)
        .order('created_at', { ascending: false })
        .limit(10);

      if (betsData) {
        setBetHistory(betsData);
      }

      // Build duo records
      const duoRecords: DuoRecord[] = (duosData || []).map((d: any) => {
        const partnerId = d.player1_id === profileId ? d.player2_id : d.player1_id;
        const partner = pMap[partnerId];

        // Count matches played together and wins
        let duoWins = 0, duoLosses = 0;
        matches.forEach((m: any) => {
          if (!m.winner_team) return; // Ignorar partidas sin ganador
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
          isActive: d.is_active !== false, // default true if column not yet present
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
  }, [profileId]);

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

  const handleHeaderTap = () => {
    if (!isOwnProfile) return;
    setSecretTaps(prev => {
      const newTaps = prev + 1;
      if (newTaps >= 3) {
        setShowSecretPin(true);
        return 0;
      }
      return newTaps;
    });
  };

  const handlePinSubmit = async () => {
    if (pinInput === '05090105') {
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ is_admin: true })
          .eq('id', profileId);

        if (error) throw error;
        Alert.alert('¡Admin Activado!', 'Modo Administrador desbloqueado. Ya puedes gestionar torneos y pagos.');
        setProfile(prev => prev ? { ...prev, is_admin: true } : null);
        if (onAdminChanged) onAdminChanged(true);
      } catch (e) {
        Alert.alert('Error', 'No se pudo activar el modo');
      }
    } else {
      Alert.alert('Error', 'PIN Incorrecto (Usa: 05090105)');
    }
    setShowSecretPin(false);
    setPinInput('');
  };

  const handleDisableAdmin = async () => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_admin: false })
        .eq('id', profileId);

      if (error) throw error;
      Alert.alert('Éxito', 'Modo Admin Desactivado');
      setProfile(prev => prev ? { ...prev, is_admin: false } : null);
      if (onAdminChanged) onAdminChanged(false);
    } catch (e) {
      Alert.alert('Error', 'No se pudo desactivar');
    }
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
                .eq('id', duo.duoId);
              fetchData(); // Recargar
            } catch (err) {
              Alert.alert('Error', 'No se pudo cancelar el duo. Intenta de nuevo.');
            }
          },
        },
      ]
    );
  };

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
        <TouchableOpacity activeOpacity={1} onPress={handleHeaderTap}>
          <Text style={styles.headerTitle}>{isOwnProfile ? 'Mi Perfil' : 'Perfil de Jugador'}</Text>
        </TouchableOpacity>
        <View style={{ width: 60 }} />
      </View>

      {showSecretPin && (
        <View style={{ padding: 16, backgroundColor: theme.colors.cardBorder, margin: 16, borderRadius: 8 }}>
          <TextInput
            style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#fff', padding: 12, borderRadius: 8, marginBottom: 8 }}
            secureTextEntry
            placeholder="PIN Secreto"
            placeholderTextColor="rgba(255,255,255,0.5)"
            value={pinInput}
            onChangeText={setPinInput}
            keyboardType="numeric"
          />
          <TouchableOpacity onPress={handlePinSubmit} style={{ backgroundColor: theme.colors.primary, padding: 12, borderRadius: 8, alignItems: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Activar</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
      >

        <View style={styles.avatarSection}>
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
          <TouchableOpacity activeOpacity={0.8} onPress={handleHeaderTap}>
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
            <Text style={{ color: theme.colors.primary, fontWeight: '800', marginTop: 4, fontSize: 14 }}>
              {profile.equipped_items.title}
            </Text>
          )}

          {profile?.is_admin && (
            <TouchableOpacity 
              onPress={isOwnProfile ? handleDisableAdmin : undefined}
              style={{ backgroundColor: theme.colors.accent, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, marginTop: 8 }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: 'bold' }}>ADMIN {isOwnProfile ? '(Toca para quitar)' : ''}</Text>
            </TouchableOpacity>
          )}

          {/* Betting Points */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: 'rgba(234, 179, 8, 0.1)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(234, 179, 8, 0.3)' }}>
            <Text style={{ fontSize: 16 }}>🪙 </Text>
            <Text style={{ color: theme.colors.text, fontWeight: '800', fontSize: 16 }}>{profile?.betting_points || 0} pts</Text>
          </View>
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
            {theyWonMore.map((r, i) => (
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
          </View>
        )}

        {/* Rivals — yo más les he ganado */}
        {iWonMore.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>😎 Yo más les he ganado</Text>
            {iWonMore.map((r, i) => (
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
          </View>
        )}

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
              const match = bet.matches;
              const isResolved = bet.status !== 'pending';
              const wonBet = bet.status === 'won';

              let resultText = 'En curso ⏳';
              let resultColor = theme.colors.textDim;
              if (isResolved) {
                resultText = wonBet ? `+${bet.amount_wagered * 2} pts 🤑` : `-${bet.amount_wagered} pts 💸`;
                resultColor = wonBet ? theme.colors.success : theme.colors.danger;
              }

              return (
                <View key={bet.id} style={styles.rivalRow}>
                  <Text style={styles.rivalRank}>🎲</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rivalName, { fontSize: 14 }]}>
                      Apuesta: {bet.amount_wagered} pts
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

        <View style={{ height: 40 }} />
      </ScrollView>
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
  avatarSection: { alignItems: 'center', marginBottom: theme.spacing.xl },
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
});
