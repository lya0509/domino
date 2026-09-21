import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Polyline, Circle, Text as SvgText, Line, Defs, LinearGradient, Stop } from 'react-native-svg';
import { theme } from '../theme';

interface Round {
  scorerId: string;
  points: number;
}

interface Props {
  rounds: Round[];
  limitScore: number;
}

export const MatchGraph: React.FC<Props> = ({ rounds, limitScore }) => {
  if (!rounds || rounds.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No hay datos para graficar.</Text>
      </View>
    );
  }

  const { width } = Dimensions.get('window');
  const graphWidth = width - theme.spacing.l * 4; // Padding
  const graphHeight = 150;
  
  const paddingTop = 20;
  const paddingBottom = 20;
  const paddingLeft = 30;
  const paddingRight = 10;
  
  const innerWidth = graphWidth - paddingLeft - paddingRight;
  const innerHeight = graphHeight - paddingTop - paddingBottom;

  // Calculate cumulative scores
  let team1Score = 0;
  let team2Score = 0;
  
  const points = [{ t1: 0, t2: 0 }];
  
  rounds.forEach((r) => {
    if (r.scorerId === 'team1') {
      team1Score += r.points;
    } else if (r.scorerId === 'team2') {
      team2Score += r.points;
    }
    points.push({ t1: team1Score, t2: team2Score });
  });

  const maxRounds = points.length - 1;
  const maxScore = Math.max(limitScore, team1Score, team2Score, 1);

  // Map to SVG coordinates
  const getX = (index: number) => paddingLeft + (maxRounds === 0 ? 0 : (index / maxRounds) * innerWidth);
  const getY = (score: number) => paddingTop + innerHeight - ((score / maxScore) * innerHeight);

  const t1PointsStr = points.map((p, i) => `${getX(i)},${getY(p.t1)}`).join(' ');
  const t2PointsStr = points.map((p, i) => `${getX(i)},${getY(p.t2)}`).join(' ');

  return (
    <View style={styles.container}>
      <Svg width={graphWidth} height={graphHeight}>
        <Defs>
          <LinearGradient id="gridGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity="0.1" />
            <Stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </LinearGradient>
        </Defs>

        {/* Y Axis Grid Lines */}
        {[0, 0.5, 1].map((ratio) => {
          const y = paddingTop + innerHeight - (ratio * innerHeight);
          const score = Math.round(ratio * maxScore);
          return (
            <React.Fragment key={`grid-${ratio}`}>
              <Line x1={paddingLeft} y1={y} x2={graphWidth - paddingRight} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
              <SvgText x={paddingLeft - 5} y={y + 4} fill={theme.colors.textDim} fontSize="10" textAnchor="end">
                {score}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Team 1 Line */}
        <Polyline points={t1PointsStr} fill="none" stroke={theme.colors.primary} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        
        {/* Team 2 Line */}
        <Polyline points={t2PointsStr} fill="none" stroke={theme.colors.secondary} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        {/* Dots */}
        {points.map((p, i) => (
          <React.Fragment key={`dot-${i}`}>
            <Circle cx={getX(i)} cy={getY(p.t1)} r="3" fill={theme.colors.primary} />
            <Circle cx={getX(i)} cy={getY(p.t2)} r="3" fill={theme.colors.secondary} />
          </React.Fragment>
        ))}
      </Svg>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: theme.colors.primary }]} />
          <Text style={styles.legendText}>Equipo 1</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: theme.colors.secondary }]} />
          <Text style={styles.legendText}>Equipo 2</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: theme.borderRadius.m,
    padding: theme.spacing.m,
    marginTop: theme.spacing.m,
  },
  emptyContainer: {
    padding: theme.spacing.l,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontStyle: 'italic',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendColor: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    color: theme.colors.textDim,
    fontSize: 11,
  },
});
