// 无头验证脚本：用本机 Edge（真实时间）打开验证台，等 __ready，取样 + 截图。
//
// 为什么不用 chrome --dump-dom + 虚拟时钟：
//   虚拟时钟会把 8192² 贴贴图解码卡死（内核起来了，模型永远 load 不完）。
//   这个脚本用真实时间等待，是「模型能不能画出来」在无头环境的唯一可信证据。
//
// 用法：
//   node scripts/shot.mjs --url "http://127.0.0.1:53180/harness/?expr=流泪,脸红" \
//        --out tmp/shot.png --probe "expr,conflicts" [--wait 25000] [--eval "js"]
import puppeteer from 'puppeteer-core'
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d
}
const URL_ = arg('url', 'http://127.0.0.1:53180/harness/')
const OUT = arg('out', 'tmp/shot.png')
const WAIT = Number(arg('wait', 30000))
const EVAL = arg('eval', '')
const EVALFILE = arg('evalfile', '')
const MOUSE = arg('mouse', '')
const CLICK = arg('click', '')
const KEY = arg('key', '')
const DRAG = arg('drag', '')
const W = Number(arg('width', 1280))
const H = Number(arg('height', 800))
const EVAL_SRC = EVALFILE ? readFileSync(EVALFILE, 'utf8') : EVAL

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

async function findBrowser() {
  const { access } = await import('node:fs/promises')
  for (const p of BROWSERS) {
    try { await access(p); return p } catch {}
  }
  throw new Error('找不到 Edge/Chrome：' + BROWSERS.join(' | '))
}

const main = async () => {
  const executablePath = await findBrowser()
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  })

  const logs = []
  try {
    const page = await browser.newPage()
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
    page.on('requestfailed', (r) => logs.push(`[net] ${r.url()} ${r.failure()?.errorText}`))

    await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // 等就绪标记（或报错），超时也别崩：把当时的日志交出去
    const status = await page
      .waitForFunction('window.__ready === true || window.__error', { timeout: WAIT, polling: 250 })
      .then(() => 'ready')
      .catch(() => 'timeout')

    // 鼠标注入（验证视线跟随 / 分区悬停）：先等模型稳定几帧再移
    if (MOUSE) {
      const [mx, my] = MOUSE.split(',').map(Number)
      await new Promise((r) => setTimeout(r, 600))
      await page.mouse.move(mx, my, { steps: 8 })
    }

    // 点击序列：--click "x,y|x,y|…"（页面坐标，用来走 UI 流程）
    if (CLICK) {
      await new Promise((r) => setTimeout(r, 500))
      for (const pair of CLICK.split('|')) {
        const [cx, cy] = pair.split(',').map(Number)
        await page.mouse.click(cx, cy)
        await new Promise((r) => setTimeout(r, 120))
      }
    }
    // 拖拽注入：--drag "x1,y1,x2,y2[,steps]"（验证抚摸 / 拖动判定）
    if (DRAG) {
      const [x1, y1, x2, y2, steps = 10] = DRAG.split(',').map(Number)
      await new Promise((r) => setTimeout(r, 400))
      await page.mouse.move(x1, y1)
      await page.mouse.down()
      await page.mouse.move(x2, y2, { steps })
      await new Promise((r) => setTimeout(r, 120))
      await page.mouse.up()
      await new Promise((r) => setTimeout(r, 200))
    }

    if (KEY) {
      await page.keyboard.press(KEY)
      await new Promise((r) => setTimeout(r, 200))
    }

    // 稳定几帧再取样
    await new Promise((r) => setTimeout(r, 1200))

    const probe = await page.evaluate((extra) => {
      const s = window.__stage
      const out = {
        status: window.__error ? 'error' : window.__ready ? 'ready' : 'not-ready',
        error: window.__error || null,
        title: document.title,
        layers: s?.layers?.inspect?.() || null,
        expressions: s?.layers?.expressions?.() || [],
        params: s ? { count: s.stage.param.count, parts: s.stage.part.count } : null,
        drawables: (() => { try { return s.stage.core.getDrawableCount() } catch { return null } })(),
        // 采样几个关键参数，判断表情/动作真的写进去了
        keyParams: ['key1', 'key3', 'key7'].reduce((a, id) => (a[id] = s ? s.stage.param.get(id) : null, a), {}),
        frameParams: window.__frameParams || null,
      }
      if (extra) { try { out.extra = eval(extra) } catch (e) { out.evalError = String(e) } }
      return out
    }, EVAL_SRC)

    mkdirSync(path.dirname(OUT), { recursive: true })
    await page.screenshot({ path: OUT, omitBackground: process.argv.includes("--omit-background") })

    console.log(JSON.stringify({ ok: probe.status === 'ready', status, probe, logs: logs.slice(-40) }, null, 2))
    if (probe.status !== 'ready') process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, fatal: String(e && e.stack || e) }, null, 2))
  process.exitCode = 1
})
