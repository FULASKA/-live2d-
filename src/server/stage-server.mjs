/**
 * Stage 静态服务 + 能力清单 + ActionBus（开发版实现）。
 *
 * 抽成模块的动机：开发期由 `scripts/serve.mjs` 用 node 直跑；正式形态是 Electron 壳内置同一个服务
 * （窗口加载 http://127.0.0.1:<port>/app/），两条路径共用这一份路由，避免行为漂移。
 *
 * 边界：这里只提供 PROTOCOL.md 承诺的接口面（/api/*、/m/*、静态），不碰渲染。
 */
import { createServer } from 'node:http'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.moc3': 'application/octet-stream', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.psd': 'image/vnd.adobe.photoshop',
}

const PRIORITY = { BACKGROUND: 6, NORMAL: 4, FORCE: 2 }

/** 宽容解码：非法百分号序列原样保留，绝不抛错（裸 UTF-8 路径会让 decodeURIComponent 抛 URIError） */
function safeDecode(s) {
  try { return decodeURIComponent(s) } catch {
    return s.replace(/%[0-9a-fA-F]{0,2}/g, (m) => { try { return decodeURIComponent(m) } catch { return m } })
  }
}

export async function createStageServer({
  root,
  model,
  token = 'dev-token',
  verbose = false,
  host = '127.0.0.1',
  port = 0,
} = {}) {
  if (!root) throw new Error('createStageServer 缺少 root')
  if (!model) throw new Error('createStageServer 缺少 model（model3.json 路径）')
  const MODEL = path.resolve(model)
  const MODEL_DIR = path.dirname(MODEL)
  const MODEL_FILE = path.basename(MODEL)

  // ---------- 静态扫描：把模型文件读成「能力清单」 ----------
  let cache = null
  async function scan() {
    if (cache) return cache
    const raw = JSON.parse(await readFile(MODEL, 'utf8'))
    const fr = raw.FileReferences || {}
    const cap = { model: { name: path.basename(MODEL, '.model3.json'), file: MODEL_FILE, raw }, params: [], groups: [], parts: [], motions: [], expressions: [] }

    if (fr.DisplayInfo) {
      try {
        const cdi = JSON.parse(await readFile(path.join(MODEL_DIR, fr.DisplayInfo), 'utf8'))
        cap.params = (cdi.Parameters || []).map((p) => ({ id: p.Id, name: p.Name || p.Id, group: p.GroupId || null }))
        cap.groups = (cdi.ParameterGroups || []).map((g) => ({ id: g.Id, name: g.Name || g.Id }))
        cap.parts = (cdi.Parts || []).map((p) => ({ id: p.Id, name: p.Name || p.Id }))
      } catch (e) { console.warn('[scan] cdi3:', e.message) }
    }

    for (const sub of ['Animation', 'Motions', 'motions']) {
      let files = []
      try { files = (await readdir(path.join(MODEL_DIR, sub))).filter((f) => f.endsWith('.motion3.json')) } catch { continue }
      for (const f of files.sort()) {
        try {
          const j = JSON.parse(await readFile(path.join(MODEL_DIR, sub, f), 'utf8'))
          const meta = j.Meta || {}
          cap.motions.push({
            group: /^idle/i.test(f) ? 'Idle' : 'Action',
            name: f.replace('.motion3.json', ''),
            file: `${sub}/${f}`,
            duration: meta.Duration ?? null,
            loop: Boolean(meta.Loop),
            params: [...new Set((j.Curves || []).filter((c) => c.Target === 'Parameter').map((c) => c.Id))],
          })
        } catch (e) { console.warn('[scan] motion', f, e.message) }
      }
    }

    for (const sub of ['Exp3', 'Expressions', 'expressions']) {
      let files = []
      try { files = (await readdir(path.join(MODEL_DIR, sub))).filter((f) => f.endsWith('.exp3.json')) } catch { continue }
      for (const f of files.sort()) {
        try {
          const j = JSON.parse(await readFile(path.join(MODEL_DIR, sub, f), 'utf8'))
          cap.expressions.push({ name: f.replace('.exp3.json', ''), file: `${sub}/${f}`, params: j.Parameters || [] })
        } catch (e) { console.warn('[scan] exp', f, e.message) }
      }
    }

    cap.textures = fr.Textures || []
    cache = cap
    return cap
  }

  /** 原 model3.json 没注册动作/表情；这里在响应时注入，绝不改用户模型目录。 */
  function patchModel(cap) {
    const raw = cap.model.raw
    const fr = { ...(raw.FileReferences || {}) }
    const groups = {}
    for (const m of cap.motions) (groups[m.group] ||= []).push({ File: m.file, FadeInTime: 0.4, FadeOutTime: 0.4 })
    fr.Motions = groups
    fr.Expressions = cap.expressions.map((e) => ({ Name: e.name, File: e.file }))
    return { ...raw, FileReferences: fr }
  }

  // ---------- ActionBus（开发版：只记日志 + 计算生效优先级） ----------
  const LOG = []
  const events = []
  function acceptAction(body) {
    const id = body.id || crypto.randomUUID()
    const pri = body.priority || 'NORMAL'
    const rec = { id, ts: Date.now(), source: body.source || 'script', priority: pri, action: body.action, ttlMs: body.ttlMs || 0 }
    LOG.unshift(rec)
    LOG.length = Math.min(LOG.length, 200)
    emit({ type: 'action', id, phase: 'start' })
    if (rec.ttlMs > 0) setTimeout(() => emit({ type: 'action', id, phase: 'end', reason: 'ttl' }), rec.ttlMs)
    return { accepted: true, id, effectivePriority: pri, interrupted: null, rank: PRIORITY[pri] ?? 4 }
  }
  function emit(ev) {
    events.push(ev)
    events.length = Math.min(events.length, 200)
    if (verbose) console.log('[event]', JSON.stringify(ev))
  }

  // ---------- HTTP ----------
  const json = (res, code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(obj))
  }
  const auth = (req) => {
    const t = req.headers['x-stage-token'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    return t === token
  }
  async function body(req) {
    const chunks = []
    for await (const c of req) chunks.push(c)
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  }
  async function serveFile(res, abs, extraHeaders = {}) {
    try {
      const st = await stat(abs)
      if (!st.isFile()) return false
      const buf = await readFile(abs)
      res.writeHead(200, {
        'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'content-length': buf.length, 'cache-control': 'no-store', ...extraHeaders,
      })
      res.end(buf)
      return true
    } catch { return false }
  }

  let server
  const handler = async (req, res) => {
    let p = '/'
    try {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)
      p = safeDecode(url.pathname)
    } catch {
      return json(res, 400, { error: 'bad url' })
    }
    if (verbose) res.on('finish', () => console.log(`[req] ${res.statusCode} ${req.method} ${req.url}`))

    try {
      if (p === '/api/version') return json(res, 200, { protocol: 0, stage: '0.1.0-dev' })
      if (p === '/api/capabilities') {
        const cap = await scan()
        return json(res, 200, {
          model: { name: cap.model.name, url: `/m/${MODEL_FILE}`, canvas: null },
          params: cap.params.map((x) => ({ ...x, min: null, max: null, default: null, physics: null })),
          groups: cap.groups, parts: cap.parts,
          motions: cap.motions, expressions: cap.expressions, textures: cap.textures,
        })
      }
      if (p === '/api/action' && req.method === 'POST') {
        if (!auth(req)) return json(res, 401, { error: 'bad token' })
        return json(res, 200, acceptAction(await body(req)))
      }
      if (p === '/api/log') return json(res, 200, { log: LOG, events })

      if (p.startsWith('/m/')) {
        const rel = p.slice(3)
        if (rel === MODEL_FILE) {
          const cap = await scan()
          return json(res, 200, patchModel(cap))
        }
        const abs = path.join(MODEL_DIR, rel)
        if (!abs.startsWith(MODEL_DIR)) return json(res, 403, { error: 'forbidden' })
        if (await serveFile(res, abs)) return
        return json(res, 404, { error: 'not found', rel })
      }

      // 依赖（pixi8 / 引擎）：开发期直接挂 node_modules
      if (p.startsWith('/vendor8/')) {
        const rel = p.slice('/vendor8/'.length)
        const abs = path.join(root, 'node_modules', rel)
        if (!abs.startsWith(path.join(root, 'node_modules'))) return json(res, 403, { error: 'forbidden' })
        if (await serveFile(res, abs)) return
        return json(res, 404, { error: 'not found', rel })
      }

      if (p === '/' || p === '') { res.writeHead(302, { location: '/app/' }); return res.end() }
      const rel = p.endsWith('/') ? `${p}index.html` : p
      const abs = path.join(root, rel)
      if (!abs.startsWith(root)) return json(res, 403, { error: 'forbidden' })
      if (await serveFile(res, abs)) return
      return json(res, 404, { error: 'not found', path: p })
    } catch (e) {
      console.error('[500]', p, e)
      return json(res, 500, { error: String(e && e.message || e) })
    }
  }

  await new Promise((resolve, reject) => {
    server = createServer(handler)
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  const caps = await scan().catch(() => null)
  return {
    server,
    port: server.address().port,
    url: `http://${host}:${server.address().port}`,
    capabilities: caps,
    log: LOG,
    close: () => new Promise((r) => server.close(() => r())),
  }
}
