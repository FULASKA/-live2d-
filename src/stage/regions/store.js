/** 热区仓库：增删改查、命中判定、JSON 存档。 */
import { pointInPolygon } from './geometry.js'

export function createRegionStore(initial = []) {
  let regions = initial.slice()

  const api = {
    get all() { return regions },
    /** z 大的优先；同 z 时后加入的优先（后画 = 更靠前）。holes 里的洞不算命中 */
    hit(mx, my) {
      let found = null
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i]
        if (!pointInPolygon(mx, my, r.points)) continue
        if (r.holes && r.holes.some((h) => pointInPolygon(mx, my, h))) continue
        if (!found || r.z > found.region.z || (r.z === found.region.z && i > found.index)) {
          found = { region: r, index: i }
        }
      }
      return found ? found.region : null
    },
    add(region) {
      const r = {
        id: region.id || `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`,
        name: region.name || '新区域',
        points: region.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
        // 洞（差集）：尾巴被身体各段挡住的区域，形状上就不该与它们重叠
        holes: (region.holes || []).map((h) => h.map(([x, y]) => [Math.round(x), Math.round(y)])),
        z: region.z ?? 1,
        reaction: region.reaction || {},
      }
      regions.push(r)
      return r
    },
    remove(id) {
      const i = regions.findIndex((r) => r.id === id)
      if (i >= 0) regions.splice(i, 1)
      return i >= 0
    },
    update(id, patch) {
      const r = regions.find((x) => x.id === id)
      if (r) Object.assign(r, patch)
      return r
    },
    replaceAll(list) { regions = list.slice() },
    toJSON(modelKey) {
      return { schemaVersion: 2, model: modelKey, regions }
    },
    storageKey(modelKey) { return `live2d-stage/profile/v2/${modelKey}` },
    save(modelKey) {
      try { localStorage.setItem(api.storageKey(modelKey), JSON.stringify(api.toJSON(modelKey))); return true } catch { return false }
    },
    load(modelKey) {
      try {
        const raw = localStorage.getItem(api.storageKey(modelKey))
        if (!raw) return false
        return api.loadJSON(JSON.parse(raw))
      } catch { return false }
    },
    loadJSON(json) {
      if (!json || !Array.isArray(json.regions)) return false
      regions = json.regions
      return true
    },
  }
  return api
}

/**
 * 自动铺初稿：按部件名收集顶点，再用包围盒成矩形（尾巴用凸包，因为它是弯的）。
 *
 * 为什么不用凸包铺全身：凸包会把手臂、裙摆这些外扩的网格都算进去，
 * 结果每个热区都是覆盖半个身体的大四边形，互相叠成一团，反而不可用。
 * 矩形虽然朴素，但可预测、好拖动，也正是「用户随手改」的起点。
 * （PSD 与画布同尺寸，后续可直接吃图层蒙版得到贴合轮廓的形状。）
 */
/**
 * 分区初稿：六段竖切片 + 尾巴差集。
 *
 * 为什么不再拿每个部件的包围盒直接出框：
 *   头发垂到腰、裙摆盖住腿，部件包围盒互相穿插，直接出框会得到一堆斜叠的大四边形，
 *   点击互相抢。这里改成「先按解剖锚点定横向分界，再按部位取横向范围」：
 *   锚点全部来自模型自己的网格（脖子下缘 / 胸衣下缘 / 短裙下缘 / 鞋底），
 *   缩放、换姿势都不会漂。
 *
 * 本模型实测锚点（画布 3749×7697）：头顶 935 · 脖子下缘 2012 · 胸衣下缘 2849
 *   腰/裙分界 ≈3622（短裙上缘 + 45% 裙高）· 短裙下缘 4433 · 鞋口 ≈6662 · 鞋底 7334
 */
