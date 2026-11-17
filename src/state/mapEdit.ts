// A melody edit asked for from the Song map: the map stays on screen while the
// studio sings, so this is what it shows in place of the Create screen's stages.

import { EDIT_PHASES } from '@engine/comfy/graphBuilder';
import { HARVEST_PHASE, type JobProgress } from '@engine/index';

/** New bars asked for: the studio writes them, in the manner of the part, to follow this phrase of the song. */
export interface MorePhrase {
  phrase: number;
}

export interface MapEditState {
  /** The song whose notes were moved. */
  sourceId: string;
  /** The new version being sung; empty until the studio has taken the request. */
  songId: string;
  /**
   * The studio has taken the request: there is a job to stop. Not the same as
   * having a song: "Try again" knows its song from the start, and has no job
   * until the studio takes it again.
   */
  taken: boolean;
  /** The plan that was sent: the map shows these notes again when someone leaves it and comes back. */
  abc: string;
  /** Set when the edit makes the song longer: the phrase the new bars follow. */
  longer?: MorePhrase;
  /** When it was asked for (or asked for again), in milliseconds. */
  since: number;
  /** The studio's latest word on it. */
  progress?: JobProgress;
  /** Why it stopped, in plain words. The draft is still on the map. */
  error?: string;
}

/**
 * "Sing the new notes" turns into "Stop" where it stands, so the second click
 * of a double-click would land on Stop. For this long after asking, Stop does
 * nothing.
 */
export const STOP_GUARD_MS = 1000;

/**
 * The studio's work is over and the new version is being copied into the
 * library. Nothing is left to stop: it is saved, and can be deleted like any
 * other version (the user's choice, 2026-11-16).
 */
export function beyondStopping(progress: JobProgress | undefined): boolean {
  return progress?.phase === HARVEST_PHASE;
}

/** Whether Stop can act: the studio has taken the request and can still be stopped, and the click that asked for it is well past. */
export function stopReady(edit: MapEditState, now: number): boolean {
  return edit.taken && !edit.error && !beyondStopping(edit.progress) && now - edit.since >= STOP_GUARD_MS;
}

export interface MapEditStage {
  label: string;
  /** 0..1 while the studio reports how far along it is; otherwise the bar just moves. */
  fraction?: number;
}

/**
 * What the studio is doing, from the phase it last reported (see NODE_PHASES
 * and EDIT_PHASES). `longer`: the edit adds bars, where the other kind has
 * notes sung again.
 */
export function mapEditStage(progress: JobProgress | undefined, longer = false): MapEditStage {
  const phase = progress?.phase ?? '';
  if (phase === EDIT_PHASES.writing) return { label: 'Writing new bars for this part' };
  if (phase.startsWith('Composing (trying')) return { label: longer ? 'Trying a few takes of the new bars' : 'Trying a few takes of your notes' };
  if (phase.startsWith('Composing')) return { label: longer ? 'Performing the take that joins best' : 'Singing the take that fits best' };
  if (phase.startsWith('Rendering')) {
    const known = progress?.stepNode === 'sample' && progress.stepValue != null && !!progress.stepMax;
    return { label: 'Recording the new version', fraction: known ? Math.min(1, progress!.stepValue! / progress!.stepMax!) : undefined };
  }
  if (phase.startsWith('Decoding') || phase.startsWith('Saving') || phase.startsWith('Downloading')) return { label: 'Finishing' };
  return { label: 'Getting the studio ready' };
}
