/**
 * 抚摸（滑动）反馈增益 —— 手指还在滑动时就一直晃，停手才慢慢停。
 *
 * 不再是「动一下就衰减一次」，而是**持续态**：
 *   - 每收到一次滑动步进（每 ~3% 宽一次）就续一次活跃时间（holdMs）
 *   - 活跃期间幅度往上爬（ramp），封顶后不再涨，避免越摸越失控
 *   - 停手后先按 holdMs 撑住，再按 releaseMs 淡出，不会突然断
 *
 * 写入仍然是纯加性的 beforeModelUpdate（排在 gaze 之后）：先读当前值（含跟随与待机摆动），
 * 再加偏移并夹到参数范围内，所以不会把跟随/待机压死。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** 各分区的力度：头最明显，胸次之，其余很轻（避免摸腿整个人都在晃） */
const REGION_GAIN = { 头: 1, 胸: 0.5, 腰: 0.35, 腿: 0.2 }

export function createPetSway({ param, options = {} } = {}) {
  const cfg = {
    gain: 1.6,        // 0 = 关；1 = 基准幅度
    hz: 2.0,          // 晃动频率
    holdMs: 320,      // 这么久没收到新的滑动步进才认为「停手」
    rampPerSec: 2.6,  // 活跃时幅度爬升速度
    releasePerSec: 3.4, // 停手后幅度回落速度
    maxAmp: 1.0,
    angleAmp: 9,      // ParamAngleZ：左右歪头（满幅度数）
    nodAmp: 4.0,      // ParamAngleY：上下点
    bodyAmp: 3.2,     // ParamBodyAngleZ：身体跟着轻晃
    ...options,
  }

  let amp = 0        // 当前幅度系数
  let hold = 0       // 剩余活跃时间（ms）
  let phase = 0
  let last = { z: 0, y: 0, body: 0 }
  // 指针相对角色中心的归一化位置：抚摸时头往手的偏，不是单纯原地晃
  const pointer = { x: 0, y: 0 }
  function point(nx, ny) {
    pointer.x = clamp(nx, -1, 1)
    pointer.y = clamp(ny, -1, 1)
  }

  const add = (id, delta) => {
    if (!delta) return
    const info = param.info(id)
    if (!info) return
    param.set(id, clamp(param.get(id) + delta, info.min, info.max))
  }

  /** 收到一次滑动步进：续活跃时间 + 抬一点幅度上限 */
  function trigger(regionName) {
    const k = REGION_GAIN[regionName]
    if (!k || !cfg.gain) return false
    hold = cfg.holdMs
    amp = Math.min(cfg.maxAmp, Math.max(amp, 0.35 + 0.5 * k))
    return true
  }

  function apply(dtMs = 1000 / 60) {
    const dt = Math.max(1, dtMs)
    if (hold <= 0 && amp <= 0.004) return

    phase += (dt / 1000) * Math.PI * 2 * cfg.hz
    hold = Math.max(0, hold - dt)

    if (hold > 0) {
      amp = Math.min(cfg.maxAmp, amp + (cfg.rampPerSec * dt) / 1000)
    } else {
      amp = Math.max(0, amp - (cfg.releasePerSec * dt) / 1000)
    }
    if (amp <= 0.004) { amp = 0; last = { z: 0, y: 0, body: 0 }; return }

    const g = amp * cfg.gain
    const sway = Math.sin(phase) * g
    // 追踪手：晃动叠一层朝指针方向的偏摆（AngleZ 为正 = 往左歪，所以取负号才「朝手」）
    const leanX = -pointer.x * 5.5 * g
    const leanY = -pointer.y * 3.6 * g
    last = {
      z: sway * cfg.angleAmp + leanX,
      y: Math.cos(phase * 0.5) * g * cfg.nodAmp + leanY,
      body: sway * cfg.bodyAmp,
    }
    add('ParamAngleZ', last.z)
    add('ParamAngleY', last.y)
    add('ParamBodyAngleZ', last.body)
  }

  return {
    trigger,
    point,
    apply,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({
      amp: +amp.toFixed(2),
      hold: Math.round(hold),
      last: { z: +last.z.toFixed(2), y: +last.y.toFixed(2) },
    }),
  }
}
