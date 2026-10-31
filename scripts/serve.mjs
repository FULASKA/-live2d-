// 开发版 Stage 服务器：CLI 入口。真正的实现放在 src/server/stage-server.mjs（Electron 壳共用）。
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createStageServer } from '../src/server/stage-server.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}

const PORT = Number(arg('port', 53180))
const TOKEN = arg('token', 'dev-token')
const MODEL = arg('model', process.env.STAGE_MODEL || '')
const VERBOSE = process.argv.includes('--log')
if (!MODEL) {
  console.error('缺少模型路径：用 --model "D:\\模型\\xxx.model3.json" 或环境变量 STAGE_MODEL 指定')
  process.exit(2)
}

const srv = await createStageServer({ root: ROOT, model: MODEL, token: TOKEN, verbose: VERBOSE, port: PORT })
const cap = srv.capabilities
console.log(JSON.stringify({
  ready: true, port: srv.port, pid: process.pid, model: cap?.model.name || null,
  capabilities: cap ? { params: cap.params.length, motions: cap.motions.length, expressions: cap.expressions.length } : null,
}))
console.log(`[stage] ${srv.url}/harness/  token=${TOKEN}`)
console.log(`[stage] ${srv.url}/app/  （应用壳页面）`)
