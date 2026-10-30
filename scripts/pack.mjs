// 一键打包（便携版）：electron-packager 直接对仓库根打包，忽略开发资产。
//
// 三个坑（都踩过）：
//   1. `--ignore` 用「路径片段」写法（tmp|dist|harness|docs）会误伤依赖——
//      node_modules/pixi.js/dist/ 与引擎的 dist/ 都被排掉，打出来的应用窗口全黑，
//      控制台报 Failed to fetch dynamically imported module: /vendor8/pixi.js/dist/pixi.mjs。
//      所以这里改成函数判定：**只看仓库根下的第一段**。
//   2. 不要先拷到中转目录再打包：依赖遍历器（flora-colossus）在「带 node_modules 的外置目录」上
//      解析不到自己的包，会报 Failed to locate module。直接在根目录打最稳。
//   3. 打完必须自检关键 vendor 文件在不在（见 assertVendor），别让黑窗口流到桌面。
import { rm, stat, access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist')
const APP_NAME = 'Live2DStage'
const ELECTRON_VERSION = '33.4.11'

// 仓库根下这些目录不打进应用；node_modules 里的同名段落一律保留
const ROOT_ONLY_SKIP = new Set(['tmp', 'dist', 'harness', 'docs', '.git', '.agent-presets'])

// packager 传进来的是「相对仓库根、带前导 / 的 posix 路径」，如 /node_modules/pixi.js/dist/pixi.mjs
const ignore = (rel) => {
  const first = rel.replace(/^\/+/, '').split('/')[0]
  return ROOT_ONLY_SKIP.has(first)
}

// 打完自检：这些文件缺一个，应用就是黑窗口
const VENDOR = [
  'vendor/live2dcubismcore.min.js',
  'node_modules/pixi.js/dist/pixi.mjs',
  'node_modules/untitled-pixi-live2d-engine/dist/cubism.es.js',
  'node_modules/@pixi/sound/lib/index.mjs',
  'app/index.html',
  'src/server/stage-server.mjs',
]

async function main() {
  const appDir = path.join(OUT, `${APP_NAME}-win32-x64`)
  await rm(appDir, { recursive: true, force: true })

  // Cubism Core 是专有二进制：允许随本地构建分发到本机，但不进仓库（vendor/ 已 gitignore）
  try { await access(path.join(ROOT, 'vendor', 'live2dcubismcore.min.js')) } catch {
    console.warn('[pack] 警告：vendor/live2dcubismcore.min.js 不存在，打出来的应用会提示缺少 Cubism Core')
  }

  await packager({
    dir: ROOT,
    name: APP_NAME,
    out: OUT,
    overwrite: true,
    platform: 'win32',
    arch: 'x64',
    electronVersion: ELECTRON_VERSION,
    electronZipDir: path.join(ROOT, 'tmp'),
    asar: false,
    prune: false,
    ignore,
  })

  // 应用在包里的真实位置是 resources/app/（asar=false）
  const appRoot = path.join(appDir, 'resources', 'app')
  let missing = VENDOR
  for (let i = 0; i < 20; i++) {
    missing = []
    for (const rel of VENDOR) {
      try { await access(path.join(appRoot, rel)) } catch { missing.push(rel) }
    }
    if (!missing.length) break
    await new Promise((r) => setTimeout(r, 1000))
  }
  if (missing.length) {
    console.error('\n[pack] 自检失败，缺少：\n  ' + missing.join('\n  '))
    process.exit(1)
  }

  console.log(`\n[pack] 自检通过（${VENDOR.length} 个关键文件齐）`)
  console.log(`[pack] 完成：${path.join(appDir, `${APP_NAME}.exe`)}`)
}

main().catch((e) => {
  console.error('[pack] 失败', e)
  process.exit(1)
})
