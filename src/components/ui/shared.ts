/**
 * Class fragments and small helpers shared by every primitive in this
 * directory.
 *
 * Everything here is expressed in tokens — there is no raw hex, px radius or
 * literal shadow anywhere under `src/components/ui`. Keeping the fragments in
 * one place is what makes "every control has the same ring, the same press and
 * the same disabled treatment" true by construction rather than by discipline.
 *
 * ## Why explicit `data-[…]` variants
 *
 * React Aria Components expose interaction state as data attributes
 * (`data-hovered`, `data-pressed`, `data-focus-visible`, `data-selected`,
 * `data-disabled`, `data-invalid`, `data-entering`, `data-exiting`, …).
 * `tailwindcss-react-aria-components` turns those into short variants, and it is
 * installed — but the fragments below spell the attribute selectors out. The
 * plugin's variant names and its optional prefix are configuration; the
 * primitives are the layer that must not break when configuration changes.
 *
 * ## The disabled rule
 *
 * A disabled control is communicated to assistive technology by React Aria
 * itself: a native control gets the `disabled` attribute, a composite gets
 * `aria-disabled`. Visually we *repaint* rather than fade anything that carries
 * its own label — dropping a filled button to 45% opacity dims the label along
 * with the fill and lands the pair at roughly 2.9:1, which reads as a broken
 * control rather than a waiting one. Opacity is reserved for controls with no
 * label of their own (an unchecked box, a switch track, a slider thumb).
 */
import { composeRenderProps } from 'react-aria-components'

import { cn } from '#/lib/cn'

import type { ClassValue } from 'clsx'

/**
 * Merge our token classes with whatever the caller passed, honouring React
 * Aria's render-prop form of `className`.
 *
 * RAC hands a render function the current state plus `defaultClassName`; a
 * plain string is passed straight through. `composeRenderProps` normalises the
 * two, and `cn` then resolves the Tailwind conflicts so a caller's
 * `className="rounded-full"` genuinely beats our `rounded-md`.
 */
export function composeTw<T>(
  className:
    | string
    | ((values: T & { defaultClassName: string | undefined }) => string)
    | undefined,
  ...base: Array<ClassValue>
): string | ((values: T & { defaultClassName: string | undefined }) => string) {
  return composeRenderProps(className, (resolved) => cn(base, resolved))
}

/**
 * The one focus treatment in the product, drawn OUTSIDE the control on a
 * canvas-coloured gap so it survives against any fill (WCAG 2.2 §2.4.11).
 *
 * `outline-solid` is load-bearing and `outline-none` must never appear beside
 * it. In Tailwind v4 the outline utilities share one `--tw-outline-style`
 * custom property: `outline-none` sets it to `none`, and `outline-2` then
 * resolves `outline-style: var(--tw-outline-style)` against that, producing a
 * ring two pixels wide and styled `none`. Every control built on such a pair
 * reports a focus colour and draws nothing.
 */
export const focusRing = [
  'outline-focus',
  'data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:outline-offset-2',
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2',
].join(' ')

/** The same ring drawn inward, for a control flush against a panel edge. */
export const focusRingInset = [
  'outline-focus',
  'data-[focus-visible]:outline-2 data-[focus-visible]:outline-solid data-[focus-visible]:-outline-offset-2',
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2',
].join(' ')

/** Ring for a wrapper (`Group`) that takes focus on behalf of a nested input. */
export const focusRingWithin = [
  'outline-focus',
  'data-[focus-within]:outline-2 data-[focus-within]:outline-solid data-[focus-within]:outline-offset-2',
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-offset-2',
].join(' ')

/**
 * Inactive state for a control that carries its own label. No `opacity` — see
 * the module docblock. Each variant repaints instead.
 */
export const disabledLabelled =
  'data-[disabled]:pointer-events-none data-[disabled]:shadow-none data-[disabled]:cursor-not-allowed'

/** Inactive state for a control with no label of its own. */
export const disabledPlain =
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[disabled]:cursor-not-allowed'

/**
 * Transform and opacity plus the paint-only properties. Never `width`,
 * `height`, `top` or `margin` — a reflow cannot be animated honestly at 60fps.
 *
 * `translate`, `scale` and `rotate` are named alongside `transform` because
 * Tailwind v4 compiles `-translate-y-px`, `scale-95` and `rotate-180` to those
 * three standalone CSS properties rather than to `transform`. Listing only
 * `transform` leaves every press and every hover lift in the directory snapping
 * instantly while the class that produced it looks animated.
 */
