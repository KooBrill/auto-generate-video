import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

// Semua isi video masuk lewat props, jadi satu template bisa dipakai untuk banyak video.
export type VideoProps = {
  title: string;
  subtitle?: string;
  points: string[];
  cta?: string;
  accent?: string;
  backgroundFrom?: string;
  backgroundTo?: string;
  /** Nama file musik di folder public/, contoh: "music.mp3". Kosongkan untuk video tanpa suara. */
  audioSrc?: string;
};

export const FPS = 30;
export const INTRO_FRAMES = 3 * FPS;
export const POINT_FRAMES = 4 * FPS;
export const OUTRO_FRAMES = 3 * FPS;

export const defaultProps: VideoProps = {
  title: '3 Kebiasaan Kecil yang Mengubah Harimu',
  subtitle: 'Mulai hari ini',
  points: [
    'Bangun 30 menit lebih awal dan jangan buka HP dulu.',
    'Tulis 3 prioritas sebelum mulai kerja.',
    'Jalan kaki 10 menit setiap selesai makan siang.',
  ],
  cta: 'Follow untuk tips harian',
  accent: '#FFD166',
  backgroundFrom: '#1B1F3B',
  backgroundTo: '#6A2C70',
};

export const totalFrames = (p: VideoProps): number =>
  INTRO_FRAMES + p.points.length * POINT_FRAMES + OUTRO_FRAMES;

const FONT = "'Liberation Sans', 'Noto Sans', Arial, sans-serif";

// Area aman: UI Shorts/Reels menutupi bagian bawah dan sisi kanan layar.
const SAFE_PADDING = '0 90px 260px 80px';

const useSceneFade = (duration: number): number => {
  const frame = useCurrentFrame();
  return interpolate(frame, [duration - 10, duration], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

const Pop: React.FC<{
  delay?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ delay = 0, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: { damping: 200 },
  });
  return (
    <div
      style={{
        opacity: progress,
        transform: `translateY(${(1 - progress) * 60}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

const Intro: React.FC<{ title: string; subtitle?: string; accent: string }> = ({
  title,
  subtitle,
  accent,
}) => {
  const fade = useSceneFade(INTRO_FRAMES);
  const size = title.length > 50 ? 84 : title.length > 28 ? 100 : 118;
  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', padding: SAFE_PADDING, opacity: fade }}
    >
      {subtitle ? (
        <Pop>
          <div
            style={{
              fontSize: 46,
              letterSpacing: 6,
              textTransform: 'uppercase',
              color: accent,
              fontWeight: 700,
              marginBottom: 36,
            }}
          >
            {subtitle}
          </div>
        </Pop>
      ) : null}
      <Pop delay={8}>
        <div style={{ fontSize: size, lineHeight: 1.1, fontWeight: 800, color: '#fff' }}>
          {title}
        </div>
      </Pop>
    </AbsoluteFill>
  );
};

const PointScene: React.FC<{
  index: number;
  total: number;
  text: string;
  accent: string;
}> = ({ index, total, text, accent }) => {
  const fade = useSceneFade(POINT_FRAMES);
  const size = text.length > 90 ? 58 : text.length > 55 ? 68 : 80;
  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', padding: SAFE_PADDING, opacity: fade }}
    >
      <Pop>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 150,
            height: 150,
            borderRadius: 75,
            background: accent,
            color: '#1B1F3B',
            fontSize: 84,
            fontWeight: 800,
            marginBottom: 56,
          }}
        >
          {index + 1}
        </div>
        <div style={{ fontSize: 34, color: accent, fontWeight: 700, marginBottom: 24 }}>
          {index + 1} / {total}
        </div>
      </Pop>
      <Pop delay={10}>
        <div style={{ fontSize: size, lineHeight: 1.2, fontWeight: 700, color: '#fff' }}>
          {text}
        </div>
      </Pop>
    </AbsoluteFill>
  );
};

const Outro: React.FC<{ cta: string; accent: string }> = ({ cta, accent }) => {
  const fade = useSceneFade(OUTRO_FRAMES);
  return (
    <AbsoluteFill
      style={{ justifyContent: 'center', padding: SAFE_PADDING, opacity: fade }}
    >
      <Pop>
        <div style={{ fontSize: 96, lineHeight: 1.15, fontWeight: 800, color: accent }}>
          {cta}
        </div>
      </Pop>
    </AbsoluteFill>
  );
};

export const VerticalVideo: React.FC<VideoProps> = (props) => {
  const accent = props.accent ?? '#FFD166';
  const from = props.backgroundFrom ?? '#1B1F3B';
  const to = props.backgroundTo ?? '#6A2C70';
  const frame = useCurrentFrame();
  const total = totalFrames(props);
  const progress = interpolate(frame, [0, total], [0, 100], {
    extrapolateRight: 'clamp',
  });
  const outroStart = INTRO_FRAMES + props.points.length * POINT_FRAMES;

  return (
    <AbsoluteFill
      style={{ background: `linear-gradient(160deg, ${from}, ${to})`, fontFamily: FONT }}
    >
      {props.audioSrc ? <Audio src={staticFile(props.audioSrc)} /> : null}

      <Sequence durationInFrames={INTRO_FRAMES}>
        <Intro title={props.title} subtitle={props.subtitle} accent={accent} />
      </Sequence>

      {props.points.map((text, i) => (
        <Sequence
          key={i}
          from={INTRO_FRAMES + i * POINT_FRAMES}
          durationInFrames={POINT_FRAMES}
        >
          <PointScene
            index={i}
            total={props.points.length}
            text={text}
            accent={accent}
          />
        </Sequence>
      ))}

      <Sequence from={outroStart} durationInFrames={OUTRO_FRAMES}>
        <Outro cta={props.cta ?? 'Follow untuk konten lainnya'} accent={accent} />
      </Sequence>

      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          height: 12,
          width: `${progress}%`,
          background: accent,
        }}
      />
    </AbsoluteFill>
  );
};
