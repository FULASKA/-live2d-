/**
 * 痒痒的（被挠痒反应）—— 摸脚 / 摸腰时的一小段「躲不掉的笑」。
 *
 * 三路一起给：
 *   1. **弯腰组件小幅度快抖**：胸腔 `ParamBodyAngleX2` + 盆骨 `HipAngleZ` 左右快摆；
 *   2. **两侧小臂摆动**：`LForearm` / `RForearm` 反相摆动（这两条是物理输出，必须 hold）；
 *   3. **两只耳朵扑腾**：每 0.28 秒扑一下，幅度小、频率快，看起来是被痒得直抖。
 *
 * 台词走 phrases 的 tickle 档；嘴形由 renderer 的分区情绪补（忍不住笑）。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createTickle({ param, bus, life, onHold, options = {} } = {}) {
  const cfg = {
    ms: 2600,          // 一整段
    hz: 4.2,           // 抖动频率
    forearm: 0.34,     // 小臂摆动幅度（归一化）
    forearmBase: 0.26, // 小臂抬起的基础量：被挠时手臂会不自觉抬一点
    chest: 2.6,        // 胸腔快摆（度）
    hip: 2.2,          // 盆骨快摆（度）
    head: 2.4,         // 歪头跟着抖（度）
    flapEvery: 0.28,   // 耳朵扑腾间隔（秒）
    flapAmp: 0.75,
    ...options,
  }

  let t = 0
  let active = false
  let nextFlap = 0
  let flaps = 0
  const held = new Set()

  const hold = (id, v) => {
    try { onHold?.(id, v) } catch {}
    held.add(id)
  }
  const add = (id, d) => { if (d) bus?.add(id, d) }

  function release() {
    for (const id of held) { try { onHold?.(id, null) } catch {} }
    held.clear()
  }

  function stop() {
    active = false
    release()
  }

  /** 开始一段痒痒（重复触发会从头开始） */
  function start() {
    t = 0
    active = true
    nextFlap = 0
  }

  function apply(dtMs = 1000 / 60) {
    if (!active) return
    const dt = clamp(dtMs / 1000, 0.001, 0.12)
    t += dt
    const p = t / (cfg.ms / 1000)
    if (p >= 1) { stop(); return }
    // 钟形包络：起手第一下不至于硬起，收尾自然松开
    const env = Math.sin(Math.PI * clamp(p, 0, 1))
    const osc = Math.sin(t * Math.PI * 2 * cfg.hz)

    // 两侧小臂反相摆（物理输出，绝对写）
    hold('LForearm', env * (cfg.forearmBase + cfg.forearm * osc))
    hold('RForearm', env * (cfg.forearmBase - cfg.forearm * osc))
    // 盆骨：跟着抖（物理输出）
    hold('HipAngleZ', env * cfg.hip * -osc)
    // 胸腔 / 歪头：加性走总线（物理输入，别覆盖）
    add('ParamBodyAngleX2', env * cfg.chest * osc)
    add('ParamAngleZ', env * cfg.head * osc)
    add('ParamBodyAngleZ', env * 1.6 * -osc)

    // 两只耳朵快速扑腾
    nextFlap -= dt
    if (nextFlap <= 0) {
      nextFlap = cfg.flapEvery
      flaps += 1
      try { life?.flap?.(flaps % 2 ? 'B' : 'L', cfg.flapAmp, cfg.flapEvery * 0.9) } catch {}
    }
  }

  return {
    start,
    stop,
    apply,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({ active, t: +t.toFixed(2), flaps, held: [...held] }),
  }
}
