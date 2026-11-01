import { createRoot } from 'react-dom/client'

import '#/styles/app.css'
import { Button } from '#/components/ui/button'
import {
  Menu,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  SubmenuTrigger,
} from '#/components/ui/menu'
import { Popover } from '#/components/ui/popover'

/**
 * An eight-item row menu with a submenu, the shape of the groups screen's (#701): one more item
 * than a 320px cap fits at the 44px row height, and the destructive one is last.
 */
function Harness() {
  return (
    <main className="p-3">
      <MenuTrigger>
        <Button>Actions</Button>
        <Popover>
          <Menu aria-label="Group actions">
            <MenuItem id="open">Open</MenuItem>
            <MenuItem id="rename">Rename</MenuItem>
            <SubmenuTrigger>
              <MenuItem id="move" hasSubmenu>
                Move to
              </MenuItem>
              <Popover>
                <Menu aria-label="Move to">
                  <MenuItem id="inbox">Inbox</MenuItem>
                  <MenuItem id="archive">Archive</MenuItem>
                </Menu>
              </Popover>
            </SubmenuTrigger>
            <MenuItem id="duplicate">Duplicate</MenuItem>
            <MenuItem id="merge">Merge</MenuItem>
            <MenuItem id="export">Export</MenuItem>
            <MenuSeparator />
            <MenuItem id="archive-group">Archive group</MenuItem>
            <MenuItem id="delete" isDestructive>
              Delete group
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
    </main>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<Harness />)
  document.body.setAttribute('data-harness-ready', 'true')
}
