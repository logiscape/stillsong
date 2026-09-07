// The Gemma co-writer: turns a photo (and optional hints) into a complete
// MiniMax Music 3 song package (title, caption, lyrics). Two passes:
//   1. analyzePhoto — vision call, cached on the photo asset by sha256
//   2. compose — persona + guide + few-shots + brief -> JSON (schema-constrained)
// The linter validates the output; one automatic repair round-trip runs
// before giving up (the caller may re-compose from scratch on top of that).

import type { FileStore } from '../ports';
import type { PhotoAsset, VocalPref } from '../domain/types';
import { LlmClient, type ChatMessage } from './llmClient';
import { COMPOSE_SCHEMA, WRITER_PERSONA, analysisPrompt, captionGuide, fewShot } from './guides';
import { lintCaption, lintLyrics, stripMarkdown, type LintIssue } from './linter';
import { renderCap } from '../domain/duration';
import type { PhotoRepo } from '../repo/photos';

export interface CowriteRequest {
  idea: string;
  photo?: PhotoAsset;
  /** Target length the lyrics should fill ("about this long"). */
  durationSec: number;
  instrumental: boolean;
  vocalPref: VocalPref;
  genreHint?: string;
  language?: string;
}

export interface CowriteResult {
  title: string;
  caption: string;
  lyrics: string;
  /** Echo of the requested target; the render cap is derived from it + the lyrics. */
  targetSec: number;
  notes?: string;
  photoCard?: string;
  lintIssues: LintIssue[];
  repaired: boolean;
}

interface ComposeJson {
  title: string;
  caption: string;
  lyrics: string;
  notes?: string;
}

export class Cowriter {
  constructor(
    private readonly llm: LlmClient,
    private readonly files: FileStore,
    private readonly photos: PhotoRepo,
  ) {}

  /** Vision pass, cached on the photo row (keyed by sha256 through the repo). */
  async analyzePhoto(stale: PhotoAsset): Promise<string> {
    // Re-read the row: the caller may hold an object from before a previous
    // analysis (e.g. the retry compose in the same creation).
    const photo = (await this.photos.byId(stale.id)) ?? stale;
    const source = photo.source ?? 'photo';
    if (photo.analysisJson) {
      try {
        const cached = JSON.parse(photo.analysisJson) as { card?: string; source?: string };
        // A card from the other prompt variant is stale (assets dedupe by
        // sha256, so the same bytes can arrive as photo then drawing); a
        // legacy {card} predates the split and was always the photo prompt.
        if (cached.card && (cached.source ?? 'photo') === source) return cached.card;
      } catch {
        /* re-analyze */
      }
    }
    const b64 = await this.files.readBase64(photo.localPath);
    const card = (
      await this.llm.chat([{ role: 'user', content: analysisPrompt(source), images: [b64] }], { temperature: 0.3 })
    ).trim();
    if (!card) throw new Error('The songwriter returned an empty photo analysis.');
    await this.photos.setAnalysis(photo.id, JSON.stringify({ card, source }));
    return card;
  }

  async compose(req: CowriteRequest, onProgress?: (phase: string) => void): Promise<CowriteResult> {
    let photoCard: string | undefined;
    if (req.photo) {
      onProgress?.('Analyzing photo');
      photoCard = await this.analyzePhoto(req.photo);
    }
    onProgress?.('Writing song');
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(req.instrumental) },
      { role: 'user', content: composeUserMessage(req, photoCard) },
    ];
    return this.runWithRepair(messages, req, 0.8, photoCard);
  }

  private async runWithRepair(
    messages: ChatMessage[],
    req: CowriteRequest,
    temperature: number,
    photoCard?: string,
  ): Promise<CowriteResult> {
    let parsed = enforceSkeleton(await this.call(messages, temperature), req);
    let issues = lint(parsed, req);
    let repaired = false;
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) {
      const repairMsg = `Your output has problems:\n${issues.map((i) => `- ${i.message}`).join('\n')}\n\nRewrite the complete song package fixing every problem. Return the full JSON again.`;
      parsed = enforceSkeleton(
        await this.call(
          [...messages, { role: 'assistant', content: JSON.stringify(parsed) }, { role: 'user', content: repairMsg }],
          0.4,
        ),
        req,
      );
      issues = lint(parsed, req);
      repaired = true;
    }
    return {
      title: parsed.title.trim() || 'Untitled',
      caption: parsed.caption,
      lyrics: parsed.lyrics,
      targetSec: req.durationSec,
      notes: parsed.notes?.trim() || undefined,
      photoCard,
      lintIssues: issues,
      repaired,
    };
  }

  private async call(messages: ChatMessage[], temperature: number): Promise<ComposeJson> {
    const raw = await this.llm.chat(messages, {
      temperature,
      format: COMPOSE_SCHEMA as unknown as Record<string, unknown>,
    });
    return normalize(parseJson(raw));
  }
}

function systemPrompt(instrumental: boolean): string {
  return [WRITER_PERSONA, captionGuide(instrumental), fewShot(instrumental), 'Return a JSON object with keys title, caption, lyrics, notes.'].join('\n\n');
}

