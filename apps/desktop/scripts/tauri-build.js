#!/usr/bin/env node
/**
 * Запускает tauri build с PATH, в котором есть cargo (Rust).
 * Локально: добавляет ~/.cargo/bin, если cargo ещё не в PATH.
 * В CI: использует текущий PATH (Rust уже установлен).
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

function cargoInPath() {
  try {
    execSync('cargo --version', { stdio: 'ignore', env: process.env });
    return true;
  } catch {
    return false;
  }
}

let newPath = process.env.PATH || '';
if (!cargoInPath()) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const cargoBin = home ? path.join(home, '.cargo', 'bin') : '';
  const cargoPath = cargoBin ? path.join(cargoBin, 'cargo') : '';
  if (cargoBin && fs.existsSync(cargoPath)) {
    newPath = `${cargoBin}${path.delimiter}${newPath}`;
  } else {
    console.error('Rust не найден. Установите: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh');
    process.exit(1);
  }
}

const env = { ...process.env, PATH: newPath, CI: 'false' };
const args = process.argv.slice(2);

execSync(`npx tauri build ${args.join(' ')}`, {
  cwd: path.resolve(__dirname, '..'),
  env,
  stdio: 'inherit',
});
