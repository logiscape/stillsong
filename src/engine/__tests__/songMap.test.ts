import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PlanError, chordNotes, parsePlan, serializePlan } from '@engine/domain/melodyPlan';
import { buildSongMap, evenTiming, findPatterns, musicBoxEvents, phraseAt, recordingTiming, type SongMap } from '@engine/domain/songMap';
import { parseLyrics } from '@engine/cowriter/lyrics';

// The three starter songs carry real plans, as the studio wrote them.
interface Example { spec: { title: string; lyrics: string }; abc: string; actualSec: number }
const examples = (JSON.parse(readFileSync(fileURLToPath(new URL('../../../examples/examples.json', import.meta.url)), 'utf8')) as { songs: Example[] }).songs;
const example = (title: string): Example => examples.find((s) => s.spec.title === title)!;

const SMALL = [
  'X:1',
  'M:4/4',
  'L:1/8',
  'Q:1/4=120',
  'V: Vocal clef=treble name="Vocal Melody" snm="Vocal"',
  'K:G',
  '% verse',
  'V: Vocal',
  '"G"G2A2B2c2|"D"^c4-c4|"Em"=f2f2z4|',
  'V: Ins',
  'Z2|g8|',
  '% chorus',
  'V: Vocal',
  '"C"e8|',
  'V: Ins',
  "c'8|",
  '',
].join('\n');

/** "verse[AB-]": one letter per phrase, `-` where the tune is heard once. */
function patternRows(map: SongMap): string {
  return map.sections
    .map((s, si) => `${s.name}[${map.phrases.filter((p) => p.section === si).map((p) => (p.pattern < 0 ? '-' : String.fromCharCode(65 + p.pattern))).join('')}]`)
    .join(' ');
}

describe('parsePlan', () => {
  it('reads the header: meter, note length, tempo and key', () => {
    const { ctx, header } = parsePlan(SMALL);
    expect(header).toHaveLength(6);
    expect(ctx).toMatchObject({ meterNum: 4, meterDen: 4, barUnits: 8, tempo: 120, secPerBar: 2, keyLabel: 'G major', keyAcc: { F: 1 } });
  });

  it('reads notes with the key signature, accidentals that hold for the bar, ties and whole-bar rests', () => {
    const [verse, chorus] = parsePlan(SMALL).sections;
    expect(verse.name).toBe('verse');
    const [p] = verse.phrases;
    expect(p.bars).toBe(3);
    expect(p.vocal.map((n) => [n.pos, n.dur, n.midi])).toEqual([
      [0, 2, 67], [2, 2, 69], [4, 2, 71], [6, 2, 72],
      [8, 4, 73], [12, 4, 73], // the sharp holds on the tied note
      [16, 2, 77], [18, 2, 77], // a natural against the key's F sharp, held too
    ]);
    expect(p.vocal[4].tie).toBe(true);
    expect(p.onsets).toBe(7); // the tied note is sung once
    expect(p.ins.map((n) => [n.pos, n.dur, n.midi])).toEqual([[16, 8, 79]]); // after two bars of rest
    expect(p.chords).toEqual([{ pos: 0, name: 'G', bar: 0 }, { pos: 8, name: 'D', bar: 1 }, { pos: 16, name: 'Em', bar: 2 }]);
    expect(chorus.phrases[0].vocal[0].midi).toBe(76);
    expect(chorus.phrases[0].ins[0].midi).toBe(84);
  });

  it('gives back the text it read, character for character', () => {
    for (const abc of [SMALL, ...examples.map((s) => s.abc), SMALL.replace(/\n/g, '\r\n')]) {
      const plan = parsePlan(abc);
      expect(serializePlan(plan.header, plan.sections, plan.tail)).toBe(abc);
    }
  });

  it('reads a plan with Windows line endings the same way', () => {
    const plan = parsePlan(SMALL.replace(/\n/g, '\r\n'));
    expect(plan.ctx).toEqual(parsePlan(SMALL).ctx);
    expect(plan.sections.map((s) => [s.name, s.phrases.map((p) => p.bars)])).toEqual([['verse', [3]], ['chorus', [1]]]);
  });

  it('reads the starter songs: key, bar length and bar count', () => {
    const facts = examples.map((s) => {
      const map = buildSongMap(s.abc, s.spec.lyrics)!;
      return [s.spec.title, map.ctx.keyLabel, map.ctx.barUnits, Number(map.ctx.secPerBar.toFixed(3)), map.bars];
    });
    expect(facts).toEqual([
      ['Where the Old Gods Stood', 'D minor', 16, 1.714, 176],
      ['Iron Ghost', 'D minor', 8, 1.667, 175],
      ['The Last Ember', 'D♯ minor', 32, 3.2, 62],
    ]);
  });
});

