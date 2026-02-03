#!/usr/bin/env node
/**
 * Runs tsc and vite from project node_modules by path (works in npm workspaces + CI).
 */
import { execSync } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(path.join(root, 'package.json'));

const tscPath = require.resolve('typescript/bin/tsc');
const vitePkgDir = path.dirname(require.resolve('vite/package.json'));
const viteBin = path.join(vitePkgDir, 'bin/vite.js');

execSync(`node "${tscPath}" -b`, { cwd: root, stdio: 'inherit' });
execSync(`node "${viteBin}" build`, { cwd: root, stdio: 'inherit' });
