#!/usr/bin/env node
/**
 * Собирает веб-приложение из корня монорепозитория.
 * Вызывается из desktop/ перед tauri build.
 */
const path = require('path');
const { execSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../../..');
execSync('npm run build:web', { cwd: repoRoot, stdio: 'inherit' });
