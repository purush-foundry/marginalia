import { useEffect, useRef, useState } from 'preact/hooks'

// A text field's draft that saves its trimmed text on blur and on unmount when it differs from the last saved text.
export function useDraft(initial: string, save: (text: string) => void) {
  const [value, setValue] = useState(initial)
  const text = useRef(initial)
  const saved = useRef(initial)
  const onSave = useRef(save)
  onSave.current = save
  const commit = () => {
    const t = text.current.trim()
    if (t === saved.current) return
    saved.current = t
    onSave.current(t)
  }
  useEffect(() => commit, [])
  return {
    value,
    onInput: (e: { currentTarget: { value: string } }) => {
      text.current = e.currentTarget.value
      setValue(text.current)
    },
    onBlur: (e: { currentTarget: { value: string } }) => {
      text.current = e.currentTarget.value
      commit()
    },
  }
}
