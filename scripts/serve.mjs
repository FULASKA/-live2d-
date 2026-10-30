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
const MODEL = arg('model', 'C:/Users/33153/Desktop/DeepSeek免费公皮/DeepSeek/大肥鱼.model3.json')
const VERBOSE = process.argv.includes('--log')

const srv = await createStageServer({ root: ROOT, model: MODEL, token: TOKEN, verbose: VERBOSE, port: PORT })
const cap = srv.capabilities
console.log(JSON.stringify({
  ready: true, port: srv.port, pid: process.pid, model: cap?.model.name || null,
  capabilities: cap ? { params: cap.params.length, motions: cap.motions.length, expressions: cap.expressions.length } : null,
}))
console.log(`[stage] ${srv.url}/harness/  token=${TOKEN}`)
console.log(`[stage] ${srv.url}/app/  （应用壳页面）`)
