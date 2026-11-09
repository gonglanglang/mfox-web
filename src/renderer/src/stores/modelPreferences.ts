import { defineStore } from 'pinia'
import type { ModelContentType } from '@/api/models'

const STORAGE_KEY = 'mfox:model-preferences'

interface ModelOptionPreference {
  resolution: string
}

interface ModelPreferencesState {
  selectedModels: Partial<Record<ModelContentType, string>>
  modelOptions: Record<string, ModelOptionPreference>
}

function loadState(): ModelPreferencesState {
  const fallback: ModelPreferencesState = { selectedModels: {}, modelOptions: {} }
  if (typeof window === 'undefined') return fallback

  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
    return {
      selectedModels: saved?.selectedModels && typeof saved.selectedModels === 'object'
        ? saved.selectedModels
        : {},
      modelOptions: saved?.modelOptions && typeof saved.modelOptions === 'object'
        ? saved.modelOptions
        : saved?.imageOptions && typeof saved.imageOptions === 'object'
          ? saved.imageOptions
          : {},
    }
  } catch {
    return fallback
  }
}

export const useModelPreferencesStore = defineStore('modelPreferences', {
  state: (): ModelPreferencesState => loadState(),
  actions: {
    persist() {
      if (typeof window === 'undefined') return
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          selectedModels: this.selectedModels,
          modelOptions: this.modelOptions,
        }))
      } catch {
        // Storage may be unavailable in privacy-restricted browser contexts.
      }
    },
    setSelectedModel(type: ModelContentType, model: string) {
      if (!model || this.selectedModels[type] === model) return
      this.selectedModels[type] = model
      this.persist()
    },
    setModelOptions(model: string, resolution: string) {
      if (!model) return
      const current = this.modelOptions[model]
      if (current?.resolution === resolution) return
      this.modelOptions[model] = { resolution }
      this.persist()
    },
  },
})
