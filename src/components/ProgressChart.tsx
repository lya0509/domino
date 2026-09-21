import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, { Polyline, Circle } from 'react-native-svg';
import { theme } from '../theme';
import { Round } from '../types';

interface ProgressChartProps {
  rounds: Round[];
  limitScore: number;
  team1Color?: string;
  team2Color?: string;
}

export const ProgressChart: React.FC<ProgressChartProps> = ({ 
  rounds, 
  limitScore, 
  team1Color = theme.colors.primary, 
  team2Color = theme.colors.secondary 
}) => {
  // Dimensiones del gráfico
  const width = Dimensions.get('window').width - 64; // margen
  const height = 150;
  const padding = 10;

  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  // Calculamos los puntos acumulados en el tiempo
  let t1Total = 0;
  let t2Total = 0;

  const dataT1: {x: number, y: number}[] = [{ x: 0, y: 0 }];
  const dataT2: {x: number, y: number}[] = [{ x: 0, y: 0 }];

  rounds.forEach((r, i) => {
    if (r.scorerId === 'team1') t1Total += r.points;
    if (r.scorerId === 'team2') t2Total += r.points;
    
    dataT1.push({ x: i + 1, y: t1Total });
    dataT2.push({ x: i + 1, y: t2Total });
  });

  const maxX = Math.max(rounds.length, 1);
  const maxY = limitScore; // Siempre llegar a la meta visualmente

  // Transformar coordenadas (x, y) a pixeles del SVG
  const getCoords = (data: {x: number, y: number}[]) => {
    return data.map(pt => {
      const px = padding + (pt.x / maxX) * chartWidth;
      // y=0 está arriba en SVG, así que invertimos
      const py = padding + chartHeight - (Math.min(pt.y, maxY) / maxY) * chartHeight;
      return `${px},${py}`;
    }).join(' ');
  };

  const getPoints = (data: {x: number, y: number}[]) => {
    return data.map(pt => ({
      cx: padding + (pt.x / maxX) * chartWidth,
      cy: padding + chartHeight - (Math.min(pt.y, maxY) / maxY) * chartHeight
    }));
  };

  return (
    <View style={styles.container}>
      <Svg width={width} height={height}>
        {/* Línea Meta */}
        <Polyline points={`${padding},${padding} ${width-padding},${padding}`} fill="none" stroke={theme.colors.cardBorder} strokeWidth="1" strokeDasharray="5,5" />
        
        {/* Línea Team 1 */}
        <Polyline points={getCoords(dataT1)} fill="none" stroke={team1Color} strokeWidth="3" />
        {getPoints(dataT1).map((pt, i) => (
          <Circle key={`t1-${i}`} cx={pt.cx} cy={pt.cy} r="4" fill={team1Color} />
        ))}

        {/* Línea Team 2 */}
        <Polyline points={getCoords(dataT2)} fill="none" stroke={team2Color} strokeWidth="3" />
        {getPoints(dataT2).map((pt, i) => (
          <Circle key={`t2-${i}`} cx={pt.cx} cy={pt.cy} r="4" fill={team2Color} />
        ))}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.m,
    borderWidth: 1,
    borderColor: theme.colors.cardBorder,
    paddingVertical: 10,
    alignItems: 'center',
    marginVertical: 16
  }
});
