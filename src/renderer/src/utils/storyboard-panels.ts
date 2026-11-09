import type { Segment } from './segments'
import type { StoryDialogue } from './storyboard'

/**
 * 判断台词文本是否属于“无台词”占位词（如“无”、“（无）”、“无台词”、“暂无”等）。
 */
export function isPlaceholderEmptyDialogue(value: unknown): boolean {
  const raw = String(value ?? '').trim()
  if (!raw) return true
  const stripped = raw
    .replace(/^[（(【\[「『"'“‘\s]+|[）)】\]」』"'”’。，,！!？?；;：:\s]+$/g, '')
    .trim()
  if (!stripped) return true
  return /^(?:无|暂无|无台词|无对白|无旁白|没有台词|没有对白|无声音|静音|沉默|留白|空|none|null|nil|n\/a|-+|—+|_+|\.+|…+)$/i.test(stripped)
}

export function dialogueToSegments(dialogue: StoryDialogue[], generated: Segment[] = []): Segment[] {
  return (Array.isArray(dialogue) ? dialogue : [])
    .filter(line => line && !isPlaceholderEmptyDialogue(line.text))
    .map((line, i) => {
      const roleId = line.id === '' || line.id == null ? undefined : Number(line.id)
      const type = line.speaker?.trim() === '旁白' || !roleId ? 'narration' : 'dialogue'
      const previous = generated[i]
      const inlineAudio = (line as any).audioUrl
      const audioUrl = inlineAudio || (previous?.type === type && previous.text === line.text && Number(previous.role_id || 0) === Number(roleId || 0)
        ? previous.audioUrl : undefined)
      return {
        type,
        role_id: roleId,
        dialogue_id: line.id,
        prop_ids: line.prop_ids,
        text: line.text || '',
        speaker: line.speaker,
        tone: line.tone,
        emotion: line.emotion,
        audioUrl,
      }
    })
}

export function segmentsToDialogue(segments: Segment[]): StoryDialogue[] {
  return (Array.isArray(segments) ? segments : [])
    .filter(segment => segment && !isPlaceholderEmptyDialogue(segment.text))
    .map(segment => ({
      id: segment.type === 'dialogue' ? String(segment.role_id ?? '') : segment.dialogue_id ?? '',
      ...(segment.prop_ids !== undefined ? { prop_ids: segment.prop_ids } : {}),
      speaker: segment.speaker || (segment.type === 'narration' ? '旁白' : ''),
      text: segment.text,
      tone: segment.tone || '',
      emotion: segment.emotion || '',
    }))
}

function normalizeSceneTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(v => String(v ?? '').trim()).filter(Boolean)
  if (typeof raw === 'string' && raw.trim()) {
    return raw.split(/[,，、;；]+/).map(s => s.trim()).filter(Boolean)
  }
  return []
}

/** View model only: nested scenes stay intact in content_configs. */
export function storyboardPanels(configs: any[]) {
  let index = 0
  return configs.flatMap((scene: any, sceneIdx: number) => {
    if (!Array.isArray(scene.shots)) {
      index++
      const cleanSegments = Array.isArray(scene.segments)
        ? scene.segments.filter((s: any) => s && !isPlaceholderEmptyDialogue(s.text))
        : []
      return [{
        ...scene,
        id: scene.id ?? index,
        panelIdx: scene.panelIdx ?? index - 1,
        scene: scene.scene ?? scene.plot_description ?? scene.environment ?? '',
        plot_description: scene.plot_description ?? scene.scene ?? scene.content ?? '',
        start_prompt: scene.start_prompt ?? scene.image_prompt ?? scene.scene ?? scene.content ?? '',
        end_prompt: scene.end_prompt ?? scene.image_prompt ?? scene.start_prompt ?? scene.scene ?? scene.content ?? '',
        image_prompt: scene.image_prompt ?? scene.start_prompt ?? scene.scene ?? '',
        motion_prompt: scene.motion_prompt ?? scene.subject_motion ?? scene.videoPrompt ?? '',
        scene_tags: normalizeSceneTags(scene.scene_tags),
        lighting: scene.lighting || '',
        emotion: scene.emotion || '',
        character_action: scene.character_action || '',
        character_refs: Array.isArray(scene.character_refs) ? scene.character_refs : [],
        reference_frame_url: scene.reference_frame_url || '',
        gen_mode: scene.gen_mode || (scene.frame_mode === 'dual' ? 'frames2video' : 'singleImage2video'),
        model_params: scene.model_params || {},
        videoNeedsRerun: Boolean(scene.videoNeedsRerun),
        ttsAudioUrl: scene.ttsAudioUrl || '',
        roles: scene.roles || [],
        segments: cleanSegments,
        durShort: scene.durShort || 5,
        frame_mode: scene.frame_mode || 'single',
        world_state: scene.world_state || '',
        sceneIdx: undefined,
        shotIdx: undefined,
      }]
    }
    return scene.shots.map((shot: any, shotIdx: number) => {
      const dialogue = Array.isArray(shot.dialogue) ? shot.dialogue : []
      const segments = dialogueToSegments(dialogue, shot.segments)
      // Explicit roles describe visible characters, independently of who speaks (or narrates).
      const roles = Array.isArray(shot.roles)
        ? shot.roles.map((role: any) => ({ ...role, id: Number(role.id) }))
        : [...new Set(segments.filter(s => s.type === 'dialogue').map(s => s.role_id).filter(Boolean))].map(id => ({ id }))
      return {
        ...shot,
        id: ++index,
        panelIdx: index - 1,
        sceneIdx,
        shotIdx,
        environment: scene.environment || '',
        transition: shot.transition || scene.transition || '',
        scene: shot.plot_description || shot.content || '',
        plot_description: shot.plot_description ?? shot.content ?? '',
        start_prompt: shot.start_prompt ?? shot.image_prompt ?? shot.motion?.in ?? shot.content ?? '',
        end_prompt: shot.end_prompt ?? shot.motion?.out ?? shot.image_prompt ?? shot.start_prompt ?? shot.content ?? '',
        image_prompt: shot.image_prompt ?? shot.start_prompt ?? shot.content ?? '',
        motion_prompt: shot.motion_prompt ?? shot.subject_motion ?? shot.videoPrompt ?? '',
        scene_tags: normalizeSceneTags(shot.scene_tags),
        lighting: shot.lighting || '',
        emotion: shot.emotion || '',
        character_action: shot.character_action || '',
        character_refs: Array.isArray(shot.character_refs) ? shot.character_refs : [],
        reference_frame_url: shot.reference_frame_url || '',
        gen_mode: shot.gen_mode || (shot.frame_mode === 'dual' ? 'frames2video' : 'singleImage2video'),
        model_params: shot.model_params || {},
        videoNeedsRerun: Boolean(shot.videoNeedsRerun),
        ttsAudioUrl: shot.ttsAudioUrl || '',
        scene_id: scene.scene_id == null ? null : Number(scene.scene_id),
        prop_ids: (scene.prop_ids || []).map(Number),
        roles,
        segments,
        durShort: shot.durShort || 5,
        frame_mode: shot.frame_mode || scene.frame_mode || 'single',
        world_state: shot.world_state || '',
      }
    })
  })
}
