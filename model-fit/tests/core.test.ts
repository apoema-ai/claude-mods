import { expect, test } from 'claude-code/testing'

import { DEFAULTS, DEFAULT_RUBRIC, aliasOf, cacheNote, parseTrigger, decide, direction, drifted, fixedFor, guard, judgePrompt, parseJudge, parseList, type Rec, type Setting } from '../hooks/core'

const opusHigh: Setting = { model: 'claude-opus-5-5', effort: 'high' }
const rec = (model: Rec['model'], effort: Rec['effort']): Rec => ({ model, effort, reason: 'r' })

test('the trigger defaults to prompt, and the old spellings still read', {}, async () => {
  expect(DEFAULTS.trigger).toBe('prompt')
  expect(parseTrigger(undefined)).toBe('prompt')
  expect(parseTrigger('each-prompt')).toBe('prompt')
  expect(parseTrigger('on-skill')).toBe('skill')
  expect(parseTrigger('off')).toBe('off')
  expect(parseTrigger('nonsense')).toBe('prompt')
})

test('a model change warns about the prompt cache, an effort-only change does not', {}, async () => {
  expect(cacheNote(opusHigh, rec('sonnet', 'medium'), 42_000)).toContain('about 42k tokens')
  expect(cacheNote(opusHigh, rec('sonnet', 'medium'), 800)).toContain('800 tokens')
  expect(cacheNote(opusHigh, rec('sonnet', 'medium'), undefined)).toContain('the whole context')
  expect(cacheNote(opusHigh, rec('opus', 'low'), 42_000)).toBeNull()
})

test('aliasOf reads the family from an id', {}, async () => {
  expect(aliasOf('claude-sonnet-5-5')).toBe('sonnet')
  expect(aliasOf('opus')).toBe('opus')
  expect(aliasOf('claude-fable-5-1')).toBeUndefined()
})

test('direction ranks both axes, and an unknown one counts as equal', {}, async () => {
  expect(direction(opusHigh, rec('opus', 'high'))).toBe('same')
  expect(direction(opusHigh, rec('sonnet', 'medium'))).toBe('down')
  expect(direction(opusHigh, rec('sonnet', 'xhigh'))).toBe('up')
  expect(direction({ model: 'claude-fable-5-1', effort: 'max' }, rec('opus', 'high'))).toBe('same')
})

test('a Recommendation that keeps effort compares the model alone', {}, async () => {
  const fixed: Rec = { model: 'sonnet', effort: 'low', reason: 'r', keepEffort: true }
  expect(direction({ model: 'claude-sonnet-5-5', effort: 'high' }, fixed)).toBe('same')
  expect(direction(opusHigh, fixed)).toBe('down')
})

test('an upgrade acts at once, a downgrade needs two in a row', {}, async () => {
  const up = decide({ model: 'sonnet', effort: 'medium' }, rec('opus', 'high'), undefined)
  expect(up.act?.model).toBe('opus')
  const first = decide(opusHigh, rec('sonnet', 'medium'), undefined)
  expect(first.act).toBeUndefined()
  expect(first.pending?.model).toBe('sonnet')
  expect(decide(opusHigh, rec('sonnet', 'medium'), first.pending).act?.model).toBe('sonnet')
  expect(decide(opusHigh, rec('sonnet', 'low'), first.pending).act).toBeUndefined()
  expect(decide(opusHigh, rec('opus', 'high'), first.pending)).toEqual({})
})

test('the cache guard keeps the model above the limit and lets effort fall', {}, async () => {
  const kept = guard(opusHigh, rec('sonnet', 'low'), 150_000, 80_000)
  expect(kept.model).toBe('opus')
  expect(kept.effort).toBe('low')
  expect(guard(opusHigh, rec('sonnet', 'low'), 50_000, 80_000).model).toBe('sonnet')
  expect(guard(opusHigh, rec('sonnet', 'low'), undefined, 80_000).model).toBe('sonnet')
  expect(guard({ model: 'sonnet', effort: 'low' }, rec('opus', 'high'), 150_000, 80_000).model).toBe('opus')
})

test('fixedFor reads the superpowers table, with or without prefix', {}, async () => {
  expect(fixedFor('superpowers:brainstorming')).toBe('opus')
  expect(fixedFor('/superpowers:executing-plans')).toBe('sonnet')
  expect(fixedFor('executing-plans')).toBe('sonnet')
  expect(fixedFor('superpowers:unknown')).toBeUndefined()
})

test('a change the mod did not make is drift', {}, async () => {
  expect(drifted(undefined, opusHigh)).toBe(false)
  expect(drifted(opusHigh, opusHigh)).toBe(false)
  expect(drifted(opusHigh, { model: 'claude-sonnet-5-5', effort: 'high' })).toBe(true)
  expect(drifted(opusHigh, { model: 'claude-opus-5-5', effort: 'low' })).toBe(true)
  expect(drifted(opusHigh, { model: 'claude-opus-5-5', effort: '' })).toBe(false)
  expect(drifted({ model: 'opus', effort: 'high' }, opusHigh)).toBe(false)
})

test('parseJudge accepts only an allowed answer', {}, async () => {
  const models = parseList('sonnet,opus', ['haiku', 'sonnet', 'opus'])
  const efforts = parseList('low,medium,high', ['low', 'medium', 'high', 'xhigh'])
  const ok = parseJudge('Sure: {"model":"Sonnet","effort":"medium","reason":"mechanical edits"}', models, efforts)
  expect(ok).toEqual({ model: 'sonnet', effort: 'medium', reason: 'mechanical edits' })
  expect(parseJudge('{"model":"haiku","effort":"low","reason":"x"}', models, efforts)).toBeNull()
  expect(parseJudge('{"model":"opus","effort":"xhigh","reason":"x"}', models, efforts)).toBeNull()
  expect(parseJudge('no json here', models, efforts)).toBeNull()
  expect(parseJudge('{"model":', models, efforts)).toBeNull()
})

test('the Judge prompt carries the rubric, the setting and the new work', {}, async () => {
  const p = judgePrompt(DEFAULT_RUBRIC, opusHigh, { subject: 'rename a variable', tokens: 1200, window: 200000, turns: 3 }, ['sonnet'], ['low'])
  expect(p).toContain('cheapest model')
  expect(p).toContain('model claude-opus-5-5, effort high')
  expect(p).toContain('rename a variable')
})