export const transitionBase =
  'transition-[color,background-color,border-color,outline-color,box-shadow,transform,translate,scale,rotate,opacity] duration-fast ease-out-quint'

export const transitionSlow =
  'transition-[color,background-color,border-color,box-shadow,transform,translate,scale,rotate,opacity] duration-base ease-out-quint'

/** Full-bleed scrim behind Modal and Drawer. */
export const scrimSurface = [
  'fixed inset-0 z-overlay bg-scrim',
  'data-[entering]:animate-fade-in data-[exiting]:animate-fade-out',
].join(' ')

/** The floating-panel treatment: hairline, raised surface, layer shadow. */
export const layerSurface =
  'rounded-lg border border-border-subtle bg-surface-raised shadow-dropdown'

/** Enter/exit choreography for a RAC `Popover`. */
export const popMotion = [
  'data-[entering]:animate-pop-in data-[exiting]:animate-pop-out',
  'data-[placement=top]:origin-bottom data-[placement=bottom]:origin-top',
  'data-[placement=left]:origin-right data-[placement=right]:origin-left',
].join(' ')

/**
 * A row inside Menu / ListBox / Select / ComboBox.
 *
 * `data-[focused]` rather than `data-[hovered]` is deliberate: React Aria moves
 * a single virtual focus through a collection for both pointer and keyboard, so
 * styling the hovered state separately would light two rows at once when a
 * mouse rests over a list the keyboard is also driving.
 */
export const collectionItemBase = [
  'relative flex cursor-default select-none items-center gap-2.5 rounded-md px-2.5 py-2',
  'text-label text-ink-2 outline-hidden',
  transitionBase,
  'data-[focused]:bg-hover data-[focused]:text-ink',
  'data-[selected]:font-semibold data-[selected]:text-ink',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-45',
].join(' ')

export const collectionHeaderBase =
  'px-2.5 pt-2.5 pb-1.5 text-micro tracking-label uppercase text-ink-2'

export const collectionSeparatorBase = '-mx-1 my-1.5 h-px bg-border-subtle'

/**
 * Shared shell for Input / TextArea / the Select and ComboBox triggers and the
 * DateInput group. `border-border-strong` gives every control a 3:1 boundary
 * (WCAG 2.2 §1.4.11) without the weight of a full-contrast border.
 */
export const fieldSurface = [
  'w-full rounded-md border border-border-strong bg-surface text-ink',
  'placeholder:text-ink-2',
  transitionBase,
  'data-[hovered]:border-ink-2 hover:border-ink-2',
  'data-[focused]:border-brand data-[focus-within]:border-brand focus-within:border-brand',
  'data-[invalid]:border-negative aria-[invalid=true]:border-negative',
  'data-[disabled]:cursor-not-allowed data-[disabled]:bg-surface-sunken data-[disabled]:text-ink-2 data-[disabled]:opacity-80',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-2 disabled:opacity-80',
].join(' ')

/**
 * Control heights, on the 4px grid. All three are below the 44px AAA target
 * size on purpose: the *visual* box stays proportionate to its label and the
 * `target-min` utility grows the *hit area* to 44px with a pseudo-element. The
 * two are separate dimensions and conflating them produces a toolbar of
 * 44px-tall ghost buttons with dead space between their labels.
 */
export const fieldSizes = {
  sm: 'h-8 px-2.5 text-caption',
  md: 'h-10 px-3 text-label',
  lg: 'h-12 px-3.5 text-body',
} as const

export type FieldSize = keyof typeof fieldSizes

/** Icon box sizes paired to each control size, in 4px-grid steps. */
export const iconSizes = { sm: 14, md: 16, lg: 18 } as const

/**
 * The same three sizes as CSS, for a slot that holds an icon it was *handed*
 * rather than one it rendered itself.
 *
 * `lucide-react` defaults to `width="24" height="24"` as presentation
 * attributes, which any CSS rule beats but nothing else does — so a slot that
 * sizes only its own box gets a 24px drawing inside a 14px box. Sizing the
 * descendant `svg` is the half that actually constrains the drawing.
 */
export const iconBoxes = {
  sm: 'size-3.5 [&_svg]:size-3.5',
  md: 'size-4 [&_svg]:size-4',
  lg: 'size-[1.125rem] [&_svg]:size-[1.125rem]',
} as const
