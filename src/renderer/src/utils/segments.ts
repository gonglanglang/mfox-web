/** 分镜中的片段：旁白或对白 */
export interface Segment {
  type: 'narration' | 'dialogue'
  text: string
  role_id?: number
  audioUrl?: string
  speaker?: string
  tone?: string
  emotion?: string
  dialogue_id?: string | number
  prop_ids?: (string | number)[]
}

/** 合并相邻旁白片段（纯函数，不修改原数组） */
export function mergeAdjacentNarrations(segments: Segment[]): Segment[] {
  const merged: Segment[] = []
  for (const seg of segments) {
    const last = merged[merged.length - 1]
    if (seg.type === 'narration' && last && last.type === 'narration') {
      last.text += seg.text
    } else {
      merged.push({ ...seg })
    }
  }
  return merged
}
