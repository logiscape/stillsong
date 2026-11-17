import { describe, expect, it } from 'vitest';
import { EDIT_PHASES, NODE_PHASES } from '@engine/comfy/graphBuilder';
import { HARVEST_PHASE, type JobProgress } from '@engine/index';
import { beyondStopping, mapEditStage, stopReady, STOP_GUARD_MS, type MapEditState } from '../mapEdit';

const at = (phase: string, extra: Partial<JobProgress> = {}): JobProgress => ({ jobId: 'j', songId: 's', phase, ...extra });

describe('what the Song map says while new notes are sung', () => {
  it('names each part of the work from the phase the studio reports', () => {
    expect(mapEditStage(undefined).label).toBe('Getting the studio ready');
    expect(mapEditStage(at('Clearing GPU (stopping the songwriter if running)')).label).toBe('Getting the studio ready');
    expect(mapEditStage(at(NODE_PHASES.ckpt)).label).toBe('Getting the studio ready');
    expect(mapEditStage(at(EDIT_PHASES.trying)).label).toBe('Trying a few takes of your notes');
    expect(mapEditStage(at(NODE_PHASES.perform)).label).toBe('Singing the take that fits best');
    expect(mapEditStage(at(NODE_PHASES.sample)).label).toBe('Recording the new version');
    for (const phase of [NODE_PHASES.decode, NODE_PHASES.save, HARVEST_PHASE]) expect(mapEditStage(at(phase)).label).toBe('Finishing');
  });

  it('shows how far the recording has got, and only then', () => {
    expect(mapEditStage(at(NODE_PHASES.sample, { stepNode: 'sample', stepValue: 8, stepMax: 32 })).fraction).toBe(0.25);
    expect(mapEditStage(at(NODE_PHASES.sample)).fraction).toBeUndefined();
    expect(mapEditStage(at(EDIT_PHASES.trying, { stepNode: 'perform', stepValue: 40, stepMax: 84 })).fraction).toBeUndefined();
  });

  it('never uses the studio\'s own words', () => {
    const phases = [...Object.values(NODE_PHASES), ...Object.values(EDIT_PHASES), 'Downloading song', 'Waiting for ComfyUI', ''];
    for (const phase of phases) expect(mapEditStage(at(phase)).label).not.toMatch(/render|GPU|model|ComfyUI|prompt|generat/i);
  });
});

describe('Stop, which appears where "Sing the new notes" was', () => {
  const edit = (over: Partial<MapEditState> = {}): MapEditState => ({ sourceId: 'a', songId: 'b', taken: true, abc: 'plan', since: 10_000, ...over });

  it('waits out a double-click', () => {
    expect(STOP_GUARD_MS).toBeGreaterThanOrEqual(500); // the longest double-click Windows counts by default
    expect(stopReady(edit(), 10_000)).toBe(false);
    expect(stopReady(edit(), 10_000 + STOP_GUARD_MS - 1)).toBe(false);
    expect(stopReady(edit(), 10_000 + STOP_GUARD_MS)).toBe(true);
  });

  it('waits for the studio to have taken the request, however long that is', () => {
    expect(stopReady(edit({ songId: '', taken: false }), 60_000)).toBe(false);
    // "Try again" knows its song from the start, but there is no job to stop until the studio takes it again.
    expect(stopReady(edit({ songId: 'b', taken: false }), 60_000)).toBe(false);
  });

  it('is not offered once the new version is being copied into the library', () => {
    for (const phase of [NODE_PHASES.sample, NODE_PHASES.decode, NODE_PHASES.save]) {
      expect(beyondStopping(at(phase)), phase).toBe(false);
      expect(stopReady(edit({ progress: at(phase) }), 60_000), phase).toBe(true);
    }
    expect(beyondStopping(at(HARVEST_PHASE))).toBe(true);
    expect(stopReady(edit({ progress: at(HARVEST_PHASE) }), 60_000)).toBe(false);
    expect(beyondStopping(undefined)).toBe(false);
  });

  it('has nothing to stop once the request has failed', () => {
    expect(stopReady(edit({ error: 'no' }), 60_000)).toBe(false);
  });
});
