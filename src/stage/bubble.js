/**
 * 对话气泡（DOM 浮层）。
 *
 * 尺寸规则（按需求定的三段）：
 *   1. 字少 → 用大字（基础字号），框小、贴着脑袋；
 *   2. 字多 → 字号逐级变小、框跟着变宽变高（有最大宽/高）；
 *   3. 撑到最大高度 → 框不再变大，内容变成可上下滑动。
 *
 * 位置：默认浮在头顶上方居中；头顶空间不够就翻到下方。
 * 气泡只负责「显示」，谁来说话、什么时候说，由调用方决定。
 */

const FONT_STEPS = [
  [24, 22],   // ≤24 字：22px
  [64, 18],
  [140, 16],
  [240, 14],
  [Infinity, 13],
]

export function createBubble({ el, anchor, side = 'right' }) {
  if (!el) throw new Error('bubble: 缺少容器')
  el.classList.add('bubble')
  let visible = false
  let lastText = ''
  let anchorSide = side === 'left' ? 'left' : 'right'

  const viewport = () => ({ w: window.innerWidth, h: window.innerHeight })

  /** 按字数选字号 */
  const fontFor = (len) => {
    for (const [max, px] of FONT_STEPS) if (len <= max) return px
    return 13
  }

  /**
   * 排版：字号 → 量高 → 超出就继续缩字号；缩到最小还高 → 定高 + 滚动。
   * 宽度交给 CSS（min/max-width + fit-content），框会随文字变宽，到上限后换行变高。
   */
  function layout(text) {
    const vp = viewport()
    const maxH = Math.max(120, vp.h * 0.36)
    el.style.maxWidth = `${Math.round(vp.w * 0.72)}px`
    el.style.maxHeight = `${Math.round(maxH)}px`

    const len = Array.from(text).length
    let fs = fontFor(len)
    el.style.fontSize = `${fs}px`
    el.style.overflowY = 'visible'
    el.style.height = 'auto'

    // 字号已经按档位给过了，这里只在「真的放不下」时再压一档，避免小窗里顶破屏幕
    let guard = 0
    while (el.scrollHeight > maxH && fs > 12 && guard++ < 12) {
      fs -= 1
      el.style.fontSize = `${fs}px`
    }
    if (el.scrollHeight > maxH) {
      el.style.height = `${Math.round(maxH)}px`
      el.style.overflowY = 'auto'
    }
    return { fs, maxH }
  }

  /**
   * 漫画式定位：气泡挂在「头顶的右侧/左侧角上」，不是悬在正上方。
   *   - 右侧：气泡左下角贴着头的右上方（略微重叠一点，像对话框压过来）
   *   - 左侧：镜像
   * 角色靠边放不下时自动翻到另一侧；上下方向同理。
   */
  function place() {
    const a = anchor?.()
    const vp = viewport()
    const w = el.offsetWidth || 240
    const h = el.offsetHeight || 80
    const gap = 10
    let side = anchorSide
    let x, y
    if (a) {
      const topY = a.top - Math.round(h * 0.18) // 主体在头顶附近，不算「头顶正中」
      if (side === 'right') {
        x = a.right - 12
        if (x + w > vp.w - 6) { side = 'left'; x = a.left + 12 - w }
      } else {
        x = a.left + 12 - w
        if (x < 6) { side = 'right'; x = a.right - 12 }
      }
      y = topY - h - gap
      if (y < 6) y = a.top + 6 // 头顶空间不够 → 贴着头上沿往下挂
    } else {
      x = vp.w / 2 - w / 2
      y = vp.h * 0.16
    }
    x = Math.max(6, Math.min(vp.w - w - 6, x))
    y = Math.max(6, Math.min(vp.h - h - 6, y))
    el.style.left = `${Math.round(x)}px`
    el.style.top = `${Math.round(y)}px`
    el.dataset.anchor = side
    // 气泡在头顶上方 → 尾巴朝下；挂在头侧 → 尾巴朝上
    el.dataset.side = a && y + h + 2 <= a.top ? 'above' : 'below'
  }

  return {
    /** 换文字（不闪不重建）；state 用来染色：thinking / working / waiting / success / error */
    set(text, { state: st } = {}) {
      const t = String(text ?? '')
      if (st) el.dataset.state = st
      if (t === lastText) { if (visible) place(); return }
      lastText = t
      el.textContent = t
      el.classList.toggle('empty', t.length === 0)
      if (visible) { layout(t); place() }
    },
    show(text, opts = {}) {
      if (text != null) this.set(text, opts)
      visible = true
      el.classList.add('on')
      layout(lastText)
      place()
      // 量完再定一次位（首帧字号还没生效时高度会差一点）
      requestAnimationFrame(() => { if (visible) place() })
    },
    hide() {
      visible = false
      el.classList.remove('on')
    },
    /** 位置依赖角色位置，角色一动（拖窗口/换尺寸）就重排 */
    reposition() { if (visible) place() },
    /** 挂在头的左侧还是右侧（设置里可切） */
    setSide(s) {
      anchorSide = s === 'left' ? 'left' : 'right'
      if (visible) place()
    },
    get side() { return anchorSide },
    get visible() { return visible },
    get text() { return lastText },
    state() { return { visible, text: lastText, w: el.offsetWidth, h: el.offsetHeight, fs: parseFloat(el.style.fontSize) || 0, scroll: el.style.overflowY === 'auto' } },
  }
}
