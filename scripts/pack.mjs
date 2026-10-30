// 一键打包：把「运行所需」拷到干净目录 → 只装生产依赖 → electron-packager 出便携版。
//
// 为什么要中转目录：直接对仓库打包会把 tmp/（截图、Electron 压缩包）、harness/ 验证台、
// docs/ 全塞进 resources/app，产物从 360MB 涨到 740MB。中转目录只带 app/src/scripts/vendor。
import { rm, mkdir, cp, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STAGE = path.join(ROOT, 'tmp', 'pkg-root')
const OUT = path.join(ROOT, 'dist')
const APP_NAME = 'Live2DStage'
const ELECTRON_VERSION = '33.4.11'

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

async function main() {
  await rm(STAGE, { recursive: true, force: true })
  await rm(path.join(OUT, `${APP_NAME}-win32-x64`), { recursive: true, force: true })
  await mkdir(STAGE, { recursive: true })

  for (const item of ['app', 'src', 'scripts', 'vendor', 'package.json']) {
    await cp(path.join(ROOT, item), path.join(STAGE, item), { recursive: true })
  }

  // Cubism Core 是专有二进制：允许随本地构建分发到本机，但不进仓库（vendor/ 已在 .gitignore）
  try { await stat(path.join(STAGE, 'vendor', 'live2dcubismcore.min.js')) } catch {
    console.warn('[pack] 警告：vendor/live2dcubismcore.min.js 不存在，打包出来的应用启动会报「缺少 Cubism Core」')
  }

  // 只装生产依赖；Electron 由打包器自己带，不进 resources/app
  run(npm, ['install', '--omit=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmmirror.com'], STAGE)

  run(npx, [
    '@electron/packager', STAGE, APP_NAME,
    '--platform=win32', '--arch=x64',
    '--out', OUT, '--overwrite',
    `--electron-version=${ELECTRON_VERSION}`,
    '--electron-zip-dir', path.join(ROOT, 'tmp'),
    '--asar=false',
  ], ROOT)

  console.log(`\n[pack] 完成：${path.join(OUT, `${APP_NAME}-win32-x64`, `${APP_NAME}.exe`)}`)
}

main().catch((e) => {
  console.error('[pack] 失败', e)
  process.exit(1)
})
