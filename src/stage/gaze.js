/**
 * 视线与身体跟随（L1 层）—— 让角色「看着你」而不是只有眼珠转。
 *
 * 分三个通道，增益与惯性各不同，这是「灵动」的来源：
 *   眼珠（最快）→ 头部角度（中）→ 身体角度（最慢最轻）
 * 全部是**加性**写入：先读当前值（含 Idle 动作自带的小幅摆动），再加偏移并夹到参数范围内，
 * 所以跟随不会把待机动画压死。写点仍然是 beforeModelUpdate。
 *
 * 不使用内核的 focus()：它只给 eyeBall 与少量角度，无法分区调增益；而且会和这里打架。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createGaze({ param, options = {} } = {}) {
  const cfg = {
    enabled: true,
    strength: 1,        // 总强度 0..1
    deadZone: 0.06,     // 中心死区，避免静止时抖
    // 各通道：满偏时写多少（eye 是 ±1 的量程，head/body 是角度制的比例）
    // 实测本模型（3749×7697 画布）：ParamAngleY 满偏只带动头部约 110–148px；
    // ParamBodyAngleY（胸腔）满偏能带动头部约 450px —— 埋头/抬头真正的杠杆在身体。
    eye: 0.85,
    head: 0.9,          // × ParamAngleX 的 30° → 27°
    // 转头幅度总增益（设置里的「转头幅度」滑杆，默认 1.25 → 约 34°）。
    // 注意 ParamAngleX/Y 的量程就是 ±30°：满偏时会被 add() 夹住，
    // 所以增益主要拉的是**中段**（指针在角色附近小幅移动时的角度），这正是「看着更灵动」的地方。
    headGain: 1.25,
    headRoll: 0.12,     // × 30° → 3.6°，横向看时轻微歪头
    body: 0.45,         // × 30° → 13.5°
    bodyRoll: 0.08,
    // 响应曲线：指针在角色附近的小幅移动也给足角度（pow<1 → 前段更灵敏），
    // 否则窗口内活动时头部几乎不动，物理链（头发/耳朵）就吃不到输入。
    curve: 0.7,
    // 非对称：低头时身体多弯（像真的埋下头），抬头时收敛些，避免整个人往后折
    bowBoost: 1.7,      // 目标向下时，身体幅度 × 1.7
    liftDamp: 0.8,      // 目标向上时，身体幅度 × 0.8
    // 阻尼（1/s）：越大越跟手
    dampingEye: 20,
    dampingHead: 7,
    dampingBody: 3.5,
    // 轴向翻转：某些模型把 eyeBall / angle 绑反了，或用户的直觉要求相反时用它校正。
    // 默认不翻转（本模型实测：+EyeBallY / +AngleY 均向上，+AngleX / +BodyAngleX 均向右）。
    invertX: false,
    invertY: false,
    // 物理后再把头部角度写回一次（physics3 会把 ParamAngleX/Y 当输出重算）
    holdPost: true,
    ...options,
  }

  const target = { x: 0, y: 0 }
  const state = { eyeX: 0, eyeY: 0, headX: 0, headY: 0, bodyX: 0, bodyY: 0 }

  /** 响应曲线：保留符号，前段更灵敏 */
  const curve = (v) => (v === 0 ? 0 : Math.sign(v) * Math.pow(Math.abs(v), cfg.curve))

  /** 指针屏幕坐标 → 归一化目标（-1..1，右/上为正），以角色中心为原点 */
  function setTargetFromScreen(px, py, centerX, centerY, halfW, halfH) {
    const nx = clamp((px - centerX) / (halfW || 1), -1, 1)
    const ny = clamp((centerY - py) / (halfH || 1), -1, 1)
    setTarget(nx, ny)
  }

  function setTarget(nx, ny) {
    const dead = cfg.deadZone
    target.x = cfg.invertX ? -nx : nx
    target.y = cfg.invertY ? -ny : ny
    if (Math.abs(target.x) < dead) target.x = 0
    if (Math.abs(target.y) < dead) target.y = 0
  }

  /** 只记头部三通道：physics3 的输出里有 ParamAngleX/Y，其余通道不管 */
  const HEAD_IDS = new Set(['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'])
  const written = new Map()

  const add = (id, delta) => {    if (!delta) return
    const info = param.info(id)
    if (!info) return
    const v = clamp(param.get(id) + delta, info.min, info.max)
    param.set(id, v)
    if (HEAD_IDS.has(id)) written.set(id, v)
  }

  /** 每帧调用（beforeModelUpdate 时刻） */
  function apply(dtMs = 1000 / 60) {
    const dt = Math.max(1, dtMs) / 1000
    const k = (damping) => 1 - Math.exp(-damping * dt)

    const tx = curve(target.x) * cfg.strength
    const ty = curve(target.y) * cfg.strength

    const ke = k(cfg.dampingEye)
    state.eyeX += (tx - state.eyeX) * ke
    state.eyeY += (ty - state.eyeY) * ke

    const kh = k(cfg.dampingHead)
    state.headX += (tx - state.headX) * kh
    state.headY += (ty - state.headY) * kh

    const kb = k(cfg.dampingBody)
    state.bodyX += (tx - state.bodyX) * kb
    state.bodyY += (ty - state.bodyY) * kb

    if (!cfg.enabled) return

    add('ParamEyeBallX', state.eyeX * cfg.eye)
    add('ParamEyeBallY', state.eyeY * cfg.eye)
    // 转头幅度：基础增益 × 用户可调的 headGain（歪头幅度一起放大，否则头转得多了会显得僵）
    const headAmp = cfg.head * cfg.headGain
    add('ParamAngleX', state.headX * headAmp * 30)
    add('ParamAngleY', state.headY * headAmp * 30)
    add('ParamAngleZ', -state.headX * cfg.headRoll * cfg.headGain * 30)

    // 身体幅度按方向非对称：向下（埋头）多弯，向上收敛
    const bodyYk = state.bodyY < 0 ? cfg.bowBoost : cfg.liftDamp
    add('ParamBodyAngleX', state.bodyX * cfg.body * 30)
    add('ParamBodyAngleY', state.bodyY * cfg.body * bodyYk * 30)
    add('ParamBodyAngleZ', -state.bodyX * cfg.bodyRoll * 30)
  }

  /**
   * 物理之后再兜一次头部角度。
   *
   * 为什么需要：physics3 的输出里带有 ParamAngleX / ParamAngleY（头部角度既是物理输入、
   * 又被物理回头重算），实测物理前写进 25.6°、物理后只剩 11°——「脸不转」就是这个原因。
   * 这里把物理前写下的值在物理后原样写回：物理已经用正确的输入算了头发/耳朵，
   * 视觉上的角度也不会被削掉。
   */
  function applyPost() {
    if (!cfg.enabled || !cfg.holdPost || !written.size) return
    for (const [id, v] of written) {
      if (Math.abs(param.get(id) - v) > 1e-4) param.set(id, v)
    }
    written.clear()
  }

  return {
    setTarget, setTargetFromScreen, apply, applyPost,
    options: cfg,
    set(patch) { Object.assign(cfg, patch) },
    /** 当前平滑后的归一化状态（调试/截图用） */
    state: () => ({ ...state, target: { ...target } }),
  }
}
