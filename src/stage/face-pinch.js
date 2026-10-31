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

export function createFacePinch({ param, bus, options = {} } = {}) {
  const cfg = {
    maxPull: 260,        // 拖动多少像素算拉满
    // 响应曲线 pow>1：**前段更钝**。原来 0.62 时轻拖 30px 就跳到 35%，
    // 想要的是「轻轻捏一下只有一点点变化」，所以让位移和效果在前段更接近线性偏缓。
    curvePow: 1.15,
    follow: 10,          // 跟手速度（1/s）
    releasePerSec: 4.5,  // 松手回落速度
    puff: 1,             // 整体鼓脸比例（按参数量程）
    side: 1,             // 单边鼓脸比例
    wiggleHz: 3.2,
    wiggle: 0.25,
    pucker: 0.35,        // 被捏时撅嘴（加强「被捏住」的可读性）
    headTurn: 18,       // 拉满时头的额外偏转角度（@maxPull 像素）
    maxHeadTurn: 20,    // 上限
    // 前倾耦合（物理输入）：模型前倾时脸会贴近镜头，实测脸框 727→938 宽（+29%），
    // 鼓脸的视觉可读性主要靠这一下放大——单写 CheeckPuff 时变化非常小。
    leanIdle: -5,        // 刚捏住时的前倾量
    leanFull: -26,       // 拉满时的前倾量（量程 ±30）
    leanBlocked: null,   // () => boolean：用户手动开了「前倾」时为 true，让位
    ...options,
  }

  let side = null      // 'L' | 'R' | null
  let pulled = 0       // 累计拉扯量（像素）
  let mag = 0          // 归一化 0..1（平滑后）
  let target = 0
  let phase = 0
  const writes = {}
  let testSide = null
  // 捏脸时头的跟随偏向（累积位移，松手回零）
  const push = { x: 0, y: 0 }

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
  /** 加性写（头跟随时用，不覆盖 gaze / 待机动作）：角度类走姿态总线 */
  const add = (id, delta) => {
    if (!delta) return
    if (bus) { bus.add(id, delta); return }
    const r = range(id)
    if (!r) return
    param.set(id, clamp(param.get(id) + delta, r.lo, r.hi))
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
    target = Math.pow(clamp(pulled / cfg.maxPull, 0, 1), cfg.curvePow)
    // 头跟着手走：累积带方向的位移，apply 里换成角度
    push.x = clamp(push.x + dx, -cfg.maxPull * 2, cfg.maxPull * 2)
    push.y = clamp(push.y + dy, -cfg.maxPull * 2, cfg.maxPull * 2)
  }
  function release() {
    side = null
    pulled = 0
    target = 0
    push.x = 0
    push.y = 0
  }

  /**
   * 物理输入写点（必须早于 physics.evaluate，别写到 apply 里）：
   * 捏住时把身体往前带一点，脸贴近镜头会整体放大 —— 这是「捏脸变化明显」的关键一步。
   * 实测 LeanInput -30 时脸框 727→938 宽（+29%），而单写 CheeckPuff 几乎看不出来。
   * 用户若手动开了「前倾」（同一个参数），就让位给他的选择。
   */
  function applyPhysics() {
    const r = range('LeanInput')
    if (!r) return
    if (!side && mag < 0.01) return
    if (cfg.leanBlocked && cfg.leanBlocked()) return
    const want = cfg.leanIdle + (cfg.leanFull - cfg.leanIdle) * mag
    param.set('LeanInput', clamp(want, r.lo, r.hi))
  }

  function apply(dtMs = 1000 / 60) {
    // 调试用：强制单边鼓脸（验证 L/R 到底对应哪边脸）
    if (testSide) {
      writeFrac('CheeckPuff', 1)
      writeFrac('CheeckPuff2', 0.6)
      writeFrac('CheeckPuffL', testSide === 'L' ? 1 : 0)
      writeFrac('CheeckPuffR', testSide === 'R' ? 1 : 0)
      return { mag: 1 }
    }
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
    // 左右映射是实测出来的（不是看名字）：单写 CheeckPuffL 时变化集中在**画面右半边**，
    // 单写 CheeckPuffR 时集中在**画面左半边** —— 所以「左脸热区（画面左）」要写 R。
    // 之前按名字对应，捏左脸却鼓右脸，就是这个原因。
    if (has('CheeckPuffL')) writeFrac('CheeckPuffL', side === 'R' ? m * cfg.side : 0)
    if (has('CheeckPuffR')) writeFrac('CheeckPuffR', side === 'L' ? m * cfg.side : 0)
    if (has('CheeksWiggleX')) writeAbs('CheeksWiggleX', wiggleAmt)
    // 被捏住时撅一下嘴：脸的参数变化本来就弱，嘴一动「被捏住」立刻就成立了
    if (has('Mouthpucker')) add('Mouthpucker', m * cfg.pucker)

    // 头跟着被捏的方向转：脸的变化没那么明显，靠头的幅度把「怕疼跟着走」演出来
    // （角度部分已挪到 applyPosture：物理要用到它，必须写在物理之前）
    if (!side) {
      const decay = Math.exp(-dt * 7)
      push.x *= decay
      push.y *= decay
      if (Math.abs(push.x) < 0.3) push.x = 0
      if (Math.abs(push.y) < 0.3) push.y = 0
    }

    return { mag: +m.toFixed(2) }
  }

  /**
   * 姿态部分（物理之前写）：捏脸时头跟着手转。
   * 必须在 physics.evaluate 之前 —— 头一转，模型自带的头发/耳朵物理才会跟着甩。
   */
  function applyPosture(dtMs = 1000 / 60) {
    const dt = clamp(dtMs / 1000, 0.001, 0.12)
    if (!side) {
      const decay = Math.exp(-dt * 7)
      push.x *= decay
      push.y *= decay
      if (Math.abs(push.x) < 0.3) push.x = 0
      if (Math.abs(push.y) < 0.3) push.y = 0
    }
    if (push.x || push.y) {
      const hz = clamp((push.x / cfg.maxPull) * cfg.headTurn, -cfg.maxHeadTurn, cfg.maxHeadTurn)
      const hy = clamp((push.y / cfg.maxPull) * cfg.headTurn * 0.7, -cfg.maxHeadTurn, cfg.maxHeadTurn)
      add('ParamAngleZ', hz)
      add('ParamAngleY', -hy)
      // 捏脸也朝手的方向转脸：只歪不转的话，脸被拽住会像贴片。
      // 系数比歪头大：捏拉通常只有几十像素，按 hz 原样写太小（60px 只有 4°）。
      add('ParamAngleX', hz * 2.2)
      add('ParamBodyAngleZ', hz * 0.3)
    }
  }

  return {
    grab, move, release, apply, applyPhysics, applyPosture,
    test(side) { testSide = side || null },
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    params: () => ['CheeckPuff', 'CheeckPuffL', 'CheeckPuffR', 'CheeckPuff2', 'CheeksWiggleX'].filter(has),
    state: () => ({ side, mag: +mag.toFixed(2), push: { x: Math.round(push.x), y: Math.round(push.y) }, writes: { ...writes } }),
  }
}
