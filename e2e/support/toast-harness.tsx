import { createRoot } from 'react-dom/client'

import '#/styles/app.css'
import { ToastHost, toast } from '#/components/ui/toast'
import en from '#/lib/i18n/messages/en'
import pl from '#/lib/i18n/messages/pl'

interface ToastHarnessGlobals {
  readonly locale?: 'en' | 'pl'
  readonly dir?: 'ltr' | 'rtl'
}

const { locale = 'en', dir = 'ltr' } =
  (
    window as unknown as {
      __HARNESS__?: ToastHarnessGlobals
    }
  ).__HARNESS__ ?? {}
const messages = locale === 'pl' ? pl : en

/**
 * One visible toast held open for the length of the spec: the shape the shell mounts
 * (`app-shell.tsx`), with the copy the caller supplies from the catalogue.
 */
function Harness() {
  return (
    <main className="p-3">
      <h1>Toast harness</h1>
      <ToastHost
        regionLabel={messages['notifications.title']}
        closeLabel={messages['action.close']}
        duration={Infinity}
      />
    </main>
  )
}

const root = document.getElementById('root')
if (root) {
  document.documentElement.dir = dir
  createRoot(root).render(<Harness />)
  toast.success(
    'A long account name that wraps onto a second line at 360px was saved.',
  )
  document.body.setAttribute('data-harness-ready', 'true')
}
