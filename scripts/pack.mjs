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
import { rm, stat, access, cp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'dist')
const APP_NAME = '大肥鱼Live2d桌宠'
// 完整版内置模型；发布版不含模型（原作者禁止二次分发）
const MODEL_SRC = process.env.STAGE_MODEL_SRC || 'C:/Users/33153/Desktop/DeepSeek免费公皮/DeepSeek'
const ELECTRON_VERSION = '33.4.11'

// 仓库根下这些目录不打进应用；node_modules 里的同名段落一律保留
const ROOT_ONLY_SKIP = new Set(['tmp', 'dist', 'harness', 'docs', 'release', '.git', '.agent-presets'])

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
  'app/settings.html',
  'app/settings.js',
  'app/editor.html',
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
    prune: false,  // 下面手动删开发依赖：prune 在这个仓库上会失败，反而更大
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
  // 删掉只在开发期用的依赖（electron 本体 ~230MB、packager、puppeteer）
  for (const d of ['electron', '@electron', 'puppeteer-core', 'puppeteer', '@puppeteer', '.bin']) {
    await rm(path.join(appRoot, 'node_modules', d), { recursive: true, force: true })
  }
  console.log(`[pack] 完整版：${path.join(appDir, `${APP_NAME}.exe`)}`)

  // 把「挂载模型.cmd」放到 exe 旁边（用户可直接拖模型上去）
  try { await cp(path.join(ROOT, '挂载模型.cmd'), path.join(appDir, '挂载模型.cmd')) } catch {}

  // ① 完整版内置模型：放在 exe 旁边的 model/（相对路径，用户可直接替换/管理）
  try {
    await cp(MODEL_SRC, path.join(appDir, 'model'), { recursive: true })
    console.log('[pack] 已内置模型 →', path.join(appDir, 'model'))
  } catch (e) { console.warn('[pack] 模型拷贝失败：', e.message) }

  // ② 发布版：复制整包后删掉模型目录
  const pubDir = path.join(OUT, `${APP_NAME}-发布版-win32-x64`)
  await rm(pubDir, { recursive: true, force: true })
  await cp(appDir, pubDir, { recursive: true })
  await rm(path.join(pubDir, 'model'), { recursive: true, force: true })
  await rm(path.join(pubDir, 'resources', 'app', 'model'), { recursive: true, force: true })
  console.log(`[pack] 发布版（不含模型）：${path.join(pubDir, `${APP_NAME}.exe`)}`)
}

main().catch((e) => {
  console.error('[pack] 失败', e)
  process.exit(1)
})