describe('buildSongMap', () => {
  it('is null for a plan with no music', () => {
    expect(buildSongMap('', '[verse]\nA line')).toBeNull();
    expect(buildSongMap('X:1\nM:4/4\nK:C\n', '')).toBeNull();
  });

  it('lays the phrases out in bars, section by section', () => {
    const map = buildSongMap(SMALL, '[verse]\nOne line here\n[chorus]\nAnd one more')!;
    expect(map.sections).toEqual([{ name: 'verse', start: 0, bars: 3 }, { name: 'chorus', start: 3, bars: 1 }]);
    expect(map.phrases.map((p) => [p.section, p.index, p.count, p.start, p.words])).toEqual([
      [0, 0, 1, 0, ['One line here']],
      [1, 0, 1, 3, ['And one more']],
    ]);
    expect([map.bars, map.lo, map.hi]).toEqual([4, 67, 84]);
    expect([0, 2.99, 3, 9].map((bar) => phraseAt(map, bar))).toEqual([0, 0, 1, 1]);
  });

  it('marks the phrases that share a tune', () => {
    const ember = example('The Last Ember');
    expect(patternRows(buildSongMap(ember.abc, ember.spec.lyrics)!)).toBe('intro[--] verse[A--B] chorus[CD] verse[A---] interlude[--B] chorus[CD] outro[-]');
    const gods = example('Where the Old Gods Stood');
    expect(patternRows(buildSongMap(gods.abc, gods.spec.lyrics)!)).toBe(
      'intro[AAAAAA-] verse[BBB---] chorus[----C] verse[B-B-] chorus[DEF-] interlude[--GG----] chorus[DEF-] interlude[C--HHHH-]',
    );
  });

  it('puts every lyric line under exactly one phrase, in order', () => {
    for (const s of examples) {
      const map = buildSongMap(s.abc, s.spec.lyrics)!;
      const sung = parseLyrics(s.spec.lyrics).sections.flatMap((sec) => sec.lines);
      expect(map.phrases.flatMap((p) => p.words), s.spec.title).toEqual(sung);
    }
  });

  it('keeps a tune heard once out of the patterns, and silence too', () => {
    const { sections, ctx } = parsePlan(SMALL);
    expect(findPatterns(sections.flatMap((s) => s.phrases), ctx.barUnits)).toEqual([-1, -1]);
    const twice = parsePlan(SMALL + '% verse\nV: Vocal\n"G"G2A2B2c2|"D"^c4-c4|"Em"=f2f2z4|\nV: Ins\nZ3|\n% outro\nV: Vocal\n"G"z8|\n');
    expect(findPatterns(twice.sections.flatMap((s) => s.phrases), ctx.barUnits)).toEqual([0, -1, 0, -1]);
  });
});

describe('music box', () => {
  const map = buildSongMap(SMALL, '')!;

  it('plays the plan at its own tempo, a tied note once', () => {
    const events = musicBoxEvents(map, 0, 3);
    expect(events.filter((e) => e.kind === 'singer').map((e) => [e.t, e.d])).toEqual([[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 2], [4, 0.5], [4.5, 0.5]]);
    expect(events.filter((e) => e.kind === 'instrument')).toEqual([{ kind: 'instrument', t: 4, d: 2, midi: 79 }]);
    expect(events.filter((e) => e.kind === 'chord')).toEqual([
      { kind: 'chord', t: 0, d: 2, name: 'G' }, { kind: 'chord', t: 2, d: 2, name: 'D' }, { kind: 'chord', t: 4, d: 2, name: 'Em' },
    ]);
  });

  it('starts from any bar, timed from there', () => {
    expect(musicBoxEvents(map, 1, 2)).toEqual([
      { kind: 'singer', t: 0, d: 2, midi: 73 },
      { kind: 'chord', t: 0, d: 2, name: 'D' },
    ]);
    expect(musicBoxEvents(map, 3, 4).map((e) => e.t)).toEqual([0, 0, 0]);
  });

  it('voices chord symbols', () => {
    expect(chordNotes('Dm')).toEqual({ bass: 38, notes: [50, 53, 57] });
    expect(chordNotes('Bbmaj7')).toEqual({ bass: 46, notes: [58, 50, 53, 57] });
    expect(chordNotes('D#m7/C#')).toEqual({ bass: 37, notes: [51, 54, 58, 49] });
    expect(chordNotes('N.C.')).toBeNull();
  });
});

