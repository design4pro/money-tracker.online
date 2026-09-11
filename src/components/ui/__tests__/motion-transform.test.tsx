import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Button } from '../button'
import { Popover, PopoverDialog, PopoverTrigger } from '../popover'
import { ProgressBar } from '../progress-bar'
import { Skeleton } from '../skeleton'
import { Spinner } from '../spinner'
import { Tooltip, TooltipTrigger } from '../tooltip'

/**
 * Which primitives carry `data-motion-transform`, the hook the reduced-motion block in
 * `src/styles/tokens.css` resets `transform` on.
 *
 * The attribute is a promise: this element's `transform` belongs to an animation, and at rest it is
 * the identity. These cases hold the decisions already made - the primitives that make the promise,
 * and the skeleton sheen, which rests off its own left edge and must not. Whether a *new* animated
 * element has decided at all is the source guard's question
 * (`src/styles/__tests__/motion-transform-reset.test.ts`), not this file's.
 *
 * The modal's case lives in `dialog.test.tsx`, beside the rest of that primitive.
 */

const HOOK = 'data-motion-transform'

describe('data-motion-transform', () => {
  it('is on the popover panel', () => {
    render(
      <PopoverTrigger defaultOpen>
        <Button>Filters</Button>
        <Popover>
          <PopoverDialog aria-label="Filters">Body</PopoverDialog>
        </Popover>
      </PopoverTrigger>,
    )

    expect(screen.getByRole('dialog').closest(`[${HOOK}]`)).not.toBeNull()
  })

  it('is on the tooltip bubble', () => {
    render(
      <TooltipTrigger isOpen>
        <Button>Save</Button>
        <Tooltip>Saves the draft</Tooltip>
      </TooltipTrigger>,
    )

    expect(screen.getByRole('tooltip').hasAttribute(HOOK)).toBe(true)
  })

  it('is on the indeterminate progress fill', () => {
    render(<ProgressBar label="Importing" />)

    expect(
      screen.getByRole('progressbar').querySelectorAll(`[${HOOK}]`),
    ).toHaveLength(1)
  })

  it('is on the spinner drawing', () => {
    const { container } = render(<Spinner />)

    expect(container.querySelector('svg')?.hasAttribute(HOOK)).toBe(true)
  })

  it('is not on the skeleton sheen, which rests off its left edge', () => {
    const { container } = render(<Skeleton />)

    // The sheen has to be there for its absence of the hook to mean anything.
    expect(container.querySelector('span')).not.toBeNull()
    expect(container.querySelectorAll(`[${HOOK}]`)).toHaveLength(0)
  })
})
