import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ActivityIndicator, Image, ScrollView, Platform, StatusBar } from 'react-native';
import { theme } from '../theme';
import { VipAvatarRing } from '../components/VipRing';
import { VipName } from '../components/VipEffects';
import { supabase } from '../lib/supabase';
import { useLiveRefresh } from '../lib/liveSync';
import { Profile } from '../types';
import { offlineSync } from '../lib/offlineSync';
import { TableGameRanking } from '../components/TableGameRanking';
import { AnyTableGame, TABLE_GAMES } from '../lib/tableGames';
import { DominoRow, dominoStats, HofMatch, medal, rankStreaks, rankWinners, rankZapateros } from '../lib/hallOfFame';

interface LeaderboardScreenProps {
  onBack: () => void;
  currentUserProfileId: string;
  onOpenProfile: (profileId: string) => void;
}

type TabType = 'rich' | 'wins' | 'zapatos' | 'streaks';
type WinsGame = 'domino' | AnyTableGame;

const WIN_GAMES: { key: WinsGame; label: string }[] = [
  { key: 'domino', label: 'Dominó' },
  ...TABLE_GAMES.map((g) => ({ key: g.key as WinsGame, label: g.label.replace('UNO No Mercy', 'No Mercy') })),
  { key: 'poker', label: 'Póker' },
];