describe('timing', () => {
  const mapOf = (title: string) => {
    const s = example(title);
    return { map: buildSongMap(s.abc, s.spec.lyrics)!, total: s.actualSec };
  };

  it('spreads the bars evenly over a length', () => {
    const t = evenTiming(176, 307.76);
    expect(t.secAt(0)).toBe(0);
    expect(t.secAt(176)).toBeCloseTo(307.76);
    expect(t.barAt(t.secAt(40.5))).toBeCloseTo(40.5);
  });

  it('places the bars of a recording by the plan tempo, close to where they were measured', () => {
    // Bar starts measured on the takes (25 frames a second), 2026-11-16:
    // "Old Gods" plays three bars more than its plan at the very start;
    // "Iron Ghost" follows its plan bar for bar after a short lead-in.
    const gods = mapOf('Where the Old Gods Stood');
    const godsTiming = recordingTiming(gods.map, gods.total);
    for (const bar of [25, 60, 101, 150]) {
      const measured = (13.75 + (bar + 3) * 42.857) / 25;
      expect(Math.abs(godsTiming.secAt(bar) - measured), `bar ${bar}`).toBeLessThan(0.5);
    }
    // Spread evenly, the first verse came out almost five seconds early.
    expect((13.75 + 28 * 42.857) / 25 - evenTiming(gods.map.bars, gods.total).secAt(25)).toBeGreaterThan(4.5);
    const ghost = mapOf('Iron Ghost');
    const ghostTiming = recordingTiming(ghost.map, ghost.total);
    for (const bar of [35, 100, 123]) {
      expect(Math.abs(ghostTiming.secAt(bar) - (21 + bar * 41.667) / 25), `bar ${bar}`).toBeLessThan(0.25);
    }
  });

  it('runs from the first second to the last without a jump, both ways', () => {
    for (const s of examples) {
      const { map, total } = mapOf(s.spec.title);
      const t = recordingTiming(map, total);
      expect(t.secAt(0)).toBe(0);
      expect(t.secAt(map.bars)).toBeCloseTo(total);
      let before = -1;
      for (let bar = 0; bar <= map.bars; bar += 0.25) {
        const sec = t.secAt(bar);
        expect(sec, `${s.spec.title} bar ${bar}`).toBeGreaterThan(before);
        expect(t.barAt(sec)).toBeCloseTo(bar);
        before = sec;
      }
    }
  });

  it('counts from the start when the song was cut short, and spreads evenly when the lengths are far apart', () => {
    const { map } = mapOf('Iron Ghost');
    const spb = map.ctx.secPerBar;
    expect(recordingTiming(map, 200, true).secAt(60)).toBeCloseTo(60 * spb);
    expect(recordingTiming(map, 200).secAt(60)).toBeCloseTo((60 / map.bars) * 200);
    expect(recordingTiming(map, 400).secAt(60)).toBeCloseTo((60 / map.bars) * 400);
  });

  it('keeps the words of a part the plan leaves without music', () => {
    const map = buildSongMap(SMALL + '% bridge\n', '[verse]\nOne\n[chorus]\nTwo\n[bridge]\nThree')!;
    expect(map.sections.map((s) => s.name)).toEqual(['verse', 'chorus']);
    expect(map.phrases.map((p) => p.words)).toEqual([['One'], ['Two', 'Three']]);
  });
});

// 4/4 at 120: a bar is 2 s and holds 8 note-length units.
const HEAD = 'X:1\nM:4/4\nL:1/8\nQ:1/4=120\nK:C\n';

