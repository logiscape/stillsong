import React from 'react';
import { createRoot } from 'react-dom/client';
import { Engine } from '@engine/index';
import { createTauriPorts } from '@adapters/tauriPorts';
import { bootstrap, setError } from '@state/store';
import { App } from './App';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);

void (async () => {
  try {
    const ports = await createTauriPorts();
    const engine = await Engine.create(ports);
    await bootstrap(engine);
  } catch (err) {
    setError(`Engine failed to start: ${err instanceof Error ? err.message : String(err)}`);
  }
})();
