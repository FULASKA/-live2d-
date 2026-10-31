/** 几何工具：点内判定 / 包围盒 / 凸包精简。纯函数，无外部依赖。 */
/** 射线法：点是否在多边形内（支持凹多边形） */
export function pointInPolygon(px, py, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1]
    const xj = points[j][0], yj = points[j][1]
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function polygonBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** Andrew 单调链凸包；用于把一堆网格顶点收成一个顺手的热区轮廓 */
export function convexHull(points) {
  if (points.length < 3) return points.slice()
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** 顶点太多时抽稀：保留转角明显的点，热区不必精确到发丝 */
export function simplify(points, tolerance = 6) {
  if (points.length <= 8) return points
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = out[out.length - 1]
    const [bx, by] = points[i]
    const [cx, cy] = points[i + 1]
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
    const base = Math.hypot(cx - ax, cy - ay) || 1
    if (area / base > tolerance) out.push(points[i])
  }
  out.push(points[points.length - 1])
  return out
}