describe('plans no song could have', () => {
  const plan = (body: string, header = HEAD) => `${header}% verse\nV: Vocal\n${body}\n`;

  it('refuses a whole-bar rest that counts more bars than a song can hold, without building them', () => {
    // Before the limit, the two largest of these never finished.
    for (const rest of ['Z4001', 'Z200000', 'Z4000000', 'Z99999999999999999999', 'Z' + '9'.repeat(400)]) {
      expect(() => parsePlan(plan(`"C"c8|${rest}|`)), rest).toThrow(PlanError);
      expect(buildSongMap(plan(`"C"c8|${rest}|`), '[verse]\nA line'), rest).toBeNull();
    }
  });

  it('counts the bars of the whole plan, not of one rest', () => {
    const phrases = (n: number) => plan(Array.from({ length: n }, () => '"C"c8|Z100|').join('\nV: Vocal\n'));
    expect(buildSongMap(phrases(30), '')!.bars).toBe(3030);
    expect(buildSongMap(phrases(50), '')).toBeNull(); // 5,050 bars
  });

  it('refuses a meter, note length or tempo that gives no usable bar', () => {
    const headers = ['Q:1/4=0', 'Q:1/4=100000', 'L:1/1000000', 'L:1/0', 'M:0/4', 'M:4/0'];
    for (const field of headers) {
      const header = HEAD.replace(new RegExp(`^${field[0]}:.*$`, 'm'), field);
      expect(header, field).toContain(field);
      expect(() => parsePlan(plan('"C"c8|', header)), field).toThrow(PlanError);
      expect(buildSongMap(plan('"C"c8|', header), ''), field).toBeNull();
    }
  });

  it('reads an ordinary long rest', () => {
    expect(buildSongMap(plan('"C"c8|Z64|"C"c8|'), '')!.bars).toBe(66);
  });
});

describe('music box, started in the middle', () => {
  const kinds = (events: ReturnType<typeof musicBoxEvents>, kind: string) => events.filter((e) => e.kind === kind);

  it('holds a sung note and a chord that are already sounding for what remains of them', () => {
    // SMALL, second bar: a sung C sharp tied across the whole bar over a D chord.
    const events = musicBoxEvents(buildSongMap(SMALL, '')!, 1.5, 3);
    expect(kinds(events, 'singer')).toEqual([
      { kind: 'singer', t: 0, d: 1, midi: 73 },
      { kind: 'singer', t: 1, d: 0.5, midi: 77 },
      { kind: 'singer', t: 1.5, d: 0.5, midi: 77 },
    ]);
    expect(kinds(events, 'chord')).toEqual([{ kind: 'chord', t: 0, d: 1, name: 'D' }, { kind: 'chord', t: 1, d: 2, name: 'Em' }]);
  });

  it('does not strike a plucked instrument note again', () => {
    const map = buildSongMap(`${HEAD}% intro\nV: Vocal\n"C"z8|"C"z8|\nV: Ins\ne8-|e8|\n`, '')!;
    expect(kinds(musicBoxEvents(map, 0, 2), 'instrument')).toEqual([{ kind: 'instrument', t: 0, d: 4, midi: 76 }]);
    const late = musicBoxEvents(map, 0.5, 2);
    expect(kinds(late, 'instrument')).toEqual([]);
    expect(kinds(late, 'chord')).toEqual([{ kind: 'chord', t: 0, d: 1, name: 'C' }, { kind: 'chord', t: 1, d: 2, name: 'C' }]);
  });

  it('starts nothing early: a note that ends where playback starts stays out', () => {
    const map = buildSongMap(SMALL, '')!;
    expect(musicBoxEvents(map, 2, 3).every((e) => e.t >= 0)).toBe(true);
    expect(musicBoxEvents(map, 2, 3).flatMap((e) => (e.kind === 'singer' ? [e.midi] : []))).toEqual([77, 77]);
    expect(kinds(musicBoxEvents(map, 2, 3), 'chord')).toEqual([{ kind: 'chord', t: 0, d: 2, name: 'Em' }]);
  });

  it('never opens on silence in the starter songs while the singer or a chord is sounding', () => {
    for (const s of examples) {
      const map = buildSongMap(s.abc, s.spec.lyrics)!;
      const held = musicBoxEvents(map, 0, map.bars).filter((e) => e.kind !== 'instrument');
      let inside = 0;
      for (let bar = 0.25; bar < map.bars; bar += 0.25) {
        const t = bar * map.ctx.secPerBar;
        if (!held.some((e) => e.t < t - 1e-6 && e.t + e.d > t + 1e-6)) continue;
        inside++;
        expect(musicBoxEvents(map, bar, map.bars)[0].t, `${s.spec.title} bar ${bar}`).toBe(0);
      }
      expect(inside, s.spec.title).toBeGreaterThan(100);
    }
  });
});

