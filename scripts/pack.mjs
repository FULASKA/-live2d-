// 一键打包（便携版）：electron-packager 直接对仓库根打包，忽略开发资产。
//
// 两个坑（都踩过）：
//   1. --ignore 的正则在 Windows 上是相对绝对路径做匹配的，`^/tmp` 这种「根相对」写法不生效，
//      要用能命中路径片段的形式（tmp|dist|harness|docs）。
//   2. 不要先拷到中转目录再打包：依赖遍历器（flora-colossus）在「带 node_modules 的外置目录」上
//      解析不到自己的包，会报 Failed to locate module。直接在根目录打最稳。
import { rm, stat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist')
const APP_NAME = 'Live2DStage'
const ELECTRON_VERSION = '33.4.11'
const IGNORE = 'tmp|dist|harness|docs|\\.git'

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })

async function main() {
  await rm(path.join(OUT, `${APP_NAME}-win32-x64`), { recursive: true, force: true })

  // Cubism Core 是专有二进制：允许随本地构建分发到本机，但不进仓库（vendor/ 已 gitignore）
  try { await stat(path.join(ROOT, 'vendor', 'live2dcubismcore.min.js')) } catch {
    console.warn('[pack] 警告：vendor/live2dcubismcore.min.js 不存在，打出来的应用会提示缺少 Cubism Core')
  }

  run(process.execPath, [
    path.join(ROOT, 'node_modules', '@electron', 'packager', 'bin', 'electron-packager.mjs'),
    '.', APP_NAME,
    '--platform=win32', '--arch=x64',
    '--out', OUT, '--overwrite',
    `--electron-version=${ELECTRON_VERSION}`,
    '--electron-zip-dir', path.join(ROOT, 'tmp'),
    '--asar=false',
    `--ignore=${IGNORE}`,
  ], ROOT)

  console.log(`\n[pack] 完成：${path.join(OUT, `${APP_NAME}-win32-x64`, `${APP_NAME}.exe`)}`)
}

main().catch((e) => {
  console.error('[pack] 失败', e)
  process.exit(1)
})
