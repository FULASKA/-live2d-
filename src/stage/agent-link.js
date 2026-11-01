/**
 * DSH 联动：把桥接插件写的「工作状态」翻译成气泡台词 + 表情 + 小动作。
 *
 * 状态语义（与 dsh-live2d-bridge / dsh-xiaoke 一致）：
 *   thinking / working / result / waiting / success / error，null = 空闲。
 *
 * 三条约束：
 *   1. 只动自己的 source（'agent'）：用户手动点的表情、切换装不会被我们撤掉；
 *   2. 同一档不反复刷气泡（只有状态真的变了才说话），避免每 400ms 轮询说一遍；
 *   3. 终态（success/error）说完几秒自己收起，回到待机，不长期糊在脸上。
 */

const EXPR_OF = {
  thinking: '屑屑眼',
  waiting: '＞＜',
  // 干活期间全程「加载」表情：表示正在忙，别以为她走神了
  working: '加载',
  error: '流冷汗',
}
// 收工那一下要「举手指 + 兔嘴 + 戴眼镜」：多表情叠一层，比单个爱心眼更像在邀功
const EXPRS_OF = {
  success: ['兔牙', '黑框眼镜'],
}

const HIDE_AFTER_MS = { success: 4600, error: 6000, result: 2200 }

// 工具 → 一句人话：状态一直是 working 的时候，光靠状态档她会长时间一动不动，
// 所以「换了工具」也要出个声，让她看起来真的在跟着干活。
const TOOL_LABEL = {
  write: '写文件', edit: '改文件', read: '翻代码', grep: '搜代码', glob: '找文件',
  ops_bash: '跑命令', bash: '跑命令', pwsh: '跑命令', ops_read_files: '读文件',
  web_search: '上网查', web_fetch: '读网页', ask_user_question: '等你回话',
  todo_write: '排任务', subagent: '派活', workflow: '跑流程', send_meme: '找表情包',
  live2d: '摆动作', skill: '翻技能书',
}
const TOOL_LINES = {
  写文件: ['写下来…', '这段我记一下', '敲字中…'],
  改文件: ['改一改', '这儿得动一下', '修修补补…'],
  翻代码: ['让我看看…', '翻翻代码', '嗯……这里有点眼熟'],
  搜代码: ['搜一下', '找找在哪儿', '关键词丢进去…'],
  找文件: ['文件呢…', '翻目录中', '我记得有个…'],
  跑命令: ['跑个命令', '命令行一下', '等它跑完…'],
  读文件: ['读一下', '看看内容', '翻两页…'],
  上网查: ['查一下资料', '上网看看', '搜搜看…'],
  读网页: ['读网页中', '这页有点长…', '爬一下'],
  等你回话: ['等你回话呢', '我在这儿等', '你说了算'],
  排任务: ['先排个顺序', '列个清单', '一步一步来'],
  派活: ['叫个帮手', '分头干', '派人去了'],
  跑流程: ['跑流程中', '好几个一起…', '开工了'],
  找表情包: ['找张图', '这张合适…', '表情包时间'],
  摆动作: ['动一下', '摆个姿势', '看这儿'],
  翻技能书: ['翻技能书', '查手册', '按流程来'],
}


