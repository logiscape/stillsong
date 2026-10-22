// Where the app opens, decided by the supervisor's view of the installed
// components (not by the SQLite flag: a build that changed its manifest must
// never reach the studio screens against components from another build).

import type { InstallState } from '@engine/ports';
import type { Screen } from './store';

export function routeForBoot(install: InstallState): Screen {
  switch (install.state) {
    case 'ready':
      return 'create';
    case 'not-installed':
      return 'setup';
    case 'needs-update':
    case 'updating':
      return 'update';
  }
}
