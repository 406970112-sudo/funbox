import { View } from 'react-native';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { buildMarketChartPoints } from '@/lib/market-radar';

type MarketSparklineProps = {
  color: string;
  values: readonly number[];
};

type MarketTrendChartProps = {
  color: string;
  gridColor: string;
  values: readonly number[];
};

export function MarketSparkline({ color, values }: MarketSparklineProps) {
  const width = 78;
  const height = 28;
  const points = buildMarketChartPoints(values, width, height);

  return (
    <Svg
      accessibilityLabel="板块走势缩略图"
      height={height}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}>
      <Polyline
        fill="none"
        points={points.map((point) => `${point.x},${point.y}`).join(' ')}
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.4}
      />
    </Svg>
  );
}

export function MarketTrendChart({ color, gridColor, values }: MarketTrendChartProps) {
  const width = 354;
  const height = 126;
  const chartPadding = 8;
  const points = buildMarketChartPoints(
    values,
    width - chartPadding * 2,
    height - chartPadding * 2,
  ).map((point) => ({ x: point.x + chartPadding, y: point.y + chartPadding }));
  const finalPoint = points.at(-1);

  return (
    <View style={{ height: 126, width: '100%' }}>
      <Svg
        accessibilityLabel="板块相对强弱折线图"
        height="100%"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        width="100%">
        {[24, 63, 102].map((y) => (
          <Line key={y} stroke={gridColor} strokeWidth={1} x1={0} x2={width} y1={y} y2={y} />
        ))}
        <Polyline
          fill="none"
          points={points.map((point) => `${point.x},${point.y}`).join(' ')}
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.6}
        />
        {finalPoint ? <Circle cx={finalPoint.x} cy={finalPoint.y} fill={color} r={5} /> : null}
      </Svg>
    </View>
  );
}
