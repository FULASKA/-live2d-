/**
 * 捏脸 —— 按住一侧脸颊拖动，那一侧鼓起来。
 *
 * 热区由 regions.faceRegions() 一分为二（左脸 / 右脸），按住哪边就捏哪边：
 * 这样不会因为拖拽方向判错，把另一侧也鼓起来。
 *
 * 参数（官方皮嘟嘟脸组，cdi3 里查得到）：
 *   CheeckPuff   整体鼓脸      CheeckPuff2  鼓脸-变化
 *   CheeckPuffL  > 鼓脸        CheeckPuffR  < 鼓脸
 *   CheeksWiggleX 脸盘抖动X
 *
 * 写点 beforeModelUpdate，纯加性/覆盖局部参数，不影响 gaze 与表情层。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createFacePinch({ param, options = {} } = {}) {
  const cfg = {
    maxPull: 150,        // 拖动多少像素算拉满
    follow: 10,          // 跟手速度（1/s）
    releasePerSec: 4.5,  // 松手回落速度
    puff: 1,             // 整体鼓脸比例（按参数量程）
    side: 1,             // 单边鼓脸比例
    wiggleHz: 3.2,
    wiggle: 0.25,
    ...options,
  }

  let side = null      // 'L' | 'R' | null
  let pulled = 0       // 累计拉扯量（像素）
  let mag = 0          // 归一化 0..1（平滑后）
  let target = 0
  let phase = 0
  const writes = {}

  const range = (id) => {
    const i = param.info(id)
    return i ? { lo: i.min, hi: i.max } : null
  }
  const has = (id) => !!range(id)
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

  /** 按住某一侧脸颊开始捏（side: 'L' | 'R'） */
  function grab(which) {
    side = which === 'R' ? 'R' : 'L'
    pulled = 0
    target = 0
  }
  /** 拖动像素：只累加位移量（方向不再决定左右，左右由按哪边决定） */
  function move(dx, dy) {
    if (!side) return
    pulled += Math.hypot(dx, dy)
    target = clamp(pulled / cfg.maxPull, 0, 1)
  }
  function release() {
    side = null
    pulled = 0
    target = 0
  }

  function apply(dtMs = 1000 / 60) {
    const dt = Math.max(1, dtMs) / 1000
    const k = 1 - Math.exp(-(side ? cfg.follow : cfg.releasePerSec) * dt)
    mag += (target - mag) * k
    if (!side && mag < 0.004) {
      mag = 0
      side = null
    }
    phase += dt * Math.PI * 2 * cfg.wiggleHz

    const m = mag
    const wiggleAmt = Math.sin(phase) * m * cfg.wiggle
    if (has('CheeckPuff')) writeFrac('CheeckPuff', m * cfg.puff)
    if (has('CheeckPuff2')) writeFrac('CheeckPuff2', m * cfg.puff * 0.6)
    if (has('CheeckPuffL')) writeFrac('CheeckPuffL', side === 'L' ? m * cfg.side : 0)
    if (has('CheeckPuffR')) writeFrac('CheeckPuffR', side === 'R' ? m * cfg.side : 0)
    if (has('CheeksWiggleX')) writeAbs('CheeksWiggleX', wiggleAmt)

    return { mag: +m.toFixed(2) }
  }

  return {
    grab, move, release, apply,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    params: () => ['CheeckPuff', 'CheeckPuffL', 'CheeckPuffR', 'CheeckPuff2', 'CheeksWiggleX'].filter(has),
    state: () => ({ side, mag: +mag.toFixed(2), writes: { ...writes } }),
  }
}
