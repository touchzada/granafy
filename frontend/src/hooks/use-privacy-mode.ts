import { useSyncExternalStore, useCallback } from 'react'

export type PrivacyState = 'visible' | 'blurred' | 'hidden'

const STORAGE_KEY = 'privacyModeState'
const MASK = '\u2022\u2022\u2022\u2022\u2022'

const listeners = new Set<() => void>()

function getSnapshot(): PrivacyState {
  const val = localStorage.getItem(STORAGE_KEY)
  if (val === 'blurred' || val === 'hidden') return val
  if (localStorage.getItem('privacyMode') === 'true') {
     localStorage.removeItem('privacyMode')
     localStorage.setItem(STORAGE_KEY, 'hidden')
     return 'hidden'
  }
  return 'visible'
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function notify() {
  listeners.forEach((cb) => cb())
}

export function usePrivacyMode() {
  const privacyMode = useSyncExternalStore(subscribe, getSnapshot, () => 'visible' as PrivacyState)

  const togglePrivacyMode = useCallback(() => {
    const current = getSnapshot()
    const next: PrivacyState = current === 'visible' ? 'blurred' : current === 'blurred' ? 'hidden' : 'visible'
    localStorage.setItem(STORAGE_KEY, next)
    notify()
  }, [])

  const mask = useCallback(
    (value: string) => (privacyMode === 'hidden' ? MASK : value),
    [privacyMode],
  )
  
  const blurClass = privacyMode === 'blurred' ? 'blur-[4px] opacity-70 select-none transition-all duration-300' : 'transition-all duration-300'

  return { privacyMode, togglePrivacyMode, mask, blurClass, MASK, rawPrivacyMode: privacyMode } as const
}
