import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { Tab, TabList, TabPanel, Tabs } from '../tabs'

function Example(props: Record<string, unknown> = {}) {
  return (
    <Tabs {...props}>
      <TabList aria-label="Report views">
        <Tab id="overview">Overview</Tab>
        <Tab id="categories">Categories</Tab>
        <Tab id="payees">Payees</Tab>
      </TabList>
      <TabPanel id="overview">Overview panel</TabPanel>
      <TabPanel id="categories">Categories panel</TabPanel>
      <TabPanel id="payees">Payees panel</TabPanel>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('renders a labelled tablist with one selected tab and one panel', () => {
    render(<Example />)

    expect(screen.getByRole('tablist', { name: 'Report views' })).toBeTruthy()
    expect(
      screen
        .getByRole('tab', { name: 'Overview' })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(screen.getByRole('tabpanel')).toBeTruthy()
    expect(screen.getByRole('tabpanel').textContent).toBe('Overview panel')
  })

  it('does not select on arrow alone — manual activation is the default', async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    render(<Example onSelectionChange={onSelectionChange} />)

    // An uncontrolled Tabs selects its first tab as it mounts and reports that
    // one selection before any key is pressed. This test is about what the
    // ARROW key does, so account for the mount-time call and then measure only
    // what happens after it.
    expect(onSelectionChange.mock.calls).toEqual([['overview']])
    onSelectionChange.mockClear()

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('tab', { name: 'Overview' }),
    )

    await user.keyboard('{ArrowRight}')
    // Focus moved…
    expect(document.activeElement).toBe(
      screen.getByRole('tab', { name: 'Categories' }),
    )
    // …but nothing was mounted. Automatic activation would have loaded a panel
    // the user was only passing through, which in this product can cost a
    // server round trip per keypress.
    expect(onSelectionChange).not.toHaveBeenCalled()
    // The state a screen reader reads is unchanged too: the tab the user is
    // merely passing through must not claim to be the selected one.
    expect(
      screen
        .getByRole('tab', { name: 'Overview' })
        .getAttribute('aria-selected'),
    ).toBe('true')
    expect(
      screen
        .getByRole('tab', { name: 'Categories' })
        .getAttribute('aria-selected'),
    ).toBe('false')
    expect(screen.getByRole('tabpanel').textContent).toBe('Overview panel')
  })

  it('selects with Enter once the user has arrived', async () => {
    const user = userEvent.setup()
    const onSelectionChange = vi.fn()
    render(<Example onSelectionChange={onSelectionChange} />)

    await user.tab()
    await user.keyboard('{ArrowRight}{Enter}')

    expect(onSelectionChange).toHaveBeenCalledWith('categories')
    expect(screen.getByRole('tabpanel').textContent).toBe('Categories panel')
  })

  it('makes the tab strip a single tab stop', async () => {
    const user = userEvent.setup()
    render(<Example />)

    await user.tab()
    expect(document.activeElement).toBe(
      screen.getByRole('tab', { name: 'Overview' }),
    )

    // The next Tab press must reach the panel, not the second tab.
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('tabpanel'))
  })

  it('skips a disabled tab while arrowing', async () => {
    const user = userEvent.setup()
    render(
      <Tabs disabledKeys={['categories']}>
        <TabList aria-label="Report views">
          <Tab id="overview">Overview</Tab>
          <Tab id="categories">Categories</Tab>
          <Tab id="payees">Payees</Tab>
        </TabList>
        <TabPanel id="overview">Overview panel</TabPanel>
        <TabPanel id="categories">Categories panel</TabPanel>
        <TabPanel id="payees">Payees panel</TabPanel>
      </Tabs>,
    )

    await user.tab()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(
      screen.getByRole('tab', { name: 'Payees' }),
    )
  })
})