describe('music box ties', () => {
  it('sounds a note tied from one phrase into the next once', () => {
    const map = buildSongMap(`${HEAD}% verse\nV: Vocal\n"C"c4d4-|\nV: Ins\ne8-|\nV: Vocal\n"C"d4e4|\nV: Ins\ne4g4|\n`, '')!;
    expect(map.phrases).toHaveLength(2);
    const events = musicBoxEvents(map, 0, 2);
    expect(events.filter((e) => e.kind === 'singer')).toEqual([
      { kind: 'singer', t: 0, d: 1, midi: 72 },
      { kind: 'singer', t: 1, d: 2, midi: 74 }, // half a bar, tied into half of the next
      { kind: 'singer', t: 3, d: 1, midi: 76 },
    ]);
    expect(events.filter((e) => e.kind === 'instrument')).toEqual([
      { kind: 'instrument', t: 0, d: 3, midi: 76 },
      { kind: 'instrument', t: 3, d: 1, midi: 79 },
    ]);
  });

  it('joins a tie only to the same pitch right after it', () => {
    const map = buildSongMap(`${HEAD}% verse\nV: Vocal\n"C"c2-z2c2-d2|\n`, '')!;
    expect(musicBoxEvents(map, 0, 1).filter((e) => e.kind === 'singer').map((e) => [e.t, e.d])).toEqual([[0, 0.5], [1, 0.5], [1.5, 0.5]]);
  });

  it('strikes nothing where the starter songs tie a note over a phrase boundary', () => {
    // Six places: five in "Iron Ghost" (four in its last interlude, "...|a8-|"
    // then "a4z2g2|..."), one in "The Last Ember". Each was struck twice.
    let boundaries = 0;
    for (const s of examples) {
      const map = buildSongMap(s.abc, s.spec.lyrics)!;
      const events = musicBoxEvents(map, 0, map.bars);
      for (const [lane, kind] of [['vocal', 'singer'], ['ins', 'instrument']] as const) {
        map.phrases.forEach((it, i) => {
          if (!it.phrase[lane].at(-1)?.tie) return;
          boundaries++;
          const at = map.phrases[i + 1].start * map.ctx.secPerBar;
          const across = events.filter((e) => e.kind === kind && e.t < at - 1e-6 && e.t + e.d > at + 1e-6);
          expect(across, `${s.spec.title}: ${kind} held over ${at.toFixed(1)} s`).toHaveLength(1);
          expect(events.some((e) => e.kind === kind && Math.abs(e.t - at) < 1e-6), `${s.spec.title}: ${kind} struck at ${at.toFixed(1)} s`).toBe(false);
        });
      }
    }
    expect(boundaries).toBe(6);
  });
});

describe('verses and their words', () => {
  const twoVerses = `${HEAD}% verse\nV: Vocal\n"C"c2d2e2f2|\n% verse\nV: Vocal\n"C"c2d2e2f2|\n% chorus\nV: Vocal\n"F"f2g2a2g2|\n`;
  const oneVerse = `${HEAD}% verse\nV: Vocal\n"C"c2d2e2f2|\n% chorus\nV: Vocal\n"F"f2g2a2g2|\n`;
  const words = (abc: string, lyrics: string) => buildSongMap(abc, lyrics)!.phrases.map((p) => p.words);

  it('gives each numbered verse its own verse part', () => {
    for (const [a, b] of [['verse 1', 'verse 2'], ['Verse 1', 'Verse 2'], ['verse', 'verse'], ['verse', 'verse 2']]) {
      expect(words(twoVerses, `[${a}]\nFirst verse\n[${b}]\nSecond verse\n[chorus]\nThe chorus`), `${a}, ${b}`).toEqual([['First verse'], ['Second verse'], ['The chorus']]);
    }
  });

  it('keeps a pre-chorus with the verse before it', () => {
    expect(words(twoVerses, '[verse 1]\nFirst verse\n[pre-chorus]\nThe lift\n[verse 2]\nSecond verse\n[chorus]\nThe chorus')).toEqual([
      ['First verse', 'The lift'], ['Second verse'], ['The chorus'],
    ]);
  });

  it('keeps a second verse with the first when the plan writes one verse part', () => {
    expect(words(oneVerse, '[verse 1]\nFirst verse\n[verse 2]\nSecond verse\n[chorus]\nThe chorus')).toEqual([['First verse', 'Second verse'], ['The chorus']]);
  });

  it('puts the words of a part with no music where they are sung: before the first phrase, or after the one before', () => {
    const verse = 'V: Vocal\n"C"c2d2e2f2|\n';
    expect(words(`${HEAD}% intro\n% verse\n${verse}`, '[intro]\nOpening line\n[verse]\nVerse line')).toEqual([['Opening line', 'Verse line']]);
    expect(words(`${HEAD}% intro\n% interlude\n% verse\n${verse}`, '[intro]\nOpening line\n[bridge]\nBridge line\n[verse]\nVerse line')).toEqual([
      ['Opening line', 'Bridge line', 'Verse line'],
    ]);
    expect(words(`${HEAD}% verse\n${verse}% interlude\n% chorus\n${verse}`, '[verse]\nVerse line\n[bridge]\nBridge line\n[chorus]\nChorus line')).toEqual([
      ['Verse line', 'Bridge line'], ['Chorus line'],
    ]);
  });
});

