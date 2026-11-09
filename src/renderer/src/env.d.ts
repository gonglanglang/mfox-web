/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  readonly VITE_API_BASE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

export interface ImageAsset {
  id: string
  url: string
  type: string
  job_id: number
  job_status: string
  edit_job_id: number
  edit_job_status: string
  prompt: string
  parent_image_id: string | null
  ref_images: any[]
}
 