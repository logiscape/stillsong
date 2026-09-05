import React from 'react';

export interface PhotoRoomProps {
  photo: string;
  luminance?: number;
  scrim?: 'radial' | 'vertical' | 'none';
  kenBurns?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

/** The photo as the room: full-bleed cover, luminance-aware scrim, Ken Burns. */
export function PhotoRoom({ photo, luminance = 0.5, scrim = 'radial', kenBurns = true, children, style }: PhotoRoomProps): React.ReactElement {
  const bg = scrim === 'vertical' ? 'var(--scrim-vertical)' : scrim === 'none' ? 'none' : 'var(--scrim-radial)';
  return (
    <div style={{
      position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--ground-deep)',
      ['--photo-lum' as never]: String(luminance), ...style,
    }}>
      <img src={photo} alt="" style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
        animation: kenBurns ? 'ss-kenburns var(--dur-kenburns) var(--ease-in-out) infinite alternate' : 'none',
      }} />
      <div style={{ position: 'absolute', inset: 0, background: bg, pointerEvents: 'none' }} />
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>{children}</div>
    </div>
  );
}