describe('note and rest lengths', () => {
  const vocal = (body: string) => parsePlan(`${HEAD}% verse\nV: Vocal\n${body}\n`).sections[0].phrases[0];
  const spans = (body: string) => vocal(body).vocal.map((n) => [n.pos, n.dur]);

  it('reads a slash with no number after it as a half, two as a quarter', () => {
    expect(spans('"C"C/D/E2|')).toEqual([[0, 0.5], [0.5, 0.5], [1, 2]]);
    //            C//       D//          E/          F3/2      G3/         A/4        z/   c/
    expect(spans('"C"C//D//E/F3/2G3/A/4z/c/|')).toEqual([[0, 0.25], [0.25, 0.25], [0.5, 0.5], [1, 1.5], [2.5, 1.5], [4, 0.25], [4.75, 0.5]]);
    expect(vocal('"C"C//D//E/F3/2G3/A/4z/c/|').onsets).toBe(7);
  });

  it('still reads counts and written fractions', () => {
    expect(spans('"C"C2D/2E3/2z2F|')).toEqual([[0, 2], [2, 0.5], [2.5, 1.5], [6, 1]]);
  });

  it('ties half-length notes like any others', () => {
    const map = buildSongMap(`${HEAD}% verse\nV: Vocal\n"C"c/-c/d|\n`, '')!;
    expect(musicBoxEvents(map, 0, 1).filter((e) => e.kind === 'singer').map((e) => [e.t, e.d])).toEqual([[0, 0.25], [0.25, 0.25]]);
  });

  it('refuses a length that is not a number, in either voice', () => {
    // Before the check, "C/0" gave a note with a NaN length and NaN positions after it.
    const bodies = ['"C"C/0D2E2|', '"C"C2z/0E2|', '"C"C0/0|', '"C"C2D2|\nV: Ins\ne/0g4|', `"C"c${'9'.repeat(400)}|`, `"C"z${'9'.repeat(400)}|`];
    for (const body of bodies) {
      const abc = `${HEAD}% verse\nV: Vocal\n${body}\n`;
      expect(() => parsePlan(abc), body.slice(0, 30)).toThrow(PlanError);
      expect(buildSongMap(abc, '[verse]\nA line'), body.slice(0, 30)).toBeNull();
    }
  });

  it('gives every note of the starter songs a finite place and length', () => {
    for (const s of examples) {
      const map = buildSongMap(s.abc, s.spec.lyrics)!;
      const numbers = musicBoxEvents(map, 0, map.bars).flatMap((e) => [e.t, e.d]);
      expect(numbers.every((n) => Number.isFinite(n) && n >= 0), s.spec.title).toBe(true);
    }
  });
});

describe('where a recording ends', () => {
  const fourBars = buildSongMap(`${HEAD}% verse\nV: Vocal\n"C"c8|"C"d8|"C"e8|"C"f8|\n`, '')!; // 8 s at the plan's tempo

  it('is the last bar of the map for a song that reached its ending', () => {
    expect(evenTiming(176, 301.7).lastBar).toBe(176);
    for (const s of examples) {
      const map = buildSongMap(s.abc, s.spec.lyrics)!;
      const t = recordingTiming(map, s.actualSec);
      expect(t.lastBar, s.spec.title).toBe(map.bars);
      expect(t.secAt(t.lastBar), s.spec.title).toBeCloseTo(t.total);
    }
    expect(recordingTiming(fourBars, 8.4).lastBar).toBe(4);
    expect(recordingTiming(fourBars, 20).lastBar).toBe(4); // far apart: spread evenly
  });

  it('is partway through the plan for a song that was cut short, and no time lies past it', () => {
    const t = recordingTiming(fourBars, 5, true);
    expect(t.lastBar).toBe(2.5);
    expect(t.secAt(t.lastBar)).toBe(t.total);
    // What the map must not do: bar 3.5 would be at 0:07 of a five-second recording.
    expect(t.secAt(3.5)).toBeGreaterThan(t.total);
    expect(recordingTiming(fourBars, 30, true).lastBar).toBe(4); // cut short, yet longer than the plan
  });
});
