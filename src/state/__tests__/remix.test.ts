import { describe, expect, it } from 'vitest';
import { defaultSpec, type Song, type SongSpec } from '@engine/domain/types';
import { canKeepMelody, offersMelodyChoice, remixNeedsNewSeed, remixTake } from '../remix';

const PLAN = 'X:1\nV: Vocal\n% verse\n|: C D E F :|';

function song(over: Partial<Song> = {}, spec: Partial<SongSpec> = {}): Song {
  return {
    id: 'orig',
    createdAt: 0,
    status: 'done',
    planAbc: PLAN,
    spec: { ...defaultSpec(), title: 'T', caption: 'warm folk', lyrics: '[verse]\nla la', seed: '111', ...spec },
    ...over,
  };
}

const fresh = () => '999';
/** The Remix editor's starting draft (remixSpec), minus the random seed. */
const draft = (s: Song, over: Partial<SongSpec> = {}): SongSpec => ({ ...s.spec, seed: 'draft', abc: undefined, ...over });

describe('remixTake', () => {
  const o = song();

  it('keep feel + keep melody re-performs the original take', () => {
    expect(remixTake(o, draft(o), { keepSeed: true, keepMelody: true }, fresh)).toEqual({ seed: '111', abc: PLAN });
  });

  it('new seed + keep melody sings the same plan with a new feel', () => {
    expect(remixTake(o, draft(o), { keepSeed: false, keepMelody: true }, fresh)).toEqual({ seed: '999', abc: PLAN });
  });

  it('new melody always takes a new seed — the original seed would write the original plan again', () => {
    expect(remixNeedsNewSeed(o, draft(o), { keepSeed: true, keepMelody: false })).toBe(true);
    expect(remixTake(o, draft(o), { keepSeed: true, keepMelody: false }, fresh)).toEqual({ seed: '999', abc: undefined });
    expect(remixTake(o, draft(o), { keepSeed: false, keepMelody: false }, fresh)).toEqual({ seed: '999', abc: undefined });
  });

  it('a hand-edited plan is performed as written and keeps the chosen feel', () => {
    const edited = PLAN + '\n|: G A B c :|';
    const c = { keepSeed: true, keepMelody: false, editedAbc: edited };
    expect(offersMelodyChoice(o, draft(o), edited)).toBe(false);
    expect(remixTake(o, draft(o), c, fresh)).toEqual({ seed: '111', abc: edited });
  });

  it('a changed plan mode writes a new plan; the feel stays the user’s choice', () => {
    const d = draft(o, { planMode: 'melody' });
    expect(offersMelodyChoice(o, d)).toBe(false);
    expect(remixTake(o, d, { keepSeed: true, keepMelody: true }, fresh)).toEqual({ seed: '111', abc: undefined });
  });

  it('plan mode off performs no plan', () => {
    expect(remixTake(o, draft(o, { planMode: 'off' }), { keepSeed: true, keepMelody: true }, fresh)).toEqual({ seed: '111', abc: undefined });
  });

  it('a song without a saved plan offers no melody choice and keeps the chosen feel', () => {
    const bare = song({ planAbc: undefined });
    expect(canKeepMelody(bare)).toBe(false);
    expect(offersMelodyChoice(bare, draft(bare))).toBe(false);
    // The editor starts such a draft on "new melody"; that must not override "Keep original".
    expect(remixTake(bare, draft(bare), { keepSeed: true, keepMelody: false }, fresh)).toEqual({ seed: '111', abc: undefined });
  });
});