export function createAgentLink({ bubble, layers, expressions = [], poses, life, mouth, onState } = {}) {
  let lastState = '__init__'
  let lastAt = 0
  let lastTool = null
  let lastToolKey = ''
  let hideTimer = 0
  let enabled = true
  let successMood = false

  const defOf = (name) => expressions.find((e) => e.name === name)

  function clearExpression() {
    try { layers?.removeSource('agent') } catch {}
  }

  function setExpressions(names) {
    // 用户互动表情（reaction / switch）在场时让位：两边都写 key3/5/6 会叠出怪眼型
    if (layers?.hasSource?.('reaction') || layers?.hasSource?.('switch')) return
    clearExpression()
    for (const name of [].concat(names || [])) {
      const def = defOf(name)
      if (!def) continue
      try { layers?.addExpression(name, def.params, { source: 'agent', fade: 0.24 }) } catch {}
    }
  }

  function scheduleHide(ms) {
    clearTimeout(hideTimer)
    if (!ms) return
    hideTimer = setTimeout(() => {
      bubble?.hide()
      // 终态收起时顺手把表情也撤掉，回到待机
      clearExpression()
      if (successMood) { try { mouth?.clearMood() } catch {}; successMood = false }
    }, ms)
  }

  function apply(snap) {
    if (!enabled) return
    const state = snap?.state ?? null
    const at = Number(snap?.at || 0)
    if (state === lastState && at === lastAt) return
    lastState = state
    lastAt = at

    if (!state) {
      clearExpression()
      if (successMood) { try { mouth?.clearMood() } catch {}; successMood = false }
      try { bubble?.unlock?.('agent') } catch {}
      lastTool = null
      lastToolKey = ''
      scheduleHide(1200)
      try { onState?.(null) } catch {}
      return
    }

    // 干活期间把气泡占住：待机台词 / 互动台词 / 外部 say 都顶不掉它
    const busy = state === 'thinking' || state === 'working' || state === 'waiting'
    try { busy ? bubble?.lock?.('agent') : bubble?.unlock?.('agent') } catch {}

    try { onState?.(state) } catch {}
    setExpressions(EXPRS_OF[state] ?? EXPR_OF[state] ?? null)
    // 收工的「兔嘴」：兔牙表情要张嘴才看得见，配一个抿嘴笑
    if (state === 'success') {
      successMood = true
      try { mouth?.setMood({ open: 0.32, smile: 0.3, form: -0.16 }, HIDE_AFTER_MS.success || 4600) } catch {}
    } else if (successMood) {
      try { mouth?.clearMood() } catch {}
      successMood = false
    }
    bubble?.say(state, { owner: busy ? 'agent' : null })

    // 换了工具就补一句「正在写文件 / 搜代码」：状态档不变时，光靠 working 一句话会挂很久，
    // 看起来像没在干活。这里只在工具（或细节）真的变了才说话，不会每 400ms 刷屏。
    const tool = snap?.tool ? String(snap.tool) : null
    const detail = snap?.detail ? String(snap.detail) : ''
    const toolKey = `${tool || ''}|${detail}`
    if (busy && (tool || detail) && toolKey !== lastToolKey) {
      const label = TOOL_LABEL[tool] || null
      if (label) {
        const lines = TOOL_LINES[label] || [`正在${label}…`]
        // 有细节（文件名 / 关键词 / 命令）就带上，比“正在干活”具体得多
        const line = detail ? `${label} · ${detail}` : lines[Math.floor(Math.random() * lines.length)]
        try { bubble?.show(line, { state, owner: 'agent' }) } catch {}
      }
    }
    lastToolKey = toolKey
    // 状态一变，耳朵扑棱一下（小动作，不抢气泡）
    try { life?.flap(Math.random() < 0.5 ? 'L' : 'R', 0.8) } catch {}

    scheduleHide(HIDE_AFTER_MS[state] || 0)

    // 收工的时候顺手竖个手指：只有这一档配动作，其他档留给用户交互
    if (state === 'success' && poses) {
      try { poses.set('竖手指', 320) } catch {}
      setTimeout(() => { try { poses.release(320) } catch {} }, 2400)
    }
  }

  /** 互动表情撤掉后，把当前状态的表情接回来（不重播气泡） */
  function reapply() {
    if (!enabled) return
    if (!lastState || lastState === '__init__') return
    setExpressions(EXPRS_OF[lastState] ?? EXPR_OF[lastState] ?? null)
  }

  return {
    apply,
    reapply,
    /** 外部指令接管气泡时，把状态联动的「几秒后自动收起」取消掉 */
    cancelHide() { clearTimeout(hideTimer) },
    /** 关掉联动（设置里可做开关；关掉后不再动表情，气泡也不弹） */
    setEnabled(v) {
      enabled = !!v
      if (!enabled) { clearExpression(); bubble?.hide() }
    },
    get enabled() { return enabled },
    state() { return { enabled, lastState, lastAt } },
  }
}
