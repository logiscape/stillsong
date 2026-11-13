import { describe, expect, it } from 'vitest';
import { defaultSpec, type Song, type SongSpec } from '@engine/domain/types';
import { canKeepMelody, canKeepRest, keepRestTake, keepsRestByDefault, offersKeepRest, offersMelodyChoice, remixNeedsNewSeed, remixTake, reshapesLyrics } from '../remix';

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

describe('keep the rest', () => {
  const LYRICS = '[verse]\nThe room is cold and wide\nWith nowhere left to hide\n\n[chorus]\nOne spark in the black';
  const o = song({ takePath: 'C:\\lib\\songs\\orig.take.safetensors' }, { lyrics: LYRICS });
  const reworded = LYRICS.replace('The room is cold and wide', 'The river runs with gold');

  it('is offered when only the words of existing lines changed', () => {
    expect(canKeepRest(o)).toBe(true);
    expect(offersKeepRest(o, draft(o, { lyrics: reworded }))).toBe(true);
    // The title and the MP3 quality are not part of the performance.
    expect(offersKeepRest(o, draft(o, { lyrics: reworded, title: 'Another name', quality: '320k' }))).toBe(true);
  });

  it('is not offered with nothing to sing again', () => {
    expect(offersKeepRest(o, draft(o))).toBe(false);
  });

  it('is not offered when lines were added, removed or retagged', () => {
    for (const lyrics of [LYRICS + '\nStill I see you', LYRICS.replace('With nowhere left to hide\n', ''), reworded.replace('[chorus]', '[bridge]')]) {
      expect(offersKeepRest(o, draft(o, { lyrics }))).toBe(false);
      expect(reshapesLyrics(o, draft(o, { lyrics }))).toBe(true);
    }
    expect(reshapesLyrics(o, draft(o, { lyrics: reworded }))).toBe(false);
  });

  it('is not offered when the edit asks for another performance', () => {
    const d = (over: Partial<SongSpec>) => draft(o, { lyrics: reworded, ...over });
    expect(offersKeepRest(o, d({ caption: 'cold synthwave' }))).toBe(false);
    expect(offersKeepRest(o, d({ planMode: 'melody' }))).toBe(false);
    expect(offersKeepRest(o, d({ planMode: 'off' }))).toBe(false);
    expect(offersKeepRest(o, d({ steps: 50 }))).toBe(false);
    expect(offersKeepRest(o, d({ cfg: 2 }))).toBe(false);
    expect(offersKeepRest(o, d({}), 'X:1\n% a hand-edited plan')).toBe(false);
  });

  it('needs a saved take and a saved plan, and words', () => {
    const noTake = song({}, { lyrics: LYRICS });
    const noPlan = song({ takePath: 'x', planAbc: undefined }, { lyrics: LYRICS });
    const wordless = song({ takePath: 'x' }, { lyrics: LYRICS, instrumental: true });
    for (const s of [noTake, noPlan, wordless]) {
      expect(canKeepRest(s)).toBe(false);
      expect(offersKeepRest(s, draft(s, { lyrics: reworded }))).toBe(false);
      expect(reshapesLyrics(s, draft(s, { lyrics: LYRICS + '\nmore' }))).toBe(false);
    }
  });

  it("performs the original's take again: its seed and plan, the new words", () => {
    const spec = keepRestTake(o, draft(o, { lyrics: reworded, title: 'Another name' }));
    expect(spec).toMatchObject({ seed: '111', abc: PLAN, lyrics: reworded, title: 'Another name', edit: { sourceId: 'orig' } });
  });

  it('starts on keeping the rest only when no different performance was asked for', () => {
    expect(keepsRestByDefault({ keepSeed: true, keepMelody: true })).toBe(true);
    // "New seed" or "New melody" chosen before the line was reworded: that choice stands.
    expect(keepsRestByDefault({ keepSeed: false, keepMelody: true })).toBe(false);
    expect(keepsRestByDefault({ keepSeed: true, keepMelody: false })).toBe(false);
  });

  it('can be chained: an edited version is kept from in turn', () => {
    const edited = song({ id: 'v2', takePath: 'y', parentId: 'orig' }, { lyrics: reworded, edit: { sourceId: 'orig' }, abc: PLAN });
    const again = reworded.replace('One spark in the black', 'One spark in the dark');
    expect(offersKeepRest(edited, draft(edited, { lyrics: again }))).toBe(true);
    expect(keepRestTake(edited, draft(edited, { lyrics: again })).edit).toEqual({ sourceId: 'v2' });
  });
});
