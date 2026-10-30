/**
 * 随机小表情 —— 待机时偶尔冒出来的「笑 / 吐舌头 / 吐舌头+单眼笑」。
 *
 * 为什么放在这一层：嘴由 mouth.js 驱动，眼睛由内核的眼眨通道驱动，两者都不会
 * 自发做「表情」。但人（和面捕）在放松状态下会时不时笑一下、吐个舌头，
 * 缺了这个就会显得在发呆。所以这里做一个随机调度器 + 三种预设。
 *
 * 写法：
 *   - 嘴/舌用**加性**写，叠在嘴部待机微动之上，不会打架；
 *   - 闭眼用**覆盖**（1-k → 0），因为它要压过内核的眨眼通道。
 * 写点：beforeModelUpdate，且在 mouth 之后（嘴先摆好，表情再叠）。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/**
 * 闭眼参数映射。**不是照名字猜的，是实测的**（同 CheeckPuff 那个坑）：
 * 把 ParamEyeLOpen 置 0，实际闭起来的是**画面右半边**那只眼（截图对照过），
 * 所以「左」在这个模型里指角色自身的左 = 观众看到的右。
 */
const WINK = {
  /** 画面右眼（观众的右边）—— 用户说的「我的视角是右边眼睛」 */
  screenRight: 'ParamEyeLOpen',
  screenLeft: 'ParamEyeROpen',
}

export function createIdleFaces({ param, options = {} } = {}) {
  const cfg = {
    auto: true,
    minGap: 9,          // 两次随机表情的最短间隔（秒）
    maxGap: 19,
    fadeIn: 0.14,       // 淡入（秒）
    fadeOut: 0.22,
    startDelay: 3.5,
    ...options,
  }

  const PRESETS = {
    笑: {
      dur: 1.25,
      add: { MouthSmile_L: 0.8, MouthSmile_R: 0.8, ParamMouthForm: 0.34, ParamMouthOpenY: 0.12 },
      set: { EyeSmile: 0.55 },
    },
    吐舌头: {
      dur: 1.5,
      add: {
        TongueOut: 1, ParamMouthOpenY: 0.3, ParamMouthForm: -0.08,
        ParamTongueUpDown: -0.25, MouthRollLower: 0.35,
      },
    },
    吐舌头闭眼: {
      dur: 1.6,
      add: {
        TongueOut: 1, ParamMouthOpenY: 0.32, ParamMouthForm: 0.2,
        ParamTongueUpDown: -0.3, MouthSmile_L: 0.5, MouthSmile_R: 0.5,
      },
      // 闭画面右眼（= 用户的视角右边）
      wink: WINK.screenRight,
    },
  }

  const ranges = new Map()
  const rng = (id) => {
    let r = ranges.get(id)
    if (r === undefined) { const i = param.info(id); r = i ? [i.min, i.max] : null; ranges.set(id, r) }
    return r
  }
  const add = (id, delta) => {
    if (!delta) return
    const r = rng(id)
    if (!r) return
    param.set(id, clamp((param.get(id) ?? 0) + delta, r[0], r[1]))
  }
  const setIn = (id, v) => {
    const r = rng(id)
    if (!r) return
    param.set(id, clamp(v, r[0], r[1]))
  }

  let t = 0
  let next = cfg.startDelay
  let cur = null        // { name, preset, t0, dur }
  let plays = 0
  let lastName = null

  /** 立刻播一个（name 省略则随机） */
  function trigger(name) {
    const names = Object.keys(PRESETS)
    const pick = name && PRESETS[name] ? name : names[Math.floor(Math.random() * names.length)]
    cur = { name: pick, preset: PRESETS[pick], t: 0 }
    lastName = pick
    plays += 1
    next = cfg.minGap + Math.random() * (cfg.maxGap - cfg.minGap)
    return pick
  }

  function apply(dtMs = 1000 / 60) {
    const dt = clamp(dtMs / 1000, 0.001, 0.12)
    t += dt

    if (cfg.auto && !cur) {
      next -= dt
      if (next <= 0) trigger()
    }
    if (!cur) return

    cur.t += dt
    const p = cur.preset
    if (cur.t > p.dur + cfg.fadeOut) { cur = null; return }

    // 包络：淡入 → 保持 → 淡出
    const age = cur.t
    const inK = clamp(age / cfg.fadeIn, 0, 1)
    const outK = clamp((p.dur + cfg.fadeOut - age) / cfg.fadeOut, 0, 1)
    const k = Math.min(inK, outK, 1)
    if (k <= 0) return

    for (const [id, v] of Object.entries(p.add || {})) add(id, v * k)
    for (const [id, v] of Object.entries(p.set || {})) setIn(id, v * k)
    if (p.wink) setIn(p.wink, 1 - k) // 1 = 睁开，0 = 闭上
  }

  return {
    apply, trigger,
    presets: () => Object.keys(PRESETS),
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({ current: cur?.name ?? null, t: cur ? Math.round(cur.t * 100) / 100 : 0, plays, nextIn: Math.round(next * 10) / 10 }),
  }
}
