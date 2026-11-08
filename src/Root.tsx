import React from 'react';
import { CalculateMetadataFunction, Composition } from 'remotion';
import {
  FPS,
  VerticalVideo,
  VideoProps,
  defaultProps,
  totalFrames,
} from './VerticalVideo';

// Durasi video dihitung dari props: makin banyak poin, makin panjang videonya.
const calculateMetadata: CalculateMetadataFunction<VideoProps> = ({ props }) => ({
  durationInFrames: totalFrames(props),
});

export const RemotionRoot: React.FC = () => (
  <Composition
    id="VerticalVideo"
    component={VerticalVideo}
    width={1080}
    height={1920}
    fps={FPS}
    durationInFrames={totalFrames(defaultProps)}
    defaultProps={defaultProps}
    calculateMetadata={calculateMetadata}
  />
);
