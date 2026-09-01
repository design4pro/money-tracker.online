import { clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

import type { ClassValue } from 'clsx'

/**
 * `tailwind-merge` does not read our stylesheet, so it has no way to know that
 * `text-body` is a font size and `text-ink-2` is a colour — left unconfigured it
 * files both under `text-color` and silently drops the earlier one. That single
 * default turns `cn('text-title', 'text-ink')` into `text-ink`, and every
 * semantic type step in the product disappears the first time a caller passes a
 * colour override.
 *
 * Registering our token names against the right class groups fixes that, and at
 * the same time makes a caller's override genuinely win for durations, easings,
 * tracking, z-index and named animations rather than leaving two classes on the
 * element and letting stylesheet order decide.
 *
 * Every list here is CLOSED: a name that ships a utility in
 * `src/styles/app.css` and is missing from this file merges wrongly, silently,
 * and only in the one composition that happens to set both.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'hero',
            'display',
            'title',
            'subtitle',
            'body',
            'label',
            'caption',
            'micro',
          ],
        },
      ],
      tracking: [{ tracking: ['label'] }],
      /**
       * `@utility duration-*` in `app.css`, not Tailwind's numeric scale. The
       * names have to be listed for `cn('duration-base', 'duration-fast')` to
       * resolve to the second one.
       */
      duration: [{ duration: ['instant', 'fast', 'base', 'slow'] }],
      ease: [{ ease: ['out-quint', 'in-quint', 'standard', 'drawer'] }],
      /**
       * The z ladder is closed on purpose. `z-toast` beating `z-modal` is the
       * kind of thing that has to be decided by the token file rather than by
       * bundler ordering, and an unlisted name here is exactly how that
       * decision leaks back out into the cascade.
       */
      z: [
        {
          z: [
            'nav',
            'dropdown',
            'overlay',
            'modal',
            'popover',
            'tooltip',
            'toast',
          ],
        },
      ],
      animate: [
        {
          animate: [
            'shimmer',
            'indeterminate',
            'spin-slow',
            'fade-in',
            'fade-out',
            'pop-in',
            'pop-out',
            'dialog-in',
            'dialog-out',
            'drawer-in',
            'drawer-out',
          ],
        },
      ],
    },
  },
})

/**
 * Merge conditional class lists and let later Tailwind utilities win over
 * earlier ones in the same group. Every primitive in `src/components/ui` routes
 * its `className` prop through this, so a caller can always override a default
 * without reaching for `!important`.
 */
export function cn(...inputs: Array<ClassValue>): string {
  return twMerge(clsx(inputs))
}
