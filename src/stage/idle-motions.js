/**
 * 待机动作 —— 桌面上不互动时「自己在动」，别像一张贴纸。
 *
 * 两层叠加：
 *   1. **常驻微摆**：极慢的重心摇摆 + 轻微歪头 + 呼吸起伏，永远在，幅度小到不抢视线；
 *      这是「活着」的地基，不靠随机触发。
 *   2. **随机成套动作**：每隔 8–18 秒挑一个（重心换脚 / 东张西望 / 伸懒腰 / 打瞌睡 /
 *      抖尾巴 / 抖耳朵…），每个是一小段关键帧，首尾都归零，所以接得上下一次呼吸。
 *      部分动作会顺带触发一个表情（复用 idle-faces 的预设），动作 + 表情才算「有情绪」。
 *
 * 写点：**只往姿态总线累加**（见 pose-bus.js）。视线、姿态链、抚摸晃动也在同一份合成里，
 * 所以待机动作不会和「看鼠标」打架 —— 用户一互动，这里就让位（pause）。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
const ease = (x) => x * x * (3 - 2 * x)          // smoothstep
const lerp = (a, b, k) => a + (b - a) * k

/** 关键帧求值：keys = [[t0,v0],[t1,v1],...]（t 为 0..1 归一化） */
function sample(keys, p) {
  if (!keys?.length) return 0
  if (p <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]
    if (p <= t1) {
      const [t0, v0] = keys[i - 1]
      const span = t1 - t0 || 1
      return lerp(v0, v1, ease(clamp((p - t0) / span, 0, 1)))
    }
  }
  return keys[keys.length - 1][1]
}

/**
 * 动作库。数值是**角度增量**（度），会加到姿态总线上。
 * `face` 可选：开始播放时顺带戳一下 idle-faces 的预设（笑 / 吐舌头 …）。
 */
