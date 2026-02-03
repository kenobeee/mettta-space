#!/usr/bin/env node
/**
 * Runs tsc and vite from project node_modules (works with npm workspaces in CI).
 * Prepend workspace and root node_modules/.bin to PATH so the right tsc/vite are used.
 */
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const localBin = path.join(root, 'node_modules', '.bin');
const rootBin = path.resolve(root, '..', '..', 'node_modules', '.bin');
const pathEnv = [localBin, rootBin, process.env.PATH].filter(Boolean).join(path.delimiter);

execSync('tsc -b && vite build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PATH: pathEnv },
});
