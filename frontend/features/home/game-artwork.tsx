import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';

import { getGameArtworkKind } from './game-artwork-kind';

type GameArtworkProps = {
  accentColor: string;
  contrastColor: string;
  gameId: string;
  mutedColor: string;
};

type SceneProps = Omit<GameArtworkProps, 'gameId'>;

function SnakeScene({ accentColor }: SceneProps) {
  return (
    <G>
      <Path
        d="M8 36h14a7 7 0 0 0 7-7V19a8 8 0 0 1 8-8h8"
        fill="none"
        stroke={accentColor}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={8}
      />
      <Circle cx={45} cy={11} fill={accentColor} r={5} />
      <Circle cx={47} cy={9} fill="#ffffff" r={1.4} />
      <Circle cx={55} cy={34} fill="#ff5d68" r={5} />
      <Path
        d="M55 28c1-3 4-4 6-3"
        fill="none"
        stroke="#317d55"
        strokeLinecap="round"
        strokeWidth={2}
      />
      <Circle cx={8} cy={36} fill={accentColor} opacity={0.58} r={4} />
    </G>
  );
}

function GomokuScene({ accentColor }: SceneProps) {
  return (
    <G>
      <G opacity={0.58} stroke={accentColor} strokeWidth={1.5}>
        <Line x1={14} x2={14} y1={8} y2={40} />
        <Line x1={26} x2={26} y1={8} y2={40} />
        <Line x1={38} x2={38} y1={8} y2={40} />
        <Line x1={50} x2={50} y1={8} y2={40} />
        <Line x1={10} x2={54} y1={12} y2={12} />
        <Line x1={10} x2={54} y1={24} y2={24} />
        <Line x1={10} x2={54} y1={36} y2={36} />
      </G>
      <G fill="#26303f" stroke="#ffffff" strokeOpacity={0.2} strokeWidth={1}>
        <Circle cx={14} cy={36} r={5} />
        <Circle cx={26} cy={24} r={5} />
        <Circle cx={38} cy={12} r={5} />
      </G>
      <G fill="#ffffff" stroke={accentColor} strokeWidth={1.5}>
        <Circle cx={38} cy={36} r={5} />
        <Circle cx={50} cy={24} r={5} />
      </G>
    </G>
  );
}

function TetrisScene({ accentColor }: SceneProps) {
  return (
    <G>
      <G stroke="#ffffff" strokeOpacity={0.82} strokeWidth={1}>
        <Path
          d="M7 28h9v9H7zM16 28h9v9h-9zM25 28h9v9h-9zM34 28h9v9h-9zM43 28h9v9h-9z"
          fill={accentColor}
        />
        <Path d="M7 19h9v9H7zM16 19h9v9h-9zM34 19h9v9h-9zM43 19h9v9h-9z" fill="#26c69a" />
        <Path d="M28 5h9v9h-9zM37 5h9v9h-9zM37 14h9v9h-9zM46 14h9v9h-9z" fill="#ffb44c" />
      </G>
      <Line
        opacity={0.52}
        stroke={accentColor}
        strokeDasharray="2 2"
        strokeWidth={2}
        x1={28}
        x2={56}
        y1={25}
        y2={25}
      />
    </G>
  );
}

function BrickBreakerScene({ accentColor, contrastColor, mutedColor }: SceneProps) {
  return (
    <G>
      <G fill={accentColor}>
        <Rect height={7} rx={2} width={13} x={8} y={7} />
        <Rect height={7} rx={2} width={13} x={24} y={7} />
        <Rect height={7} rx={2} width={13} x={40} y={7} />
        <Rect height={7} rx={2} width={13} x={16} y={17} />
        <Rect height={7} rx={2} width={13} x={32} y={17} />
      </G>
      <Path
        d="M45 35 34 25 23 36"
        fill="none"
        opacity={0.72}
        stroke={mutedColor}
        strokeDasharray="2 2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
      />
      <Circle cx={34} cy={25} fill="#ffffff" r={4} stroke={accentColor} strokeWidth={2} />
      <Rect fill={contrastColor} height={5} rx={2.5} width={28} x={17} y={36} />
      <Path
        d="m47 16 5 5m0-5-5 5"
        fill="none"
        stroke="#ffffff"
        strokeLinecap="round"
        strokeWidth={2}
      />
    </G>
  );
}

function FallbackScene({ contrastColor, mutedColor }: SceneProps) {
  return (
    <G fill="none" stroke={mutedColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
      <Path d="M18 17h28c6 0 10 4 10 10v5c0 5-4 8-8 8-3 0-6-2-8-6H24c-2 4-5 6-8 6-4 0-8-3-8-8v-5c0-6 4-10 10-10Z" />
      <Line x1={17} x2={25} y1={27} y2={27} />
      <Line x1={21} x2={21} y1={23} y2={31} />
      <Circle cx={43} cy={26} fill={contrastColor} r={2} stroke="none" />
      <Circle cx={49} cy={31} fill={contrastColor} r={2} stroke="none" />
    </G>
  );
}

export function GameArtwork({ accentColor, contrastColor, gameId, mutedColor }: GameArtworkProps) {
  const kind = getGameArtworkKind(gameId);
  const sceneProps = { accentColor, contrastColor, mutedColor };

  return (
    <Svg height="100%" viewBox="0 0 64 48" width="100%">
      {kind === 'snake' ? <SnakeScene {...sceneProps} /> : null}
      {kind === 'gomoku' ? <GomokuScene {...sceneProps} /> : null}
      {kind === 'tetris' ? <TetrisScene {...sceneProps} /> : null}
      {kind === 'brick-breaker' ? <BrickBreakerScene {...sceneProps} /> : null}
      {kind === 'fallback' ? <FallbackScene {...sceneProps} /> : null}
    </Svg>
  );
}