const ROUTINES = {
  重心换脚: {
    ms: 5200,
    lines: ['站久了…换个脚。', '嗯…这边舒服点。'],
    tracks: {
      ParamBodyAngleX: [[0, 0], [0.28, 5.5], [0.62, 4.2], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.3, -2.6], [0.65, -1.8], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, 2.2], [0.7, 1.4], [1, 0]],
      ParamAngleX: [[0, 0], [0.3, -3.5], [0.7, -2.0], [1, 0]],
      HipAngleZ: [[0, 0], [0.35, -3.0], [1, 0]],
    },
  },
  东张西望: {
    ms: 5600,
    lines: ['咦，那边是什么？', '有人吗……', '嗯？刚才是谁。'],
    tracks: {
      ParamAngleX: [[0, 0], [0.22, 9], [0.46, 8], [0.72, -7], [1, 0]],
      ParamAngleY: [[0, 0], [0.3, 2.5], [0.7, -1.5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.25, -2.5], [0.7, 2.0], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 3.0], [0.75, -2.5], [1, 0]],
    },
  },
  伸懒腰: {
    ms: 4200,
    lines: ['伸个懒腰……', '唔——', '骨头要僵啦。'],
    tracks: {
      ParamAngleY: [[0, 0], [0.3, 7], [0.55, 8], [0.8, 2], [1, 0]],
      ParamBodyAngleY: [[0, 0], [0.3, 6.5], [0.6, 7], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.4, -2.0], [1, 0]],
      ShoulderY: [[0, 0], [0.35, 3.2], [0.7, 2.6], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.3, -0.35], [0.7, -0.25], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.3, -0.35], [0.7, -0.25], [1, 0]],
    },
    face: '笑',
  },
  打瞌睡: {
    ms: 6200,
    lines: ['……zzZ', '啊，我没睡！', '就眯一下下……'],
    tracks: {
      // 慢慢低头 → 猛地一抬（点头惊醒）→ 回正
      ParamAngleY: [[0, 0], [0.35, -9], [0.5, -10.5], [0.58, 3.5], [0.72, -1.5], [1, 0]],
      ParamAngleX: [[0, 0], [0.5, 3.5], [0.6, -1.0], [1, 0]],
      ParamAngleZ: [[0, 0], [0.45, -3.0], [0.62, 1.5], [1, 0]],
      ParamBodyAngleY: [[0, 0], [0.45, -5.5], [0.6, 2.0], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.4, -0.5], [0.56, -0.55], [0.62, 0], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.4, -0.5], [0.56, -0.55], [0.62, 0], [1, 0]],
    },
  },
  抖尾巴: {
    ms: 2400,
    lines: ['尾巴自己会动哦。'],
    lineChance: 0.25,
    tracks: {
      ParamBodyAngleZ: [[0, 0], [0.2, 3.0], [0.4, -3.0], [0.6, 2.4], [0.8, -1.6], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.25, 2.2], [0.55, -2.0], [1, 0]],
      ParamAngleZ: [[0, 0], [0.25, -2.2], [0.55, 1.8], [1, 0]],
    },
  },
  理理头发: {
    ms: 4800,
    lines: ['头发乱没乱？', '嗯，还行。', '刚才有风吧。'],
    tracks: {
      ParamAngleX: [[0, 0], [0.3, -6], [0.6, -5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, 4.5], [0.62, 3.5], [1, 0]],
      ParamAngleY: [[0, 0], [0.35, -3.0], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.35, -2.5], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.35, 2.0], [1, 0]],
    },
  },
  // 吹狗尾草：举起狗尾草 → 小 O 嘴 → 一阵风吹动头发/耳朵
  吹狗尾草: {
    ms: 5600,
    lines: ['呼——', '草籽要飞走啦。', '轻轻的……'],
    pose: '狗尾草',
    gust: 2.2,
    mouth: { open: 0.3, funnel: 0.85, pucker: 0.6, form: -0.2 },
    tracks: {
      ParamAngleX: [[0, 0], [0.25, 4], [0.6, 3], [1, 0]],
      ParamAngleY: [[0, 0], [0.24, -5], [0.6, -4], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, 2.6], [0.62, -1.6], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 2.2], [1, 0]],
      ParamEyeLOpen: [[0, 0], [0.24, -0.22], [0.62, -0.28], [1, 0]],
      ParamEyeROpen: [[0, 0], [0.24, -0.22], [0.62, -0.28], [1, 0]],
    },
  },
  // 拜拜：竖起左食指（Pose: 竖手指）→ 整条左臂左右摆（Param44 主摆）→ 小臂/手腕慢半拍跟随
  挥挥手: {
    ms: 8200,
    lines: ['这边这边～', '嗨——', '看到我了吗？'],
    pose: '竖手指',
    mouth: { smile: 0.3, open: 0.1 },
    tracks: {
      // 头/身体/眉：跟视线、姿态在一条线上，走加性总线
      ParamBrowLY: [[0, 0], [0.07, 0.5], [0.16, -0.1], [0.26, 0.55], [0.35, -0.1], [0.45, 0.6], [0.55, -0.05], [0.64, 0.4], [0.75, 0], [1, 0]],
      ParamBrowRY: [[0, 0], [0.07, 0.45], [0.16, -0.1], [0.26, 0.5], [0.35, -0.1], [0.45, 0.55], [0.55, -0.05], [0.64, 0.35], [0.75, 0], [1, 0]],
      ParamAngleX: [[0, 0], [0.3, 4], [0.75, 5], [1, 0]],
      ParamAngleY: [[0, 0], [0.3, 3], [0.75, 3.5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.3, -3], [0.7, 3], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 3], [1, 0]],
      ParamEyeBallX: [[0, 0], [0.3, 0.15], [0.8, 0.2], [1, 0]],
    },
    // 物理输出：必须用 hold 写绝对值，否则会被物理回算吃掉
    holds: {
      // 主摆：左臂 Z 整条手臂左右甩（-1 收向脸侧 → +1 甩到外侧）
      Param44: [[0, 0], [0.14, -1], [0.3, 1], [0.46, -1], [0.62, 1], [0.78, -0.6], [0.9, 0], [1, 0]],
      // 大臂：比主摆晚半拍、幅度小
      LArm: [[0, 0], [0.18, 0.15], [0.44, -0.1], [0.7, 0.1], [0.86, -0.04], [0.95, 0], [1, 0]],
      // 小臂：跟着甩，方向反着来一点，惯性感更足
      LForearm: [[0, 0], [0.16, -0.15], [0.34, 0.2], [0.5, -0.18], [0.66, 0.18], [0.82, -0.08], [0.94, 0], [1, 0]],
      // 手腕：最后跟上，幅度最小但能看出「甩」
      LWrist: [[0, 0], [0.22, 0.5], [0.38, -0.5], [0.54, 0.5], [0.7, -0.5], [0.84, 0.2], [0.95, 0], [1, 0]],
      ShoulderZ: [[0, 0], [0.26, 2.4], [0.66, -1.8], [0.95, 0], [1, 0]],
      ShoulderY: [[0, 0], [0.3, -1.2], [0.7, 1.0], [0.95, 0], [1, 0]],
      HipAngleZ: [[0, 0], [0.26, 1.8], [0.7, -1.5], [1, 0]],
    },
  },
  // 戴铁盆：钢盆表情 + 摇头晃脑（左摇右晃，带一点身体跟随）
  戴铁盆: {
    ms: 5400,
    lines: ['铛——', '这样就不怕撞头啦。', '稳不稳？'],
    exprs: ['钢盆'],
    mouth: { smile: 0.22, open: 0.06 },
    tracks: {
      ParamAngleZ: [[0, 0], [0.12, -7], [0.28, 7], [0.44, -6], [0.6, 6], [0.76, -4], [0.9, 3], [1, 0]],
      ParamAngleX: [[0, 0], [0.18, 4], [0.5, -4], [0.82, 3], [1, 0]],
      ParamBodyAngleZ: [[0, 0], [0.14, -4], [0.34, 4], [0.56, -3.5], [0.76, 3], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 2.0], [1, 0]],
    },
  },
  // 凑近摇摆：竖食指 + 前倾 + 右手抬到背后 → 身体先沉再顶（不做镜像翻转了）
  凑近摇摆: {
    ms: 2800,
    lines: ['嗨呀～', '看这边！', '晃一晃～'],
    pose: '竖手指',
    mouth: { smile: 0.35, open: 0.08 },
    tracks: {
      ParamBodyAngleY: [[0, 0], [0.16, -6], [0.34, 1], [0.5, 7.5], [0.66, 1], [0.84, -3], [1, 0]],
      ParamAngleY: [[0, 0], [0.16, -4], [0.5, 5], [0.84, -2], [1, 0]],
      ParamBodyAngleX: [[0, 0], [0.3, 3], [0.6, -2.5], [1, 0]],
      ParamAngleZ: [[0, 0], [0.22, -4], [0.5, 4], [0.78, -2], [1, 0]],
      HipAngleZ: [[0, 0], [0.3, -3], [0.6, 3], [1, 0]],
    },
    holds: {
      // 前倾（纯物理输入：hold 会在物理之前写，物理链整条跟着动）
      LeanInput: [[0, 0], [0.14, -26], [0.6, -24], [0.86, -10], [1, 0]],
      // 右手抬到背后（Movement2 是默认手的姿势键，poses 每帧 hold 0，这里覆盖）
      Movement2: [[0, 0], [0.18, 1], [0.8, 1], [1, 0]],
      // 食指晃
      Param44: [[0, 0], [0.2, -1], [0.34, 1], [0.48, -0.9], [0.62, 0.9], [0.76, -0.5], [1, 0]],
      LWrist: [[0, 0], [0.26, 0.5], [0.4, -0.5], [0.54, 0.45], [0.68, -0.4], [0.84, 0.15], [1, 0]],
    },
  },
}

