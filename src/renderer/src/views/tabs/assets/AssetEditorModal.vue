<script setup lang="ts">
import AppModal from '@/components/AppModal.vue'
import type { ImageAsset } from '@/api/personas'
import type { VoiceItem } from '@/api/voices'
import type { AssetCategory } from '@/types/assets'

defineProps<{
  open: boolean
  title: string
  category: AssetCategory
  categoryLabel: string
  imageSectionLabel: string
  aiGenerateLabel: string
  imageTileClass: string
  voices: VoiceItem[]
  name: string
  gender: 'male' | 'female' | 'unknown'
  age: string
  /** 身高（厘米）表单值；空串表示未填 */
  height: string
  voiceId: number | null
  description: string
  sceneInterior: 'indoor' | 'outdoor' | 'unknown'
  sceneTime: string
  sceneLocation: string
  sceneMood: string
  sceneKeyEvents: string
  refImage: ImageAsset | null
  images: ImageAsset[]
  curImageId: string
  uploading: boolean
  generating: boolean
  generatingDescription: boolean
  textModel: string
  model: string
  modelResolution?: string
  modelCost?: number
}>()

const emit = defineEmits<{
  close: []
  submit: []
  requestGenerateConfirm: []
  generateDescription: []
  upload: [target: 'ref_image' | 'images', event: Event]
  removeImage: [target: 'ref_image' | 'images', idx?: number]
  'update:name': [value: string]
  'update:gender': [value: 'male' | 'female' | 'unknown']
  'update:age': [value: string]
  'update:height': [value: string]
  'update:voiceId': [value: number | null]
  'update:description': [value: string]
  'update:sceneInterior': [value: 'indoor' | 'outdoor' | 'unknown']
  'update:sceneTime': [value: string]
  'update:sceneLocation': [value: string]
  'update:sceneMood': [value: string]
  'update:sceneKeyEvents': [value: string]
  'update:curImageId': [value: string]
}>()
</script>

