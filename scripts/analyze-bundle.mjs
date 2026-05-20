// scripts/analyze-bundle.mjs
//
// Wraps `npm run build` with ANALYZE=true so rollup-plugin-visualizer
// kicks in and writes dist/bundle-stats.html. Cross-platform — works
// from PowerShell, bash, zsh, GitHub Actions, etc. without needing
// `cross-env` as a dependency just for one ergonomic script.
//
// Use: `npm run analyze`

import { spawn } from 'node:child_process';

// `shell: true` is required on Windows to resolve `npm` from PATH —
// otherwise EINVAL on Node 20+. Safe to enable cross-platform; we only
// pass a hardcoded literal (no user input) to spawn so shell injection
// isn't a concern.
const child = spawn('npm', ['run', 'build'], {
  env: { ...process.env, ANALYZE: 'true' },
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  if (code === 0) {
    console.log('\n[analyze] Build complete. Open dist/bundle-stats.html in a browser to inspect chunks.');
  }
  process.exit(code ?? 1);
});
