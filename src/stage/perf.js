/**
 * 轻量性能计数 —— 只为回答一个问题：每帧的钱花在哪。
 *
 * 设计约束：
 *   - 不能影响被测对象。所有计时是 performance.now() 包一层，不做字符串拼接、不做分配。
 *   - 可以常驻。F3 才显示浮层，统计本身一直在跑（开销 ~0.3µs/次）。
 *   - snapshot() 默认清零，方便「跑一段场景 → 读一次 → 得到该场景的均值」。
 *
 * 用法：
 *   perf.time('mask', () => stage.alphaMask(4))   // 计一次耗时，返回原函数的返回值
 *   perf.mark('pre', ms)                          // 已有耗时，直接记账
 *   perf.frame()                                  // 每帧调一次，用来算 FPS
 *   perf.snapshot()                               // { fps, mask:{avg,max,n}, ... }
 */

export function createProfiler() {
  const slots = new Map()          // key -> { sum, max, n }
  let frames = 0
  let t0 = performance.now()
  let fps = 0
  let lastFrame = 0

  const slot = (k) => {
    let s = slots.get(k)
    if (!s) { s = { sum: 0, max: 0, n: 0 }; slots.set(k, s) }
    return s
  }

  return {
    /** 包住一段同步代码计时；异常不影响清理 */
    time(key, fn) {
      const a = performance.now()
      try {
        return fn()
      } finally {
        const d = performance.now() - a
        const s = slot(key)
        s.sum += d
        if (d > s.max) s.max = d
        s.n += 1
      }
    },
    /** 已知耗时直接记账（跨异步边界用） */
    mark(key, ms) {
      const s = slot(key)
      s.sum += ms
      if (ms > s.max) s.max = ms
      s.n += 1
    },
    /** 每帧一次；同时把帧间隔记进 dt（掉帧会体现在 dt.max 上） */
    frame() {
      frames += 1
      const now = performance.now()
      if (lastFrame) {
        const d = now - lastFrame
        const s = slot('dt')
        s.sum += d
        if (d > s.max) s.max = d
        s.n += 1
      }
      lastFrame = now
      const span = now - t0
      // 500ms 窗口滚动，避免启动首帧拉低均值
      if (span >= 500) {
        fps = (frames * 1000) / span
        frames = 0
        t0 = now
      }
    },
    /** 读一眼，默认清零（下一个场景从零开始统计） */
    snapshot(reset = true) {
      const out = { fps: Math.round(fps * 10) / 10 }
      for (const [k, s] of slots) {
        out[k] = {
          avg: s.n ? Math.round((s.sum / s.n) * 100) / 100 : 0,
          max: Math.round(s.max * 100) / 100,
          n: s.n,
        }
        if (reset) { s.sum = 0; s.max = 0; s.n = 0 }
      }
      return out
    },
    /** 重置统计（含 FPS 窗口） */
    reset() {
      for (const s of slots.values()) { s.sum = 0; s.max = 0; s.n = 0 }
      frames = 0
      t0 = performance.now()
    },
  }
}
