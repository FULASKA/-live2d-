// 取 Cubism Core 到 vendor/（专有许可，不入库、不随包分发）
// 用法: node scripts/fetch-core.mjs [镜像URL]
import { mkdir, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'vendor', 'live2dcubismcore.min.js')
const URLS = [
  process.argv[2],
  'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
].filter(Boolean)

const exists = await stat(OUT).then((s) => s.size > 1000).catch(() => false)
if (exists) { console.log('already present:', OUT); process.exit(0) }

for (const u of URLS) {
  try {
    console.log('fetching', u)
    const r = await fetch(u)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length < 1000) throw new Error('suspiciously small')
    await mkdir(path.dirname(OUT), { recursive: true })
    await writeFile(OUT, buf)
    console.log('saved', OUT, buf.length, 'bytes')
    process.exit(0)
  } catch (e) { console.warn('  failed:', e.message) }
}
console.error(`
全部失败。请手动处理：
  1) 打开 https://www.live2d.com/en/sdk/download/web/
  2) 下载 Cubism SDK for Web，取出 CubismCore/live2dcubismcore.min.js
  3) 放到 ${OUT}
（该文件为 Live2D 专有许可，不能随本项目分发）
`)
process.exit(1)
