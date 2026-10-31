/**
 * 终点姿势层（pose）—— 只记「动作做完时的参数值」，过渡由这一层自己补。
 *
 * 为什么只存终点：
 *   模型自带的 `Animation/*.motion3.json`（VTS 里那套手臂动作）每段 1~1.3 秒，
 *   手写整条曲线没必要，真正决定观感的是**落点**；
 *   中间过程按缓动补出来，配上物理链反而更自然。
 *
 * 数值来源：直接读 `Animation/竖手指切出来动画.motion3.json` 等文件的最后一帧
 *   （Segments 扁平编码走一遍，取最后一个点），不是估的。
 *
 * 写点：全部走 layers.hold（预留给物理输入的参数在 physics 之前写，其余在 update 之前写），
 *   否则会被引擎 update() 末尾的 loadParameters() 抹掉（读回是 0，但画面是生效的）。
 */

/** 默认手（= 动画里的「切回默认」落点） */
const REST = {
  Movement1: 0, Movement2: 0, Movement3: 0,
  Param56: 1, Param57: 0,
  Param36: 0, Param39: 0, Param40: 0, Param41: 0, Param42: 0, Param43: 0,
  Param59: 0, Param60: 0, Param61: 0, Param62: 0,
}

/**
 * 预设：名字 → 终点参数。缺省的参数按 REST 补齐，避免上一个姿势的残留。
 */
export const POSES = {
  默认手: {},
  // 竖手指切出来动画.motion3.json @1.25s
  竖手指: {
    Movement1: 0, Movement3: 1, Param40: 1, Param36: 0, Param39: 0.322, Param41: 0.702, Param42: 0,
  },
  // 默认手切举手.motion3.json @1.133s
  举手: {
    Movement2: 1, Param62: 0.034, Param59: 0.476, Param60: 0.86, Param61: 0.022,
  },
  // 狗尾草切换出来.motion3.json @1.233s
  狗尾草: {
    Movement1: 1, Param36: 0.04, Param39: 0.2, Param41: -0.732, Param42: 0,
  },
}

const smooth = (t) => t * t * (3 - 2 * t)

export function createPoses({ layers, fps = 60 } = {}) {
  /** 我们自己维护的当前值：参数每帧会被引擎还原，读回来不能当「现在」用 */
  const cur = { ...REST }
  let from = { ...REST }
  let target = { ...REST }
  let elapsed = 0
  let totalMs = 0
  let active = '默认手'

  const lerpTo = (name, ms) => {
    const pose = POSES[name] || POSES['默认手']
    from = { ...cur }
    target = { ...REST, ...pose }
    elapsed = 0
    totalMs = Math.max(0, ms)
    active = name in POSES ? name : '默认手'
    if (totalMs === 0) Object.assign(cur, target)
  }

  return {
    /** 每一帧推进插值并把结果钉进 layers.hold（必须在 layers.applyPhysics 之前调用） */
    apply(dtMs = 1000 / 60) {
      if (totalMs > 0) {
        elapsed = Math.min(totalMs, elapsed + dtMs)
        const k = smooth(elapsed / totalMs)
        for (const id of Object.keys(REST)) {
          const a = from[id] ?? REST[id]
          const b = target[id] ?? REST[id]
          cur[id] = a + (b - a) * k
        }
        if (elapsed >= totalMs) totalMs = 0
      }
      for (const id of Object.keys(REST)) layers.hold(id, cur[id])
      return active
    },
    /** 切到一个预设；ms 是过渡时长（默认 260ms，接近自带动作的收尾感） */
    set(name, ms = 260) {
      if (!(name in POSES)) return false
      lerpTo(name, ms)
      return true
    },
    /** 收回默认手 */
    release(ms = 240) { lerpTo('默认手', ms); return true },
    /** 点一下手：竖手指 ↔ 默认手 */
    toggle(name = '竖手指', ms = 260) {
      const next = active === name ? '默认手' : name
      lerpTo(next, ms)
      return next
    },
    get active() { return active },
    state() {
      return { active, totalMs, elapsed, cur: { ...cur } }
    },
    presets() { return Object.keys(POSES) },
  }
}
