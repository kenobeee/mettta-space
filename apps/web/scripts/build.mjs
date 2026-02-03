#!/usr/bin/env node
/**
 * Runs tsc and vite from project node_modules (works in npm workspaces + CI).
 * Tries web's node_modules first, then repo root (hoisted).
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const repoRoot = path.resolve(root, '..', '..');

function findTsc() {
  const candidates = [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    path.join(repoRoot, 'node_modules/typescript/bin/tsc'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('typescript not found. Tried: ' + candidates.join(', '));
  return found;
}

function findVite() {
  const candidates = [
    path.join(root, 'node_modules/vite/bin/vite.js'),
    path.join(repoRoot, 'node_modules/vite/bin/vite.js'),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('vite not found. Tried: ' + candidates.join(', '));
  return found;
}

const tscPath = findTsc();
const viteBin = findVite();

execSync(`node "${tscPath}" -b`, { cwd: root, stdio: 'inherit' });
execSync(`node "${viteBin}" build`, { cwd: root, stdio: 'inherit' });
