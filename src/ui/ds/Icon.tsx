import React from 'react';
import { ICONS } from './icons';

export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: number;
  color?: string;
  title?: string;
}

/* Lucide geometry loaded as a CSS mask so it inherits currentColor.
   No hand-drawn paths anywhere in this design system. */
export function Icon({ name, size = 18, color = 'currentColor', style, title, ...rest }: IconProps): React.ReactElement {
  const url = `url("${ICONS[name] ?? ''}")`;
  return (
    <span
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{
        display: 'inline-block', flex: '0 0 auto', width: size, height: size, background: color,
        WebkitMaskImage: url, maskImage: url, WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center', maskPosition: 'center', WebkitMaskSize: 'contain', maskSize: 'contain', ...style,
      }}
      {...rest}
    />
  );
}
