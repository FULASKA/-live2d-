/**
 * 待机「活气」层 —— 耳朵 / 头发 / 耳环的惯性摆动与耳朵扑棱。
 *
 * 为什么需要自己算：模型自带 physics3 有 292 个输出参数，但输入只有
 * 「头部角度 + 呼吸 + 前倾」这几路，输入单一 → 头发耳朵只会跟着头整体缓慢飘，
 * 看起来像一块硬壳。对比面捕那种「有冲击、有余震、有自发小动作」的观感，就差在这。
 *
 * 写点：beforeModelUpdate（= 物理算完之后）。**读回物理值再加偏移**，
 * 所以模型自己的物理完全保留，我们只负责「多出来的那一层力」。
 * 实测该时刻物理值确实读得到（LEar1 0.02~0.03、头发 -0.05 量级），所以可叠加。
 *
 * 参数都是 [-1, 1] 归一化量（cdi3 实测）：LEar1~3 / REar1~3、FrontHair* / SideHair* / LateHair*、
 * LJewelry1~3 / RJewelry1~3。耳朵为正值 = 竖起（实测 +1 明显上扬，-1 下垂）。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

const HAIR_Y = [
  'FrontHairY1', 'FrontHairY2', 'FrontHairY3', 'FrontHairY4',
  'SideHairY1', 'SideHairY2', 'SideHairY3', 'SideHairY4',
  'LateHairY1', 'LateHairY2', 'LateHairY3', 'LateHairY4', 'LateHairY5',
]
const HAIR_X = [
  'FrontHairX1', 'FrontHairX2', 'FrontHairX3', 'FrontHairX4',
  'SideHairX1', 'SideHairX2', 'SideHairX3', 'SideHairX4',
  'LateHairX1', 'LateHairX2', 'LateHairX3', 'LateHairX4', 'LateHairX5',
]
const EARS = {
  L: ['LEar1', 'LEar2', 'LEar3'],
  R: ['REar1', 'REar2', 'REar3'],
}
const JEWEL = {
  L: ['LJewelry1', 'LJewelry2', 'LJewelry3'],
  R: ['RJewelry1', 'RJewelry2', 'RJewelry3'],
}

export function createLife({ param, options = {} } = {}) {
  const cfg = {
    windAmp: 0.035,      // 微风（头发 Y 轴）
    windAmpX: 0.02,      // 微风（头发 X 轴）
    windSpeed: 0.55,     // 微风的基准角速度（rad/s）
    inertiaY: 1,         // 头部俯仰速度 → 头发滞后强度
    inertiaX: 0.85,      // 头部左右速度
    earAmp: 1,           // 扑棱幅度（参数满量程的比例；+1 竖起到顶）
    earMin: 5.5,         // 自发扑棱的最短间隔（秒）
    earMax: 13,          // 最长间隔
    earTremor: 0.012,    // 耳朵常态微颤（静止时也有生命感）
    jewelAmp: 0.3,       // 耳环摆动
    ...options,
  }

  const ranges = new Map()
  const rng = (id) => {
    let r = ranges.get(id)
    if (r === undefined) {
      const i = param.info(id)
      r = i ? [i.min, i.max] : null
      ranges.set(id, r)
    }
    return r
  }
  /** 加性写：读回「物理/表情之后」的当前值，加上我们的偏移，夹在量程内 */
  const add = (id, delta) => {
    if (!delta) return
    const r = rng(id)
    if (!r) return
    const cur = param.get(id)
    if (cur == null) return
    param.set(id, clamp(cur + delta, r[0], r[1]))
  }

  let t = 0
  const windPhase = Math.random() * Math.PI * 2
  const prev = { x: null, y: null, z: null }
  const vel = { x: 0, y: 0, z: 0 }
  let flip = null            // { t, dur, side, amp }
  let nextFlip = cfg.earMin + Math.random() * 3
  let flips = 0
  let lastEar = 0

  /** 耳朵扑棱一次（side: 'L' | 'R'，amp 0..1.5） */
  function flap(side = 'L', amp = 1) {
    flip = { t: 0, dur: 0.62, side: side === 'R' ? 'R' : 'L', amp: clamp(amp, 0, 1.5) }
    nextFlip = cfg.earMin + Math.random() * (cfg.earMax - cfg.earMin)
    flips += 1
  }

  function apply(dtMs = 1000 / 60) {
    const dt = clamp(dtMs / 1000, 0.001, 0.12)
    t += dt

    // 头部角速度（含抚摸时的摆动、捏脸时的跟随）→ 头发「慢半拍」
    const cz = param.get('ParamAngleZ')
    const cy = param.get('ParamAngleY')
    const cx = param.get('ParamAngleX')
    if (prev.z != null) {
      const k = 1 - Math.exp(-dt * 10)
      vel.z += (clamp((cz - prev.z) / dt, -1200, 1200) - vel.z) * k
      vel.y += (clamp((cy - prev.y) / dt, -1200, 1200) - vel.y) * k
      vel.x += (clamp((cx - prev.x) / dt, -1200, 1200) - vel.x) * k
    }
    if (cz != null) prev.z = cz
    if (cy != null) prev.y = cy
    if (cx != null) prev.x = cx

    // 微风：两个不同频率叠加，避免看出周期
    const wPhase = windPhase + t * cfg.windSpeed
    const wy = Math.sin(wPhase) * cfg.windAmp + Math.sin(wPhase * 1.7 + 1.3) * cfg.windAmp * 0.55
    const wx = Math.sin(wPhase * 1.23 + 0.7) * cfg.windAmpX + Math.sin(wPhase * 0.61) * cfg.windAmpX * 0.6

    // 惯性：往反方向拖一点，越转得快越明显
    const iy = clamp(-vel.y * 0.0012 * cfg.inertiaY, -0.32, 0.32)
    const ix = clamp(-vel.x * 0.0012 * cfg.inertiaX, -0.32, 0.32)

    // 自发扑棱
    if (!flip) {
      nextFlip -= dt
      if (nextFlip <= 0) flap(Math.random() < 0.5 ? 'L' : 'R', 0.7 + Math.random() * 0.3)
    }
    let earEnv = 0
    let earSide = null
    if (flip) {
      flip.t += dt
      const p = flip.t / flip.dur
      if (p >= 1) {
        flip = null
      } else {
        // 2.5 次衰减摆动：像被碰了一下的回弹
        earEnv = Math.sin(p * Math.PI * 5) * Math.exp(-p * 3.2) * flip.amp
        earSide = flip.side
      }
    }
    lastEar = earEnv

    for (let i = 0; i < HAIR_Y.length; i++) add(HAIR_Y[i], wy * (0.6 + (i % 4) * 0.15) + iy)
    for (let i = 0; i < HAIR_X.length; i++) add(HAIR_X[i], wx * (0.7 + (i % 4) * 0.12) + ix)
    for (const id of JEWEL.L) add(id, clamp(-vel.x * 0.0009, -0.4, 0.4) * cfg.jewelAmp + wx * 0.4)
    for (const id of JEWEL.R) add(id, clamp(-vel.x * 0.0009, -0.4, 0.4) * cfg.jewelAmp + wx * 0.4)

    const tremor = Math.sin(t * 7.3) * cfg.earTremor
    const eL = (earSide === 'L' ? earEnv * cfg.earAmp : 0) + tremor
    const eR = (earSide === 'R' ? earEnv * cfg.earAmp : 0) + tremor
    EARS.L.forEach((id, i) => add(id, eL * (1 - i * 0.18))) // 越靠尖越滞后，做出鞭状
    EARS.R.forEach((id, i) => add(id, eR * (1 - i * 0.18)))
  }

  return {
    apply, flap,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({
      vel: { x: Math.round(vel.x), y: Math.round(vel.y), z: Math.round(vel.z) },
      flipping: !!flip,
      side: flip?.side ?? null,
      earEnv: Math.round(lastEar * 100) / 100,
      flips,
      nextIn: Math.round(nextFlip * 10) / 10,
    }),
  }
}