<template>
  <AppModal :open="open" @close="emit('close')">
    <div class="modal-box w-full max-w-[1100px] rounded-2xl p-8">
      <button class="btn btn-sm btn-circle btn-ghost absolute right-4 top-4" @click="emit('close')">✕</button>
      <h3 class="font-bold text-xl mb-6">{{ title }}</h3>

      <div class="space-y-5">
        <div class="grid gap-4" :class="category === 'persona' ? 'grid-cols-2 md:grid-cols-5' : 'grid-cols-1'">
          <label class="form-control w-full">
            <div class="label"><span class="label-text font-medium">名称 <span class="text-error">*</span></span></div>
            <input :value="name" class="input input-bordered w-full" :placeholder="`${categoryLabel}名称`"
              @input="emit('update:name', ($event.target as HTMLInputElement).value)" @keydown.enter="emit('submit')" />
          </label>

          <label v-if="category === 'persona'" class="form-control w-full">
            <div class="label"><span class="label-text font-medium">性别</span></div>
            <select :value="gender" class="select select-bordered w-full"
              @change="emit('update:gender', ($event.target as HTMLSelectElement).value as any)">
              <option value="male">男</option>
              <option value="female">女</option>
              <option value="unknown">未知</option>
            </select>
          </label>

          <label v-if="category === 'persona'" class="form-control w-full">
            <div class="label"><span class="label-text font-medium">年龄段</span></div>
            <select :value="age" class="select select-bordered w-full"
              @change="emit('update:age', ($event.target as HTMLSelectElement).value)">
              <option value="儿童">儿童</option>
              <option value="少年">少年</option>
              <option value="青年">青年</option>
              <option value="中年">中年</option>
              <option value="老年">老年</option>
            </select>
          </label>

          <label v-if="category === 'persona'" class="form-control w-full">
            <div class="label"><span class="label-text font-medium">身高（cm）</span></div>
            <input :value="height" type="number" min="30" max="300" step="1" class="input input-bordered w-full"
              placeholder="如 170"
              @input="emit('update:height', ($event.target as HTMLInputElement).value)" />
          </label>

          <label v-if="category === 'persona'" class="form-control w-full">
            <div class="label"><span class="label-text font-medium">配音</span></div>
            <select :value="voiceId ?? ''" class="select select-bordered w-full"
              @change="emit('update:voiceId', Number(($event.target as HTMLSelectElement).value) || null)">
              <option v-for="voice in voices" :key="voice.id" :value="voice.id">{{ voice.voice_name }}</option>
            </select>
          </label>
        </div>

        <div class="form-control w-full">
          <div class="label flex items-center justify-between gap-3">
            <label for="asset-description" class="label-text font-medium">描述</label>
            <div v-if="category === 'persona'" class="flex items-center gap-2">
              <span class="hidden md:inline text-xs text-base-content/50">{{ textModel || '未选择文本模型' }}</span>
              <button type="button" class="btn btn-sm btn-soft btn-primary"
                :disabled="!name.trim() || generatingDescription || generating" @click="emit('generateDescription')">
                <span v-if="generatingDescription" class="loading loading-spinner loading-xs"></span>
                {{ generatingDescription ? '角色描述生成中...' : 'AI生成角色描述' }}
              </button>
            </div>
          </div>
          <textarea id="asset-description" :value="description" class="textarea textarea-bordered w-full" :rows="category === 'persona' ? 5 : 3"
            :placeholder="category === 'persona' ? '外貌、性格、背景等特征描述' : '补充画面特征、材质、环境或用途'"
            @input="emit('update:description', ($event.target as HTMLTextAreaElement).value)"></textarea>
          <p v-if="category === 'persona'" class="mt-1 text-xs text-base-content/50">结合已有角色信息和所属章节剧本，补充五官、身材、服饰等形象细节；生成后可继续编辑。</p>
        </div>

        <div v-if="category === 'scene'" class="grid grid-cols-4 gap-4">
          <label class="form-control w-full">
            <div class="label"><span class="label-text font-medium">室内/室外</span></div>
            <select :value="sceneInterior" class="select select-bordered w-full"
              @change="emit('update:sceneInterior', ($event.target as HTMLSelectElement).value as any)">
              <option value="unknown">未指定</option>
              <option value="indoor">室内</option>
              <option value="outdoor">室外</option>
            </select>
          </label>
          <label class="form-control w-full">
            <div class="label"><span class="label-text font-medium">时间</span></div>
            <input :value="sceneTime" class="input input-bordered w-full" placeholder="例如：深夜"
              @input="emit('update:sceneTime', ($event.target as HTMLInputElement).value)" />
          </label>
          <label class="form-control w-full">
            <div class="label"><span class="label-text font-medium">地点</span></div>
            <input :value="sceneLocation" class="input input-bordered w-full" placeholder="例如：城中村巷道"
              @input="emit('update:sceneLocation', ($event.target as HTMLInputElement).value)" />
          </label>
          <label class="form-control w-full">
            <div class="label"><span class="label-text font-medium">氛围</span></div>
            <input :value="sceneMood" class="input input-bordered w-full" placeholder="例如：潮湿、压抑"
              @input="emit('update:sceneMood', ($event.target as HTMLInputElement).value)" />
          </label>
          <label class="form-control w-full col-span-4">
            <div class="label"><span class="label-text font-medium">关键事件</span></div>
            <textarea :value="sceneKeyEvents" class="textarea textarea-bordered w-full" rows="2"
              placeholder="这个场景里最重要的动作或冲突"
              @input="emit('update:sceneKeyEvents', ($event.target as HTMLTextAreaElement).value)"></textarea>
          </label>
        </div>

        <div>
          <div class="label mb-1"><span class="label-text font-medium">参考图</span></div>
          <div class="flex items-end gap-3">
            <div v-if="refImage" class="relative w-[122px] h-[122px] rounded-xl overflow-hidden border border-base-300 group">
              <img :src="refImage.url" class="w-full h-full object-cover" />
              <button
                class="absolute top-1 right-1 btn btn-xs btn-circle btn-error opacity-0 group-hover:opacity-100 transition-opacity"
                @click="emit('removeImage', 'ref_image')">✕</button>
            </div>
            <label v-else
              class="w-[122px] h-[122px] rounded-xl border-2 border-dashed border-base-300 flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors text-base-content/30 hover:text-primary">
              <svg v-if="!uploading" xmlns="http://www.w3.org/2000/svg" class="h-8 w-8" fill="none"
                viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              <span v-else class="loading loading-spinner loading-md text-primary"></span>
              <span class="text-xs mt-1">上传参考图</span>
              <input type="file" accept="image/*" class="hidden" @change="emit('upload', 'ref_image', $event)" />
            </label>
            <p class="text-xs label-text">
              <span class="badge badge-xs">支持大小20M以内，jpg/jpeg/png格式的图片</span>
            </p>
          </div>
        </div>

        <div>
          <div class="label mb-3 flex items-center justify-between gap-3">
            <span class="label-text font-medium">{{ imageSectionLabel }}</span>
            <div class="flex items-center gap-2">
              <div class="hidden md:flex items-center gap-1 text-xs text-base-content/50">
                <span class="badge badge-xs badge-ghost">{{ model || '未选择模型' }}</span>
                <span v-if="modelResolution" class="badge badge-xs badge-ghost">{{ modelResolution }}</span>
                <span class="badge badge-xs badge-primary badge-outline">{{ modelCost || 0 }}积分</span>
              </div>
              <button class="btn btn-sm btn-soft btn-primary" :disabled="!description.trim() || generating || generatingDescription"
                @click="emit('requestGenerateConfirm')">
                <span v-if="generating" class="loading loading-spinner loading-xs"></span>
                {{ aiGenerateLabel }}
              </button>
            </div>
          </div>
          <div class="flex flex-wrap gap-3">
            <div v-for="(img, idx) in images" :key="img.id"
              class="relative w-[122px] rounded-xl overflow-hidden border-2 transition-colors cursor-pointer group"
              :class="[imageTileClass, curImageId === img.id ? 'border-primary ring-2 ring-primary/30' : 'border-base-300']"
              @click="emit('update:curImageId', img.id)">
              <img v-if="img.job_status !== 'running'" :src="img.url" class="w-full h-full"
                :class="category === 'prop' ? 'object-contain p-2 bg-base-200' : 'object-cover'" />
              <div v-else class="flex flex-col items-center justify-center w-full h-full bg-base-200 gap-1 text-base-content/40">
                <span class="loading loading-spinner loading-md text-primary"></span>
                <span class="text-[10px]">生成中...</span>
              </div>
              <div v-if="curImageId === img.id"
                class="absolute top-1 left-1 bg-primary text-primary-content rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                ✓
              </div>
              <button
                class="absolute top-1 right-1 btn btn-xs btn-circle btn-error opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop="emit('removeImage', 'images', idx)">✕</button>
            </div>
            <label
              class="w-[122px] rounded-xl border-2 border-dashed border-base-300 flex flex-col items-center justify-center cursor-pointer hover:border-primary transition-colors text-base-content/30 hover:text-primary"
              :class="imageTileClass">
              <svg v-if="!uploading" xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none"
                viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              <span v-else class="loading loading-spinner loading-sm text-primary"></span>
              <span class="text-[10px] mt-1">上传</span>
              <input type="file" accept="image/*" class="hidden" @change="emit('upload', 'images', $event)" />
            </label>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-3 mt-8 pt-4 border-t border-base-200">
        <button class="btn btn-ghost rounded-xl" @click="emit('close')">取消</button>
        <button class="btn btn-primary rounded-xl px-8" :disabled="!name.trim() || generatingDescription" @click="emit('submit')">应用</button>
      </div>
    </div>
  </AppModal>
</template>
