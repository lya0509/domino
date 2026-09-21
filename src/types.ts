export type GameMode = 'teams' | 'individual';

export interface Profile {
  id: string;
  display_name: string;
  initials: string;
  avatar_url?: string;
  created_at?: string;
  betting_points?: number;
  last_daily_bonus_at?: string;
  streak_count?: number;
  last_streak_update_at?: string;
  inventory?: string[];
  achievements?: string[];
  equipped_items?: {
    color?: string;
    border?: string;
    title?: string;
    table_color?: string;
  };
  is_admin?: boolean;
}

export interface Player {
  id: string;
  name: string;
  initials: string;
  teamNumber?: 1 | 2;
  profileId?: string; // UUID from Supabase profiles table
  order?: number; // Seating order (0 to 3) where 0 is the one who started
}

export interface Round {
  id: string;
  roundNumber: number;
  scorerId: string; // In 'teams', this is 'team1' or 'team2'. In 'individual', it's the player id.
  points: number;
  endingType: 'normal' | 'trancado';
}

export interface Substitution {
  originalId: string;
  originalProfileId?: string;
  subName: string;
  subInitials: string;
  subProfileId?: string;
  teamScoreAtSub: number;
}

export interface Match {
  id: string;
  gameMode: GameMode;
  limitScore: number;
  players: Player[];
  rounds: Round[];
  status: 'active' | 'completed';
  isGuestMode?: boolean;
  substitutions?: Substitution[];
  wager_amount?: number;
  is_wager_match?: boolean;
  tournament_id?: string;
  created_by?: string;
}

export interface Tournament {
  id: string;
  name: string;
  entry_fee: number;
  entry_points: number;
  prize_pool: number;
  max_participants: number;
  status: 'registration' | 'in_progress' | 'completed' | 'cancelled';
  tournament_type: 'vip_cash' | 'brackets' | 'leaderboard';
  created_by: string;
  created_at: string;
}

export interface TournamentParticipant {
  id: string;
  tournament_id: string;
  user_id: string;
  partner_id?: string;
  partner_status?: 'pending' | 'sent' | 'confirmed';
  team_name?: string;
  payment_status: 'pending' | 'approved' | 'rejected';
  payment_reference?: string;
  payment_receipt_url?: string;
  payout_details?: string;
  created_at?: string;
  profiles?: Profile; // Para joins
  partner?: Profile; // Para joins
}

export interface TournamentBracket {
  id: string;
  tournament_id: string;
  round_number: number;
  match_number: number;
  team1_player1?: string;
  team1_player2?: string;
  team2_player1?: string;
  team2_player2?: string;
  winner_team?: 1 | 2;
  next_match_id?: string;
  created_at?: string;
  live_match_id?: string;
}

export type BracketMatch = TournamentBracket;

export interface PlayerStats {
  id: string;
  display_name: string;
  initials: string;
  total_matches: number;
  wins: number;
  losses: number;
  zapatos_given: number;
  zapatos_received: number;
  medals?: string[];
}

export interface DuoStats {
  player1: Profile;
  player2: Profile;
  wins: number;
  totalMatches: number;
}
