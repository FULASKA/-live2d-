#!/usr/bin/env node
/**
 * stage-cli —— agent / 脚本用的命令行入口。
 *
 * 舞台启动时会把「端口 + token」写到 ~/.dsh/live2d/endpoint.json，
 * 这里读它、发 HTTP，不需要记端口，也不用把 token 写进命令历史。
 *
 * 用法（都在仓库根目录跑）：
 *   node tools/stage-cli.mjs status
 *   node tools/stage-cli.mjs say 我回来啦 --ms 3000 --state success
 *   node tools/stage-cli.mjs expr 笑
 *   node tools/stage-cli.mjs pose 竖手指 --ms 2000
 *   node tools/stage-cli.mjs look 0.6 -0.3 --ms 2000
 *   node tools/stage-cli.mjs idle 伸懒腰
 *   node tools/stage-cli.mjs idle pause --ms 8000
 *   node tools/stage-cli.mjs state working --task "读文件"
 *   node tools/stage-cli.mjs stop expression
 *   node tools/stage-cli.mjs feedback --since 0
 *   node tools/stage-cli.mjs raw '{"action":{"kind":"say","text":"hi"}}'
 *
 * 退出码：0 成功；1 舞台没开/请求失败；2 用法错误。
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

const ENDPOINT = path.join(homedir(), '.dsh', 'live2d', 'endpoint.json')
const TIMEOUT = 8000

const argv = process.argv.slice(2)
const cmd = argv.shift() || 'status'

/** 位置参数 + --flag 值（不写值 = true） */
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

const num = (v, d = 0) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

function usage(msg) {
  console.error(msg)
  console.error('用法：node tools/stage-cli.mjs <status|say|expr|pose|look|idle|state|stop|feedback|raw> [...]')
  process.exit(2)
}

async function endpoint() {
  try {
    const ep = JSON.parse(await readFile(ENDPOINT, 'utf8'))
    if (!ep?.url || !ep?.token) throw new Error('endpoint.json 缺 url/token')
    return ep
  } catch (e) {
    console.error(`舞台没开？读不到 ${ENDPOINT}（${e.message}）`)
    process.exit(1)
  }
}

async function call(ep, method, apiPath) {
  const res = await fetch(ep.url + apiPath, {
    method,
    headers: { 'x-stage-token': ep.token, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new Error(`${res.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

async function action(ep, act, extra = {}) {
  const res = await fetch(ep.url + '/api/action', {
    method: 'POST',
    headers: { 'x-stage-token': ep.token, 'content-type': 'application/json' },
    body: JSON.stringify({
      source: flags.source || 'agent',
      priority: flags.priority || 'NORMAL',
      fade: num(flags.fade, 0.3),
      ttlMs: num(flags.ttl, 0),
      ...extra,
      action: act,
    }),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`)
  return data
}

const ep = await endpoint()
let out = null

try {
  switch (cmd) {
    case 'status':
      out = await call(ep, 'GET', '/api/state')
      break

    case 'say': {
      const text = pos.join(' ')
      if (!text) usage('say 需要一句话')
      out = await action(ep, { kind: 'say', text, ms: num(flags.ms, 0), state: flags.state || 'idle' })
      break
    }

    case 'expr': {
      const name = pos[0]
      if (!name) usage('expr 需要表情名（清除用 expr -）')
      out = await action(ep, { kind: 'expression', name: name === '-' ? null : name })
      break
    }

    case 'pose': {
      const name = pos[0]
      if (!name) usage('pose 需要姿势名（放下用 pose -）')
      out = await action(ep, { kind: 'pose', name: name === '-' ? null : name, ms: num(flags.ms, 320) })
      break
    }

    case 'look': {
      if (pos.length < 2) usage('look 需要两个归一化坐标（-1..1）')
      out = await action(ep, { kind: 'look', x: num(pos[0]), y: num(pos[1]), ms: num(flags.ms, 2500) })
      break
    }

    case 'idle': {
      const mode = pos[0] || 'play'
      if (mode === 'pause') out = await action(ep, { kind: 'idle', mode: 'pause', ms: num(flags.ms, 5000) })
      else if (mode === 'resume') out = await action(ep, { kind: 'idle', mode: 'resume' })
      else out = await action(ep, { kind: 'idle', mode: 'play', name: mode === 'play' ? undefined : mode })
      break
    }

    case 'state': {
      const st = pos[0]
      if (!st) usage('state 需要状态（thinking/working/waiting/success/error/idle）')
      out = await action(ep, { kind: 'state', state: ['idle', 'none', 'null'].includes(st) ? null : st, task: flags.task })
      break
    }

    case 'stop':
      out = await action(ep, { kind: 'stop', scope: pos[0] || 'all' })
      break

    case 'feedback': {
      const since = num(flags.since, 0)
      const data = await call(ep, 'GET', `/api/feedback?since=${since}`)
      const n = num(flags.n, 20)
      out = { seq: data.seq, feedback: (data.feedback || []).slice(-n) }
      break
    }

    case 'raw': {
      const raw = pos.join(' ')
      if (!raw) usage('raw 需要一段 JSON')
      let body
      try { body = JSON.parse(raw) } catch (e) { usage(`raw 不是合法 JSON：${e.message}`) }
      out = await action(ep, body.action || body, { ttlMs: body.ttlMs })
      break
    }

    default:
      usage(`不认识的动作：${cmd}`)
  }
  console.log(JSON.stringify(out, null, 2))
} catch (e) {
  console.error(`失败：${e.message}`)
  process.exit(1)
}
