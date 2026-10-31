/**
 * 终点姿势层（pose）—— 只记「动作做完时的参数值」，过渡由这一层自己补。
 *
 * 数值来源：模型自带 `Animation/*.motion3.json` 的最后一帧（手臂链），
 * 头/身体这类参数是我们自己补的（模型没给这套动作）。
 *
 * 两个写点：
 *   · 手臂链（Movement 与 Param 系列）每帧都钉住，默认手也钉（值等于默认，不影响观感）；
 *   · 头/身体这类「额外参数」只在反应动作进行中钉住，结束后解锁 ——
 *     否则会把 gaze 的转动永久压成 0。
 *
 * 写点必须在物理之前（layers.hold → applyPhysics），否则物理会算到上一帧的输入。
 */

/** 默认手（= 动画里的「切回默认」落点） */
const REST = {
  Movement1: 0, Movement2: 0, Movement3: 0,
  Param56: 1, Param57: 0,
  Param36: 0, Param39: 0, Param40: 0, Param41: 0, Param42: 0, Param43: 0,
  Param59: 0, Param60: 0, Param61: 0, Param62: 0,
}

/**
 * 预设：名字 → 终点参数。缺省的手臂参数按 REST 补齐。
 * extras 是「头/身体」这类会跟 gaze 抢的参数，只在动作期间钉。
 */
export const POSES = {
  默认手: { extras: {} },
  // 竖手指切出来动画.motion3.json @1.25s
  竖手指: {
    params: { Movement1: 0, Movement3: 1, Param40: 1, Param36: 0, Param39: 0.322, Param41: 0.702, Param42: 0 },
    extras: {},
  },
  // 默认手切举手.motion3.json @1.133s
  举手: {
    params: { Movement2: 1, Param62: 0.034, Param59: 0.476, Param60: 0.86, Param61: 0.022 },
    extras: {},
  },
  // 狗尾草切换出来.motion3.json @1.233s
  狗尾草: {
    params: { Movement1: 1, Param36: 0.04, Param39: 0.2, Param41: -0.732, Param42: 0 },
    extras: {},
  },
  // 被摸胯：手抬到胸前护住 + 右转头（正角度 = 角色右侧）+ 低头 + 微微一缩
  护胯: {
    params: { Movement2: 1, Param62: 0.034, Param59: 0.476, Param60: 0.86, Param61: 0.022 },
    extras: { ParamAngleX: 22, ParamAngleY: -6, LeanInput: -10, ParamBodyAngleX: 6, HipAngleZ: 4 },
  },
}

const smooth = (t) => t * t * (3 - 2 * t)

export function createPoses({ layers, fps = 60 } = {}) {
  const extraKeys = [...new Set(Object.values(POSES).flatMap((p) => Object.keys(p.extras || {})))]
  const armKeys = Object.keys(REST)

  const curArms = { ...REST }
  const curExtras = Object.fromEntries(extraKeys.map((k) => [k, 0]))
  let fromArms = { ...REST }, toArms = { ...REST }
  let fromExtras = { ...curExtras }, toExtras = { ...curExtras }
  let elapsed = 0
  let totalMs = 0
  let active = '默认手'
  /** extras 是否还在生效（结束后解锁，避免永久压住 gaze） */
  let extrasOn = false

  const lerpTo = (name, ms, { holdExtras } = {}) => {
    const pose = POSES[name] || POSES['默认手']
    fromArms = { ...curArms }
    toArms = { ...REST, ...(pose.params || {}) }
    fromExtras = { ...curExtras }
    toExtras = Object.fromEntries(extraKeys.map((k) => [k, (pose.extras && pose.extras[k]) || 0]))
    // 有 extras 的动作，结束后要保留（例如「护住」要维持几秒）；由调用方 release 才收回
    extrasOn = holdExtras !== undefined ? !!holdExtras : Object.keys(pose.extras || {}).length > 0
    elapsed = 0
    totalMs = Math.max(0, ms)
    active = name in POSES ? name : '默认手'
    if (totalMs === 0) { Object.assign(curArms, toArms); Object.assign(curExtras, toExtras) }
  }

  return {
    /** 每帧推进插值并钉进 layers.hold（必须在 layers.applyPhysics 之前调用） */
    apply(dtMs = 1000 / 60) {
      if (totalMs > 0) {
        elapsed = Math.min(totalMs, elapsed + dtMs)
        const k = smooth(elapsed / totalMs)
        for (const id of armKeys) {
          const a = fromArms[id] ?? REST[id]
          const b = toArms[id] ?? REST[id]
          curArms[id] = a + (b - a) * k
        }
        for (const id of extraKeys) curExtras[id] = (fromExtras[id] ?? 0) + ((toExtras[id] ?? 0) - (fromExtras[id] ?? 0)) * k
        if (elapsed >= totalMs) totalMs = 0
      }
      for (const id of armKeys) layers.hold(id, curArms[id])
      if (extrasOn) for (const id of extraKeys) layers.hold(id, curExtras[id])
      return active
    },
    /** 切到一个预设；holdExtras 默认按预设是否带 extras 决定 */
    set(name, ms = 260, opts = {}) {
      if (!(name in POSES)) return false
      lerpTo(name, ms, opts)
      return true
    },
    /** 收回默认手（带 extras 的姿势会一起过渡回 0 并解锁） */
    release(ms = 240) {
      lerpTo('默认手', ms, { holdExtras: true })
      setTimeout(() => { if (active === '默认手') extrasOn = false }, Math.max(0, ms) + 40)
      return true
    },
    toggle(name = '竖手指', ms = 260) {
      const next = active === name ? '默认手' : name
      lerpTo(next, ms, { holdExtras: next !== '默认手' })
      return next
    },
    get active() { return active },
    state() {
      return { active, totalMs, elapsed, extrasOn, curArms: { ...curArms }, curExtras: { ...curExtras } }
    },
    presets() { return Object.keys(POSES) },
  }
}
