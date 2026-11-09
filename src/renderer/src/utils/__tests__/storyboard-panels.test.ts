import assert from 'node:assert/strict'
import { test } from 'node:test'
import { storyboardPanels, dialogueToSegments, segmentsToDialogue } from '../storyboard-panels'

test('scene environment and transition stay separate from shot content and prompts', () => {
  const [panel] = storyboardPanels([{ scene_id: '110', environment: '夜晚卧房', transition: '声音先入', shots: [{
    content: '韩立睁眼', dialogue: [], roles: [], sound_effect: '风声',
    start_prompt: '首帧', end_prompt: '尾帧', negative_prompt: '模糊',
  }] }])
  assert.equal(panel.environment, '夜晚卧房')
  assert.equal(panel.scene, '韩立睁眼')
  assert.equal(panel.transition, '声音先入')
  assert.equal(panel.start_prompt, '首帧')
  assert.equal(panel.end_prompt, '尾帧')
  assert.equal(panel.negative_prompt, '模糊')
  assert.equal(panel.sound_effect, '风声')
})

test('nested view model preserves shot order, media, dialogue and scene bindings', () => {
  const configs = [{ scene_id: '110', prop_ids: ['123'], shots: [
    { content: '画面', dialogue: [{ id: '26', speaker: '韩立（内心OS）', text: '你好', tone: '低语', emotion: 'calm' }],
      segments: [{ type: 'dialogue', role_id: 26, text: '你好', audioUrl: 'voice.mp3' }], firstFrameUrl: 'first.png' },
    { content: '空镜', dialogue: [], roles: [], durShort: 8 },
  ] }, { scene_id: '110', shots: [{ content: '另一个场景', dialogue: [] }] }]
  const before = structuredClone(configs)
  const panels = storyboardPanels(configs)
  assert.deepEqual(panels.map(p => [p.id, p.panelIdx, p.sceneIdx, p.shotIdx]), [[1, 0, 0, 0], [2, 1, 0, 1], [3, 2, 1, 0]])
  assert.deepEqual(panels[0].roles, [{ id: 26 }])
  assert.equal(panels[0].segments[0].speaker, '韩立（内心OS）')
  assert.equal(panels[0].segments[0].audioUrl, 'voice.mp3')
  assert.equal(panels[0].firstFrameUrl, 'first.png')
  assert.equal(panels[0].scene_id, 110)
  assert.deepEqual(panels[0].prop_ids, [123])
  assert.equal(panels[1].durShort, 8)
  assert.deepEqual(panels[1].segments, [])
  assert.deepEqual(configs, before)
})

test('explicit string role IDs include silent characters and never use scene role_id', () => {
  const [panel] = storyboardPanels([{ role_id: '99', shots: [{ content: '无对白', dialogue: [], roles: [{ id: '26' }, { id: '27' }] }] }])
  assert.deepEqual(panel.roles, [{ id: 26 }, { id: 27 }])
  const [empty] = storyboardPanels([{ shots: [{ roles: [], dialogue: [{ id: '26', speaker: '韩立', text: '说话' }] }] }])
  assert.deepEqual(empty.roles, [])
})

test('narration with a character ID round trips metadata and rejects stale dialogue audio', () => {
  const dialogue = [{ id: '26', prop_ids: ['123'], speaker: '旁白', text: '从前', tone: '平缓', emotion: 'fluent' }]
  const segments = dialogueToSegments(dialogue, [{ type: 'dialogue', role_id: 26, text: '从前', audioUrl: 'wrong-voice.mp3' }])
  assert.equal(segments[0].type, 'narration')
  assert.equal(segments[0].audioUrl, undefined)
  assert.deepEqual(segmentsToDialogue(segments), dialogue)
  segments[0].role_id = undefined // DialogueEditor stores narration without a speaking role.
  assert.deepEqual(segmentsToDialogue(segments), dialogue)
})

test('legacy indices and segments remain compatible; absent configs produce empty list', () => {
  const segments = [{ type: 'narration', text: '旁白', audioUrl: 'old.mp3' }]
  const [panel] = storyboardPanels([{ id: 2, panelIdx: 9, environment: '旧画面', segments, roles: [], durShort: 6 }])
  assert.equal(panel.panelIdx, 9)
  assert.equal(panel.scene, '旧画面')
  assert.deepEqual(panel.segments, segments)
  assert.equal(panel.sceneIdx, undefined)
  assert.deepEqual(storyboardPanels([]), [])
})