export function createIdleMotions({ bus, param, life, idleFaces, onLine, onStart, onFinish, onHold, options = {} } = {}) {
  const cfg = {
    enabled: true,
    speed: 1,           // 设置里的「待机频率」倍数：越大换动作越勤
    minGap: 8,          // 成套动作间隔（秒）
    maxGap: 18,
    startDelay: 6,
    fade: 0.45,         // 动作首尾的淡入淡出（秒），防止硬起停
    lineChance: 0.5,    // 动作附带一句小台词的概率
    lineMs: 4200,       // 台词停留时长
    // 常驻微摆的幅度（度）；0 就是只有随机动作
    swayX: 1.8,
    swayZ: 0.9,
    swayHeadZ: 0.7,
    swayHeadY: 0.8,
    ...options,
  }

  let t = Math.random() * 20   // 起始相位随机，换个窗口不会同步得像机器人
  let next = cfg.startDelay
  let cur = null               // { name, r, t, ms }
  let last = null
  let plays = 0
  let pausedUntil = 0
  // 需要「钉住」的参数（物理输出也能压住）：每帧写绝对值，动作结束/让位时释放
  const heldIds = new Set()
  function releaseHolds() {
    for (const id of heldIds) { try { onHold?.(id, null) } catch {} }
    heldIds.clear()
  }

  /** 用户一互动就让位：互动期间不换新动作，正在播的也快速收尾 */
  function pause(ms = 1500) {
    pausedUntil = Math.max(pausedUntil, performance.now() + ms)
    if (cur && cur.t > cur.ms * 0.5) {
      const done = cur
      cur = null
      try { onFinish?.(done.name, done.r) } catch {}
    }
  }

  /**
   * 互动打断：不是「暂停」，而是把当前动作彻底停掉 —— 交给 onFinish 撤表情/姿势/嘴型，
   * 再释放钉住的参数。否则会出现「黑脸时还在做打瞌睡」这种一只眼睁一只眼闭的怪状态。
   */
  function reset(ms = 2200) {
    const done = cur
    cur = null
    if (done) { try { onFinish?.(done.name, done.r) } catch {} }
    releaseHolds()
    pausedUntil = Math.max(pausedUntil, performance.now() + ms)
  }

  /** 解除让位（外部控制用；不再等满 pause 窗口） */
  function resume() {
    pausedUntil = 0
  }

  function trigger(name) {
    const names = Object.keys(ROUTINES)
    const pick = name && ROUTINES[name] ? name : names.filter((n) => n !== last)[Math.floor(Math.random() * (names.length - 1))]
    const r = ROUTINES[pick]
    cur = { name: pick, r, t: 0, ms: r.ms }
    last = pick
    try { onStart?.(pick, r) } catch {}
    plays += 1
    next = cfg.minGap + Math.random() * (cfg.maxGap - cfg.minGap)
    if (r.face) idleFaces?.trigger?.(r.face)
    if (pick === '抖尾巴') life?.flap?.(Math.random() < 0.5 ? 'L' : 'R', 0.55)
    // 小台词：不是每个动作都说话，概率低一点，桌面才不会像弹幕
    const chance = r.lineChance ?? cfg.lineChance
    if (onLine && r.lines?.length && Math.random() < chance) {
      const text = r.lines[Math.floor(Math.random() * r.lines.length)]
      onLine(text, cfg.lineMs)
    }
    return pick
  }

  const add = (id, delta) => {
    if (!delta || !Number.isFinite(delta)) return
    bus?.add(id, delta)
  }

  function apply(dtMs = 1000 / 60) {
    if (!cfg.enabled) return
    const dt = clamp(dtMs / 1000, 0.001, 0.12) * cfg.speed
    t += dt
    const paused = performance.now() < pausedUntil

    // ① 常驻微摆：三条不同周期的正弦，看起来像不自觉的换重心
    if (!paused) {
      add('ParamBodyAngleX', Math.sin(t * 0.31) * cfg.swayX)
      add('ParamBodyAngleZ', Math.sin(t * 0.22 + 1.3) * cfg.swayZ)
      add('ParamAngleZ', Math.sin(t * 0.27 + 0.6) * cfg.swayHeadZ)
      add('ParamAngleY', Math.sin(t * 0.19 + 2.1) * cfg.swayHeadY)
    }

    // ② 随机成套动作
    if (!paused) {
      if (!cur) {
        next -= dt
        if (next <= 0) trigger()
      } else {
        cur.t += dt * 1000            // 秒 → 毫秒（cur.ms 是毫秒）
        if (cur.t >= cur.ms) {
          const done = cur
          cur = null
          try { onFinish?.(done.name, done.r) } catch {}
        } else {
          const p = cur.t / cur.ms
          // 首尾各留 fade：整体乘一个钟形包络
          const fadeIn = clamp(cur.t / (cfg.fade * 1000), 0, 1)
          const fadeOut = clamp((cur.ms - cur.t) / (cfg.fade * 1000), 0, 1)
          const k = Math.min(fadeIn, fadeOut)
          for (const [id, keys] of Object.entries(cur.r.tracks)) add(id, sample(keys, p) * k)
          // 物理输出（左臂Z 等）走 hold：绝对值直接写，否则会被物理回算吃掉
          for (const [id, keys] of Object.entries(cur.r.holds || {})) {
            try { onHold?.(id, sample(keys, p) * k) } catch {}
            heldIds.add(id)
          }
        }
      }
    }
    if (paused || !cur) releaseHolds()
  }

  return {
    apply, trigger, pause, reset, resume,
    routines: () => Object.keys(ROUTINES),
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({
      current: cur?.name ?? null,
      progress: cur ? Math.round((cur.t / cur.ms) * 100) / 100 : 0,
      plays,
      nextIn: Math.round(next * 10) / 10,
      paused: performance.now() < pausedUntil,
    }),
  }
}
