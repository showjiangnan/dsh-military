import { useEffect } from 'react'

const FOCUSABLE = [
  'button:not(:disabled)',
  '[href]',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * RC.2 Modal owns the mask, aria-modal and Escape behavior but does not trap
 * focus. Military adds the missing keyboard boundary without replacing the
 * native primitive.
 */
export function useDialogFocus(open: boolean, selector: string): void {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return
    const dialog = document.querySelector<HTMLElement>(selector)
    if (dialog === null) return
    const previousTabIndex = dialog.getAttribute('tabindex')
    if (previousTabIndex === null) dialog.setAttribute('tabindex', '-1')
    const initial = dialog.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"], [data-dshm-close], button, input, select, textarea',
    )
    const frame = typeof globalThis.requestAnimationFrame === 'function'
      ? globalThis.requestAnimationFrame(() => { (initial ?? dialog).focus() })
      : undefined
    if (frame === undefined) globalThis.queueMicrotask(() => { (initial ?? dialog).focus() })

    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.isComposing) return
      const candidates = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)]
        .filter(value =>
          value.getAttribute('aria-hidden') !== 'true'
          && value.getAttribute('hidden') === null)
      if (candidates.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = candidates[0]!
      const last = candidates.at(-1)!
      const active = document.activeElement
      if (!dialog.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trap, true)
    return () => {
      document.removeEventListener('keydown', trap, true)
      if (frame !== undefined && typeof globalThis.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(frame)
      }
      if (previousTabIndex === null) dialog.removeAttribute('tabindex')
    }
  }, [open, selector])
}
