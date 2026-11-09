import type { PersonaItem } from '@/api/personas'

/** 获取角色当前形象图 URL：优先 cur_image_id，其次第一张 */
export function personaImage(char?: PersonaItem): string {
  if (!char?.images?.length) return ''
  const current = char.images.find(i => i.id === char.cur_image_id)
  return (current ?? char.images[0])?.url ?? ''
}