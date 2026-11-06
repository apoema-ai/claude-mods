/** The model and effort the main chat uses ('' effort when unknown), and what the mod recommends instead. */
export type FitSetting = { model: string; effort: string }
export type FitRec = { model: 'haiku' | 'sonnet' | 'opus'; effort: 'low' | 'medium' | 'high' | 'xhigh'; reason: string; keepEffort?: boolean }

declare module 'claude-code' {
  interface PluginState {
    'model-fit': {
      /** The Mismatch the band offers; null when nothing differs. */
      offer: { from: FitSetting; to: FitRec; shown: boolean; queued?: 'switch' | 'go'; tokens?: number } | null
      /** The Trigger, Auto and Pause the band draws. */
      trigger: string
      auto: boolean
      paused: boolean
    }
  }
}
