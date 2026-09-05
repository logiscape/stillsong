// The app's whole icon vocabulary, vendored from lucide-static at build time
// (the production CSP allows no CDN). Add names here, never hand-drawn paths.
// The two ./icons/*-filled.svg files are first-party: lucide draws every
// shape as an outline, and the filled shape tools need solid silhouettes.

import audioLines from 'lucide-static/icons/audio-lines.svg?url';
import check from 'lucide-static/icons/check.svg?url';
import chevronDown from 'lucide-static/icons/chevron-down.svg?url';
import chevronLeft from 'lucide-static/icons/chevron-left.svg?url';
import chevronRight from 'lucide-static/icons/chevron-right.svg?url';
import clock from 'lucide-static/icons/clock.svg?url';
import dices from 'lucide-static/icons/dices.svg?url';
import disc from 'lucide-static/icons/disc.svg?url';
import disc3 from 'lucide-static/icons/disc-3.svg?url';
import circle from 'lucide-static/icons/circle.svg?url';
import circleFilled from './icons/circle-filled.svg?url';
import download from 'lucide-static/icons/download.svg?url';
import ellipsis from 'lucide-static/icons/ellipsis.svg?url';
import eraser from 'lucide-static/icons/eraser.svg?url';
import folderOpen from 'lucide-static/icons/folder-open.svg?url';
import imagePlus from 'lucide-static/icons/image-plus.svg?url';
import info from 'lucide-static/icons/info.svg?url';
import layers from 'lucide-static/icons/layers.svg?url';
import layoutGrid from 'lucide-static/icons/layout-grid.svg?url';
import lock from 'lucide-static/icons/lock.svg?url';
import mic from 'lucide-static/icons/mic.svg?url';
import music from 'lucide-static/icons/music.svg?url';
import paintBucket from 'lucide-static/icons/paint-bucket.svg?url';
import paintbrush from 'lucide-static/icons/paintbrush.svg?url';
import palette from 'lucide-static/icons/palette.svg?url';
import pause from 'lucide-static/icons/pause.svg?url';
import penLine from 'lucide-static/icons/pen-line.svg?url';
import pencil from 'lucide-static/icons/pencil.svg?url';
import pencilLine from 'lucide-static/icons/pencil-line.svg?url';
import pipette from 'lucide-static/icons/pipette.svg?url';
import play from 'lucide-static/icons/play.svg?url';
import redo2 from 'lucide-static/icons/redo-2.svg?url';
import slash from 'lucide-static/icons/slash.svg?url';
import square from 'lucide-static/icons/square.svg?url';
import squareFilled from './icons/square-filled.svg?url';
import scrollText from 'lucide-static/icons/scroll-text.svg?url';
import search from 'lucide-static/icons/search.svg?url';
import settings from 'lucide-static/icons/settings.svg?url';
import shuffle from 'lucide-static/icons/shuffle.svg?url';
import triangleAlert from 'lucide-static/icons/triangle-alert.svg?url';
import trash2 from 'lucide-static/icons/trash-2.svg?url';
import undo2 from 'lucide-static/icons/undo-2.svg?url';
import volume2 from 'lucide-static/icons/volume-2.svg?url';
import volumeX from 'lucide-static/icons/volume-x.svg?url';
import wandSparkles from 'lucide-static/icons/wand-sparkles.svg?url';
import x from 'lucide-static/icons/x.svg?url';

export const ICONS: Record<string, string> = {
  'audio-lines': audioLines,
  check,
  'chevron-down': chevronDown,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  circle,
  'circle-filled': circleFilled,
  clock,
  dices,
  disc,
  'disc-3': disc3,
  download,
  ellipsis,
  eraser,
  'folder-open': folderOpen,
  'image-plus': imagePlus,
  info,
  layers,
  'layout-grid': layoutGrid,
  lock,
  mic,
  music,
  'paint-bucket': paintBucket,
  paintbrush,
  palette,
  pause,
  'pen-line': penLine,
  pencil,
  'pencil-line': pencilLine,
  pipette,
  play,
  'redo-2': redo2,
  slash,
  square,
  'square-filled': squareFilled,
  'scroll-text': scrollText,
  search,
  settings,
  shuffle,
  'triangle-alert': triangleAlert,
  'trash-2': trash2,
  'undo-2': undo2,
  'volume-2': volume2,
  'volume-x': volumeX,
  'wand-sparkles': wandSparkles,
  x,
};

export type IconName = keyof typeof ICONS & string;
