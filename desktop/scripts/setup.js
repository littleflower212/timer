#!/usr/bin/env node
/**
 * 分步安装，避免 electron postinstall 卡住时无法重试
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIRROR = 'https://npmmirror.com/mirrors/electron/';

process.env.ELECTRON_MIRROR = MIRROR;
process.env.electron_config_cache = path.join(ROOT, '.electron-cache');

const pm = fs.existsSync(path.join(ROOT, 'pnpm-lock.yaml')) ? 'pnpm' : 'npm';

function run(cmd) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: process.env });
}

console.log('使用镜像:', MIRROR);
console.log('包管理器:', pm);

run(`${pm} install electron-store`);

console.log('\n正在下载 Electron（约 100MB，使用国内镜像）...');
run(`${pm} install electron@28.3.3 --save-dev`);

console.log('\n✓ 安装完成！运行以下命令启动：');
console.log(`  cd ${ROOT}`);
console.log('  pnpm start   # 或 npm start');
