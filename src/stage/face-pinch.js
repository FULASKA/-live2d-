/**
 * 捏脸 —— 按住脸拖动，鼓脸 / 单边鼓 / 抖脸盘。
 *
 * 参数来自官方皮的嘟嘟脸组（cdi3 里能查到）：
 *   CheeckPuff   鼓脸          CheeckPuff2  鼓脸-变化
 *   CheeckPuffL  > 鼓脸        CheeckPuffR  < 鼓脸
 *   CheeksWiggleX 脸盘抖动X
 *
 * 设计：
 *   - 拖动量归一化成「拉扯向量」，用跟随（一阶低通）而不是直接写死，手感有惯性
 *   - 左拉鼓左脸、右拉鼓右脸，同时整体鼓一点；拉扯越大越鼓
 *   - 拖动中叠一点抖动（频率低、幅度小），松手平滑回零
 *   - 全部在 beforeModelUpdate 里写，纯加法/覆盖都不影响 gaze 与表情层
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createFacePinch({ param, options = {} } = {}) {
  const cfg = {
    maxPull: 150,        // 拖动多少像素算拉满
    follow: 10,          // 跟手速度（1/s）
    releasePerSec: 4.5,  // 松手回落速度
    puff: 1,             // 整体鼓脸比例（按参数量程）
    side: 0.9,           // 单边鼓脸比例
    wiggleHz: 3.2,
    wiggle: 0.25,
    ...options,
  }

  const cur = { x: 0, y: 0 }
  const target = { x: 0, y: 0 }
  let grabbed = false
  let phase = 0
  const writes = {}

  const info = (id) => param.info(id)
  const has = (id) => !!info(id)
  const range = (id) => {
    const i = info(id)
    if (!i) return null
    return { lo: i.min, hi: i.max }
  }
  /** 按 0..1 的比例写到参数（基线取 min，本模型这几个参数都是 0 为底） */
  const writeFrac = (id, frac) => {
    const r = range(id)
    if (!r) { writes[id] = null; return }
    const v = clamp(r.lo + (r.hi - r.lo) * clamp(frac, 0, 1), r.lo, r.hi)
    param.set(id, v)
    writes[id] = +v.toFixed(3)
  }
  const writeAbs = (id, v) => {
    const r = range(id)
    if (!r) { writes[id] = null; return }
    const val = clamp(v, r.lo, r.hi)
    param.set(id, val)
    writes[id] = +val.toFixed(3)
  }

  function grab() {
    grabbed = true
  }
  function move(dx, dy) {
    grabbed = true
    target.x = clamp(target.x + dx / cfg.maxPull, -1, 1)
    target.y = clamp(target.y + dy / cfg.maxPull, -1, 1)
  }
  function release() {
    grabbed = false
    target.x = 0
    target.y = 0
  }

  function apply(dtMs = 1000 / 60) {
    const dt = Math.max(1, dtMs) / 1000
    const k = 1 - Math.exp(-(grabbed ? cfg.follow : cfg.releasePerSec) * dt)
    cur.x += (target.x - cur.x) * k
    cur.y += (target.y - cur.y) * k
    const m = Math.hypot(cur.x, cur.y)
    if (m < 0.004 && !grabbed) {
      cur.x = 0
      cur.y = 0
    }
    phase += dt * Math.PI * 2 * cfg.wiggleHz

    const wiggleAmt = Math.sin(phase) * m * cfg.wiggle
    if (has('CheeckPuff')) writeFrac('CheeckPuff', m * cfg.puff)
    if (has('CheeckPuff2')) writeFrac('CheeckPuff2', m * cfg.puff * 0.6)
    if (has('CheeckPuffL')) writeFrac('CheeckPuffL', Math.max(0, -cur.x) * cfg.side)
    if (has('CheeckPuffR')) writeFrac('CheeckPuffR', Math.max(0, cur.x) * cfg.side)
    if (has('CheeksWiggleX')) writeAbs('CheeksWiggleX', wiggleAmt)

    return { pull: +m.toFixed(2) }
  }

  return {
    grab, move, release, apply,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    params: () => ['CheeckPuff', 'CheeckPuffL', 'CheeckPuffR', 'CheeckPuff2', 'CheeksWiggleX'].filter(has),
    state: () => ({ grabbed, cur: { x: +cur.x.toFixed(2), y: +cur.y.toFixed(2) }, writes: { ...writes }, avail: ['CheeckPuff', 'CheeckPuffL', 'CheeckPuffR', 'CheeckPuff2', 'CheeksWiggleX'].filter(has) }),
  }
}
