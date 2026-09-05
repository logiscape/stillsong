// Draw: a full-bleed, Paint-style canvas — tools down the left, color and
// width along the bottom, the white square in the middle of the gallery's
// dark ground. Submitting imports the drawing exactly like a chosen photo;
// the session (bitmap + undo history + tool state) survives leaving the
// screen so the drawing stays editable until the song is created.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { chooseDrawing, navigate } from '@state/store';
import { getPaintSession, setPaintSession, type ToolId } from '@state/paintSession';
import { Button } from '@ui/ds/Button';
import { IconButton } from '@ui/ds/IconButton';
import { Panel } from '@ui/ds/Panel';
import { Slider } from '@ui/ds/Slider';
import { ColorPicker } from './ColorPicker';
import { PaintCanvas } from './PaintCanvas';
import { PaintEngine } from './paintEngine';
import { PALETTE } from './palette';

const TOOLS: { id: ToolId; icon: string; label: string }[] = [
  { id: 'pencil', icon: 'pencil', label: 'Pencil' },
  { id: 'brush', icon: 'paintbrush', label: 'Brush' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'line', icon: 'slash', label: 'Line' },
  { id: 'rect', icon: 'square', label: 'Rectangle' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse' },
  { id: 'rect-fill', icon: 'square-filled', label: 'Filled rectangle' },
  { id: 'ellipse-fill', icon: 'circle-filled', label: 'Filled ellipse' },
  { id: 'fill', icon: 'paint-bucket', label: 'Fill' },
  { id: 'picker', icon: 'pipette', label: 'Pick a color' },
];

const DEFAULT_WIDTHS: Record<ToolId, number> = {
  pencil: 4, brush: 14, eraser: 30, line: 4, rect: 4, ellipse: 4,
  'rect-fill': 4, 'ellipse-fill': 4, fill: 4, picker: 4,
};

const FREEHAND: ToolId[] = ['pencil', 'brush', 'eraser'];

export function DrawScreen(): React.ReactElement {
  const engineRef = useRef<PaintEngine | null>(null);
  const [tool, setTool] = useState<ToolId>('pencil');
  const [color, setColor] = useState(PALETTE[0].hex);
  const [widths, setWidths] = useState<Record<ToolId, number>>(DEFAULT_WIDTHS);
  const [, setTick] = useState(0); // re-render on engine commits (canUndo/canRedo)
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** The tool to return to after an eyedropper pick. */
  const prevToolRef = useRef<ToolId>('pencil');

  // Latest UI state for the unmount save (cleanup closures go stale).
  const uiRef = useRef({ tool, color, widths });
  uiRef.current = { tool, color, widths };

  const saveSession = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { tool: t, color: c, widths: w } = uiRef.current;
    setPaintSession({ ...engine.snapshot(), tool: t, color: c, widths: w });
  }, []);

  const selectTool = useCallback((t: ToolId) => {
    const engine = engineRef.current;
    setTool((current) => {
      if (t === 'picker' && current !== 'picker') prevToolRef.current = current;
      return t;
    });
    if (engine) {
      engine.tool = t;
      engine.width = uiRef.current.widths[t];
    }
  }, []);

  const applyColor = useCallback((hex: string) => {
    setColor(hex);
    if (engineRef.current) engineRef.current.color = hex;
  }, []);

  const handleReady = useCallback((engine: PaintEngine) => {
    engineRef.current = engine;
    engine.onChange = () => setTick((n) => n + 1);
    engine.onPick = (hex) => {
      applyColor(hex);
      selectTool(prevToolRef.current);
    };
    const session = getPaintSession();
    if (session) {
      const w = { ...DEFAULT_WIDTHS, ...session.widths };
      setTool(session.tool);
      setColor(session.color);
      setWidths(w);
      engine.tool = session.tool;
      engine.color = session.color;
      engine.width = w[session.tool];
      void engine.restoreSnapshot(session);
    } else {
      engine.tool = uiRef.current.tool;
      engine.color = uiRef.current.color;
      engine.width = uiRef.current.widths[uiRef.current.tool];
    }
  }, [applyColor, selectTool]);

  // Session survives leaving the screen (back, submit, or any unmount).
  useEffect(() => () => saveSession(), [saveSession]);

  // The app's first keyboard shortcuts — scoped to this screen by mount.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (!ev.ctrlKey || ev.altKey) return;
      const k = ev.key.toLowerCase();
      if (k === 'z' && !ev.shiftKey) {
        ev.preventDefault();
        void engineRef.current?.undo();
      } else if (k === 'y' || (k === 'z' && ev.shiftKey)) {
        ev.preventDefault();
        void engineRef.current?.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = async () => {
    const engine = engineRef.current;
    if (!engine || submitting) return;
    setSubmitting(true);
    try {
      saveSession();
      await chooseDrawing(engine.toDataURL().split(',')[1]);
      navigate('create');
    } finally {
      setSubmitting(false);
    }
  };

  const engine = engineRef.current;
  const width = widths[tool];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--ground)' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '18px 22px' }}>
          <IconButton icon="chevron-left" label="Back to Create" variant="glass" onClick={() => navigate('create')} />
          <span style={{ font: 'var(--display-sm)', color: 'var(--ink-1)', letterSpacing: 'var(--tracking-display)' }}>
            Draw something
          </span>
          <div style={{ flex: 1 }} />
          <IconButton icon="trash-2" label="Clear canvas" variant="glass" onClick={() => engineRef.current?.clear()} />
          <Button variant="primary" icon="check" disabled={submitting} onClick={() => void submit()}>
            Use this drawing
          </Button>
        </div>

        <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
          {/* The padding lives on this wrapper, not on PaintCanvas: its
              ResizeObserver sizes the frame from its own border box, and
              padding there would let the frame overflow onto the chrome. */}
          <div style={{ position: 'absolute', inset: 0, padding: '0 96px 90px' }}>
            <PaintCanvas onReady={handleReady} cursor={FREEHAND.includes(tool) ? 'none' : 'crosshair'} />
          </div>

          <Panel
            variant="glass" pad={8}
            style={{
              position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            {TOOLS.map((t) => (
              <IconButton
                key={t.id} icon={t.icon} label={t.label} variant="ghost" active={tool === t.id}
                onClick={() => selectTool(t.id)}
                style={tool === t.id ? { background: 'var(--brass-wash)', border: '1px solid var(--brass-line)' } : undefined}
              />
            ))}
            <div style={{ height: 1, background: 'var(--line-2)', margin: '4px 6px' }} />
            <IconButton
              icon="undo-2" label="Undo (Ctrl+Z)" variant="ghost"
              onClick={engine?.canUndo ? () => void engineRef.current?.undo() : undefined}
              style={engine?.canUndo ? undefined : { opacity: 0.35, cursor: 'default' }}
            />
            <IconButton
              icon="redo-2" label="Redo (Ctrl+Y)" variant="ghost"
              onClick={engine?.canRedo ? () => void engineRef.current?.redo() : undefined}
              style={engine?.canRedo ? undefined : { opacity: 0.35, cursor: 'default' }}
            />
          </Panel>

          <Panel
            variant="glass" pad="10px 16px"
            style={{
              position: 'absolute', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 41,
              display: 'flex', alignItems: 'center', gap: 'var(--space-5)', maxWidth: 'calc(100% - 44px)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <Slider value={width} min={1} max={64} onChange={(v) => {
                setWidths((w) => ({ ...w, [tool]: v }));
                if (engineRef.current) engineRef.current.width = v;
              }} label="Stroke width" width={110} />
              <span style={{ font: 'var(--mono-sm)', color: 'var(--text-quiet)', width: 20, textAlign: 'right' }}>{width}</span>
            </div>
            <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line-2)' }} />
            <span
              title="Current color"
              style={{
                width: 26, height: 26, borderRadius: 'var(--radius-sm)', background: color,
                border: '1px solid var(--border-strong)', flex: '0 0 auto',
              }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, maxWidth: 380 }}>
              {PALETTE.map((c) => (
                <button
                  key={c.hex} type="button" title={c.name} onClick={() => applyColor(c.hex)}
                  style={{
                    width: 18, height: 18, borderRadius: 'var(--radius-xs)', background: c.hex, cursor: 'pointer',
                    border: '1px solid var(--border-hairline)',
                    outline: color === c.hex ? '2px solid var(--brass-300)' : 'none', outlineOffset: 1,
                  }}
                />
              ))}
            </div>
            <IconButton
              icon="palette" label="More colors" variant="ghost" size={32} active={pickerOpen}
              onClick={() => setPickerOpen((o) => !o)}
            />
          </Panel>

          {pickerOpen && (
            <>
              {/* Click-away catcher: covers the canvas region, leaves the top chrome live. */}
              <div style={{ position: 'absolute', inset: 0, zIndex: 40 }} onPointerDown={() => setPickerOpen(false)} />
              <div style={{ position: 'absolute', left: '50%', bottom: 84, transform: 'translateX(-50%)', zIndex: 41 }}>
                <ColorPicker color={color} onChange={applyColor} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
