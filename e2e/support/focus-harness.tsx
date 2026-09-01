import { createRoot } from 'react-dom/client'

import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Modal,
} from '#/components/ui/dialog'
import { Menu, MenuItem, MenuTrigger } from '#/components/ui/menu'
import { Popover } from '#/components/ui/popover'
import { Select, SelectItem } from '#/components/ui/select'

function Harness() {
  return (
    <main>
      <MenuTrigger>
        <Button>Actions</Button>
        <Popover>
          <Menu aria-label="Transaction actions">
            <MenuItem id="edit">Edit</MenuItem>
            <MenuItem id="duplicate">Duplicate</MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>

      <Select label="Account" placeholder="Pick one">
        <SelectItem id="cash">Cash</SelectItem>
        <SelectItem id="card">Card</SelectItem>
      </Select>

      <DialogTrigger>
        <Button>Open</Button>
        <Modal isDismissable>
          <Dialog>
            {({ close }) => (
              <>
                <DialogHeader title="Delete transaction" onClose={close} />
                <DialogBody>
                  <button type="button">Inside</button>
                </DialogBody>
                <DialogFooter>
                  <Button onPress={close}>Cancel</Button>
                </DialogFooter>
              </>
            )}
          </Dialog>
        </Modal>
      </DialogTrigger>
    </main>
  )
}

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<Harness />)
  document.body.setAttribute('data-harness-ready', 'true')
}