const TABS: { key: TabType; label: string; hint: string }[] = [
  { key: 'rich', label: '💰 Ricos', hint: 'Los que más puntos tienen ahora mismo.' },
  { key: 'wins', label: '🥇 Ganadores', hint: 'Elige el juego. Cuentan las partidas terminadas y confirmadas.' },
  { key: 'zapatos', label: '🥾 Zapateros', hint: 'Solo dominó: ganar 100 a 0.' },
  { key: 'streaks', label: '🔥 Rachas', hint: 'Días seguidos jugando. Sábado y domingo no rompen la racha.' },
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface HofRowProps {
  id: string;
  index: number;
  value: string;
  valueColor?: string;
  detail?: string;
  profile?: Profile;
  me: boolean;
  onOpen: (id: string) => void;
}

const HofRow: React.FC<HofRowProps> = ({ id, index, value, valueColor, detail, profile: p, me, onOpen }) => (
  <TouchableOpacity style={[styles.listItem, me && styles.listItemMe]} onPress={() => onOpen(id)} accessibilityRole="button">
    <Text style={[styles.rank, index < 3 && styles.rankMedal]}>{medal(index)}</Text>
    <View style={{ marginRight: 12 }}>
      <VipAvatarRing userId={id} size={40}>
        <View style={[styles.avatar, { marginRight: 0 }]}>
          {p?.avatar_url ? <Image source={{ uri: p.avatar_url }} style={styles.avatarImg} /> : <Text style={styles.avatarInitials}>{p?.initials || '?'}</Text>}
        </View>
      </VipAvatarRing>
    </View>
    <View style={{ flex: 1, minWidth: 0 }}>
      <VipName userId={id} style={styles.name}>{p?.display_name || 'Desconocido'}{me ? ' (tú)' : ''}</VipName>
      {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
    </View>
    <Text style={[styles.score, valueColor ? { color: valueColor } : null]}>{value}</Text>
  </TouchableOpacity>
);

export const LeaderboardScreen: React.FC<LeaderboardScreenProps> = ({ onBack, currentUserProfileId, onOpenProfile }) => {
  const [activeTab, setActiveTab] = useState<TabType>('rich');
  const [winsGame, setWinsGame] = useState<WinsGame>('domino');
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [domino, setDomino] = useState<DominoRow[]>([]);

  useEffect(() => {
    fetchLeaderboards();
  }, []);

  // A match that ends or a purchase elsewhere moves the rankings
  useLiveRefresh(() => fetchLeaderboards(true), { name: 'leaderboard', every: 30000 });

  const fetchLeaderboards = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [allProfiles, matches] = await Promise.all([
        offlineSync.getProfiles(offlineSync.getIsOnline()),
        (async () => {
          if (!offlineSync.getIsOnline()) {
            const cached = await offlineSync.getCachedMatches();
            return cached.filter((m: any) => m.status === 'completed');
          }
          const { data } = await supabase
            .from('matches')
            .select('status, winner_team, is_zapato, team1_player1, team1_player2, team2_player1, team2_player2, team1_total, team2_total, limit_score')
            .eq('status', 'completed');
          return data || [];
        })(),
      ]);
      setProfiles((allProfiles || []) as Profile[]);
      setDomino(dominoStats(matches as HofMatch[]));
    } catch (err) {
      console.log('Error fetching leaderboards:', err);
    } finally {
      setLoading(false);
    }
  };

  const byId: Record<string, Profile> = Object.fromEntries(profiles.map((p) => [p.id, p]));

  const row = (id: string, index: number, value: string, valueColor?: string, detail?: string) => (
    <HofRow key={id} id={id} index={index} value={value} valueColor={valueColor} detail={detail}
      profile={byId[id]} me={id === currentUserProfileId} onOpen={onOpenProfile} />
  );

  const empty = (text: string) => <Text style={styles.empty}>{text}</Text>;

  const renderRich = () => {
    const list = [...profiles].sort((a, b) => (b.betting_points || 0) - (a.betting_points || 0)).slice(0, 100);
    if (!list.length) return empty('Todavía no hay socios.');
    return list.map((p, i) => row(p.id, i, `${(p.betting_points || 0).toLocaleString('es-VE')} pts`));
  };

  const renderWins = () => {
    if (winsGame !== 'domino') {
      return (
        <View style={styles.tableRanking}>
          <TableGameRanking game={winsGame} from={null} currentUserProfileId={currentUserProfileId} medal={medal} onOpenProfile={onOpenProfile} />
        </View>
      );
    }
    const list = rankWinners(domino);
    if (!list.length) return empty('Todavía no hay partidas de dominó terminadas.');
    return list.map((r, i) => (
      row(r.id, i, plural(r.wins, 'victoria', 'victorias'), undefined, `${plural(r.played, 'partida', 'partidas')} · gana el ${r.winRate}%`)
    ));
  };

  const renderZapatos = () => {
    const list = rankZapateros(domino);
    if (!list.length) return empty('Nadie ha dado un zapato todavía.');
    return list.map((r, i) => (
      row(r.id, i, `${r.zapatos} 🥾`, theme.colors.danger, `de ${plural(r.wins, 'victoria', 'victorias')} en dominó`)
    ));
  };

  const renderStreaks = () => {
    const list = rankStreaks(profiles);
    if (!list.length) return empty('Nadie tiene una racha activa ahora mismo.');
    return list.map((p, i) => (
      row(p.id, i, `🔥 ${p.streak_count}`, theme.colors.accent, plural(p.streak_count || 0, 'día seguido jugando', 'días seguidos jugando'))
    ));
  };

  const tab = TABS.find((t) => t.key === activeTab)!;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Volver</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Salón de la Fama 🏆</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity key={t.key} style={[styles.tab, activeTab === t.key && styles.activeTab]} onPress={() => setActiveTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: activeTab === t.key }}>
            <Text style={[styles.tabText, activeTab === t.key && styles.activeTabText]} numberOfLines={1}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'wins' && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll} contentContainerStyle={styles.chips}>
          {WIN_GAMES.map((g) => (
            <TouchableOpacity key={g.key} style={[styles.chip, winsGame === g.key && styles.chipOn]} onPress={() => setWinsGame(g.key)} accessibilityRole="button" accessibilityState={{ selected: winsGame === g.key }}>
              <Text style={[styles.chipText, winsGame === g.key && styles.chipTextOn]}>{g.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      <Text style={styles.hint}>{tab.hint}</Text>

      {loading ? (
        <ActivityIndicator size="large" color={theme.colors.primary} style={{ marginTop: 50 }} />
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 32 }}>
          {activeTab === 'rich' && renderRich()}
          {activeTab === 'wins' && renderWins()}
          {activeTab === 'zapatos' && renderZapatos()}
          {activeTab === 'streaks' && renderStreaks()}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  backBtn: { padding: 8 },
  backBtnText: { color: theme.colors.primary, fontSize: 16 },
  title: { fontSize: 20, fontWeight: 'bold', color: theme.colors.text, flexShrink: 1, textAlign: 'center' },
  tabs: { flexDirection: 'row', paddingHorizontal: 8, marginBottom: 6 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderColor: 'transparent' },
  activeTab: { borderColor: theme.colors.primary },
  tabText: { color: theme.colors.textDim, fontSize: 13, fontWeight: 'bold' },
  activeTabText: { color: theme.colors.primary },
  chipsScroll: { flexGrow: 0 },
  chips: { paddingHorizontal: 16, paddingVertical: 6, gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.card },
  chipOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipText: { color: theme.colors.textDim, fontWeight: '800', fontSize: 13 },
  chipTextOn: { color: '#fff' },
  hint: { color: theme.colors.textDim, fontSize: 12, paddingHorizontal: 16, marginBottom: 10, marginTop: 2 },
  empty: { color: theme.colors.textDim, textAlign: 'center', fontStyle: 'italic', paddingVertical: 24 },
  tableRanking: { backgroundColor: theme.colors.card, borderRadius: 12, padding: 6 },
  list: { paddingHorizontal: 16 },
  listItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  listItemMe: { borderWidth: 1, borderColor: theme.colors.primary, backgroundColor: 'rgba(59,130,246,0.1)' },
  rankMedal: { fontSize: 22 },
  detail: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  rank: { width: 40, fontSize: 18, fontWeight: 'bold', color: theme.colors.textDim },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarImg: { width: 40, height: 40, borderRadius: 20 },
  avatarInitials: { color: '#fff', fontWeight: 'bold' },
  name: { fontSize: 16, color: theme.colors.text, fontWeight: 'bold' },
  score: { fontSize: 16, fontWeight: 'bold', color: theme.colors.primary },
});
