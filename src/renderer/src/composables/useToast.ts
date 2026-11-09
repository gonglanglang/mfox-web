import { ref } from 'vue'

interface ToastOptions { message: string; type?: 'success' | 'error' | 'info'; duration?: number }

const toast = ref<ToastOptions | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

export function useToast() {
  function show(message: string, type: 'success' | 'error' | 'info' = 'success', duration = 2500) {
    toast.value = { message, type, duration }
    console.log('showToast', toast.value)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { toast.value = null }, duration)
  }

  return { toast, show }
}
