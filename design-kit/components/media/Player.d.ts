/**
 * The always-visible transport in the Song view. Elapsed / total, seek, volume — nothing else.
 * @startingPoint section="Song view" subtitle="Glass transport with seek and volume" viewport="700x120"
 */
export interface PlayerProps {
  playing?: boolean;
  /** Seconds elapsed. */
  position?: number;
  /** Seconds total (actual_sec). */
  duration?: number;
  /** 0..1 */
  volume?: number;
  onToggle?: () => void;
  onSeek?: (seconds: number) => void;
  onVolume?: (level: number) => void;
  /** glass = over a photo (default); matte = on the app ground. */
  variant?: "glass" | "matte";
  style?: React.CSSProperties;
}
export function Player(props: PlayerProps): JSX.Element;
