/**
 * 视线跟随（L1 层）—— 让角色「看着你」而不是只有眼珠转。
 *
 * 分三个通道，增益与惯性各不同，这是「灵动」的来源：
 *   眼珠（最快）→ 头部角度（中）→ 身体角度（最慢最轻，现由 posture 链负责）
 *
 * 写点：
 *   - 眼珠：直接写参数（不是物理输出，写了就生效）；
 *   - 头/身角度：**只往姿态总线累加**（见 pose-bus.js）。这几个参数在 physics3 里
 *     既入又出，物理会回头重算，谁直接写都会被另一方覆盖 —— 总线的存在就是为了这件事。
 *
 * 不使用内核的 focus()：它只给 eyeBall 与少量角度，无法分区调增益；而且会和这里打架。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createGaze({ param, bus, options = {} } = {}) {
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
    body: 0.45,         // × 30° → 13.5°（应用壳里实际由 posture 姿态链负责，这里留作无 posture 时的兜底）
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

  /**
   * 头/身角度**不直接写参数**，交给姿态总线（`pose-bus.js`）。
   *
   * 原因：`ParamAngle*` / `ParamBodyAngle*` 在 physics3 里既入又出，物理会回头重算它们。
   * 谁在物理后写就得替所有层负责，谁在物理前写就会被物理削掉 ——
   * 这正是之前「脸转了头不摇 / 头摇了脸不转」反复横跳的根源。
   * 现在各层只累加增量，由总线在物理前后各写一次。
   */
  const addAngle = (id, delta) => {
    if (!delta || !Number.isFinite(delta)) return
    if (bus) { bus.add(id, delta); return }
    const info = param.info(id)
    if (!info) return
    param.set(id, clamp(param.get(id) + delta, info.min, info.max))
  }

  /** 眼珠不是物理输出，直接写（也不参与姿态合成） */
  const addEye = (id, delta) => {
    if (!delta || !Number.isFinite(delta)) return
    const info = param.info(id)
    if (!info) return
    param.set(id, clamp(param.get(id) + delta, info.min, info.max))
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

    addEye('ParamEyeBallX', state.eyeX * cfg.eye)
    addEye('ParamEyeBallY', state.eyeY * cfg.eye)
    // 转头幅度：基础增益 × 用户可调的 headGain（歪头幅度一起放大，否则头转得多了会显得僵）
    const headAmp = cfg.head * cfg.headGain
    addAngle('ParamAngleX', state.headX * headAmp * 30)
    addAngle('ParamAngleY', state.headY * headAmp * 30)
    addAngle('ParamAngleZ', -state.headX * cfg.headRoll * cfg.headGain * 30)

    // 身体幅度按方向非对称：向下（埋头）多弯，向上收敛
    const bodyYk = state.bodyY < 0 ? cfg.bowBoost : cfg.liftDamp
    addAngle('ParamBodyAngleX', state.bodyX * cfg.body * 30)
    addAngle('ParamBodyAngleY', state.bodyY * cfg.body * bodyYk * 30)
    addAngle('ParamBodyAngleZ', -state.bodyX * cfg.bodyRoll * 30)
  }

  return {
    setTarget, setTargetFromScreen, apply,
    options: cfg,
    set(patch) { Object.assign(cfg, patch) },
    /** 当前平滑后的归一化状态（调试/截图用） */
    state: () => ({ ...state, target: { ...target } }),
  }
}