/**
 * Deterministic tag skeleton for an instrumental of the given target length.
 * Fixed-seed dose–response (2026-08-28, encode-only, identical caption, seeds
 * 424242/133742): composed length is LINEAR in tag count at ~9 s per wordless
 * tag from 3 to 15 tags (3 → ~27 s, 9 → ~74 s, 12 → ~109 s, 15 → ~139 s
 * seed-mean), then BREAKS DOWN — 18 and 24 tags came out shorter than 15.
 * Hence 1 tag per 9 s, clamped to 15 (a single pass can't reliably exceed
 * ~2:20; longer needs continuation). Arrangement style, prose length
 * statements, and "duration is N" metadata all showed no effect beyond the
 * ±15–35 s seed noise in the same A/B. [solo] sits at the peaks; everything
 * else repeats [instrumental]. Computed here rather than asked of Gemma:
 * counting is exactly what a small LLM gets wrong, and every miss costs a
 * ~10 s repair round-trip on the GPU.
 */
export function instrumentalSkeleton(durationSec: number): string {
  const total = Math.min(15, Math.max(3, Math.round(durationSec / 9)));
  const body = total - 2;
  const soloAt = new Set<number>();
  if (body >= 10) {
    soloAt.add(Math.round(body * 0.4));
    soloAt.add(Math.round(body * 0.75));
  } else if (body >= 3) {
    soloAt.add(Math.ceil(body * 0.6));
  }
  const tags = ['[intro]'];
  for (let i = 1; i <= body; i++) tags.push(soloAt.has(i) ? '[solo]' : '[instrumental]');
  tags.push('[outro]');
  return tags.join('\n');
}

/**
 * Shown only when the user gave no genre: a nudge toward a specific sound
 * when the story earns it, never a rule to avoid common genres. A user hint
 * replaces it outright so the two can never pull against each other.
 */
export const NO_GENRE_HINT =
  'No genre was requested: choose the one that best serves the story, and if it fits the story, consider adding a secondary influence to the genre (e.g. folk ballad with a cinematic orchestral influence).';

/** Exported for tests. */
export function composeUserMessage(req: CowriteRequest, photoCard?: string): string {
  const parts: string[] = [];
  const isDrawing = req.photo?.source === 'drawing';
  if (photoCard) {
    parts.push(
      isDrawing
        ? `The song must be ABOUT this drawing the user made to show you their song. Songwriter's reference card for the drawing:\n${photoCard}`
        : `The song must be ABOUT this photo. Songwriter's reference card for the photo:\n${photoCard}`,
    );
  }
  const idea = req.idea.trim();
  if (idea) {
    parts.push(`User's idea:\n${idea}`);
  } else if (photoCard) {
    parts.push(`No text idea was given — choose the strongest song angle from the ${isDrawing ? 'drawing' : 'photo'} card.`);
  } else {
    parts.push('No idea was given — write an original song of your choosing.');
  }
  const controls: string[] = [];
  controls.push(`Target length: about ${Math.round(req.durationSec)} seconds — write lyrics that fill roughly that long. The render gets headroom beyond it, so do not pad or cut to fit exactly.`);
  if (req.instrumental) {
    controls.push(
      `INSTRUMENTAL: no vocals at all. Say "Instrumental, no vocals" in Vocal Details. The lyrics are EXACTLY these tags, in this order, nothing else:\n${instrumentalSkeleton(req.durationSec)}\nWrite the Arrangement as one distinct section per tag, in order — give each its own musical event (an instrument enters or leaves, the lead changes hands, a phrase is stated then varied) so the piece evolves instead of looping. Keep each section's description to one or two short sentences.`,
    );
  } else if (req.vocalPref === 'female') controls.push('Lead vocal: female.');
  else if (req.vocalPref === 'male') controls.push('Lead vocal: male.');
  if (req.genreHint?.trim()) controls.push(`Genre / mood hint: ${req.genreHint.trim()}.`);
  else controls.push(NO_GENRE_HINT);
  if (req.language?.trim() && !/^english$/i.test(req.language.trim())) {
    controls.push(`Lyrics language: ${req.language.trim()} (keep the section tags and the caption in English).`);
  }
  parts.push(`Controls:\n- ${controls.join('\n- ')}`);
  parts.push('Write the complete song package now and return JSON.');
  return parts.join('\n\n');
}

function parseJson(raw: string): Partial<ComposeJson> {
  let s = raw.trim();
  s = s.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
  try {
    return JSON.parse(s) as Partial<ComposeJson>;
  } catch {
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1)) as Partial<ComposeJson>;
      } catch {
        /* fall through */
      }
    }
    throw new Error(`The songwriter did not return valid JSON: ${s.slice(0, 200)}`);
  }
}

function normalize(j: Partial<ComposeJson>): ComposeJson {
  const caption = stripMarkdown(String(j.caption ?? ''))
    // Ensure each heading starts its own paragraph.
    .replace(/\s*(Vocal Details\s*:)/i, '\n\n$1')
    .replace(/\s*(Arrangement\s*:)/i, '\n\n$1')
    .trim();
  const lyrics = String(j.lyrics ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s+/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title: String(j.title ?? '').replace(/^["']|["']$/g, ''),
    caption,
    lyrics,
    notes: j.notes ? String(j.notes) : undefined,
  };
}

/** The instrumental tag sequence is the app's contract, not a creative choice — never trust the model to have copied it faithfully. */
function enforceSkeleton(parsed: ComposeJson, req: CowriteRequest): ComposeJson {
  return req.instrumental ? { ...parsed, lyrics: instrumentalSkeleton(req.durationSec) } : parsed;
}

function lint(parsed: ComposeJson, req: CowriteRequest): LintIssue[] {
  const spec = { instrumental: req.instrumental, vocalPref: req.vocalPref, targetSec: req.durationSec, durationSec: renderCap(req.durationSec, parsed.lyrics) };
  return [...lintCaption(parsed.caption, spec), ...lintLyrics(parsed.lyrics, parsed.caption, spec)];
}
