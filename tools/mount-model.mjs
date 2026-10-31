#!/usr/bin/env node
/**
 * mount-model —— 脚本化「挂载模型」：校验 .model3.json 并把路径写进设置文件。
 *
 * 为什么不靠 GUI：弹窗选择在不同机器/自动化环境里不稳定，
 * 写一份确定的 settings.json 才是可复现的挂载方式。
 *
 * 用法：
 *   node tools/mount-model.mjs "D:\模型\大肥鱼.model3.json"
 *   node tools/mount-model.mjs "..." --home "D:\便携配置"
 *
 * 退出码：0 成功；1 模型不完整；2 用法错误。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const argv = process.argv.slice(2)
const flags = {}
const pos = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const k = a.slice(2)
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
    flags[k] = v
  } else pos.push(a)
}

const modelArg = pos[0]
if (!modelArg) {
  console.error('用法：node tools/mount-model.mjs <路径\\xxx.model3.json> [--home <配置目录>]')
  process.exit(2)
}
const model = path.resolve(modelArg)
if (!existsSync(model)) {
  console.error(`[mount] 找不到模型文件：${model}`)
  process.exit(1)
}

/** 校验 model3.json 引用的 moc3 / 贴图是否齐全（缺文件在别的机器上就是黑屏） */
function validate(file) {
  const dir = path.dirname(file)
  let json
  try { json = JSON.parse(readFileSync(file, 'utf8')) } catch (e) {
    return { ok: false, error: `model3.json 不是合法 JSON：${e.message}` }
  }
  const fr = json.FileReferences || {}
  const missing = []
  const check = (p) => { if (!p) return; const abs = path.resolve(dir, p); if (!existsSync(abs)) missing.push(p) }
  check(fr.Moc)
  check(fr.Physics)
  check(fr.DisplayInfo)
  for (const t of fr.Textures || []) check(t)
  for (const e of fr.Expressions || []) check(e.File)
  for (const group of Object.values(fr.Motions || {})) for (const x of group) check(x.File)
  return { ok: missing.length === 0, missing, dir }
}

const v = validate(model)
if (!v.ok && v.error) {
  console.error(`[mount] ${v.error}`)
  process.exit(1)
}

const home = flags.home || process.env.STAGE_HOME || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'live2d-stage')
mkdirSync(home, { recursive: true })
const file = path.join(home, 'settings.json')
let settings = {}
try { settings = JSON.parse(readFileSync(file, 'utf8')) } catch {}
settings.model = model
writeFileSync(file, JSON.stringify(settings, null, 2))

console.log(`[mount] 模型：${model}`)
console.log(`[mount] 配置：${file}`)
if (v.missing?.length) {
  console.warn(`[mount] 警告：缺少 ${v.missing.length} 个引用文件，角色可能显示不全：`)
  for (const m of v.missing.slice(0, 10)) console.warn('  - ' + m)
  process.exit(1)
}
console.log('[mount] 校验通过 ✅')
