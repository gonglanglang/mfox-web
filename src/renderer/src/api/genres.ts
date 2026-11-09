import { get } from './request'

export interface GenreItem {
  id: number
  name: string
  sort_order: number
  status: string
}

export const genresApi = {
  list() {
    return get<GenreItem[]>('/genres')
  }
}
