import { ref } from 'vue'

const THEME_KEY = 'ai-comic-theme'

export const themes = [
  { id: 'cupcake',  label: '🧁 纸杯蛋糕',  type: 'light' },
  { id: 'aqua',     label: '💧 水蓝',      type: 'light' },
  { id: 'dim',      label: '🌙 暗灰',      type: 'dark' },
  { id: 'night',    label: '🌃 黑夜',      type: 'dark' },
  { id: 'dracula',  label: '🧛 德古拉',    type: 'dark' },
  { id: 'sunset',   label: '🌅 日落',      type: 'dark' },
] as const

export function useTheme() {
  const theme = ref(localStorage.getItem(THEME_KEY) || 'cupcake')

  function setTheme(t: string) {
    theme.value = t
    localStorage.setItem(THEME_KEY, t)
  }

  return { theme, themes, setTheme }
}
