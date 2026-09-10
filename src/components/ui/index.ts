/**
 * The design-system barrel.
 *
 * ## Two rules this directory never breaks
 *
 * 1. **Nothing here fetches data.** No `useQuery`, no server function, no
 *    `fetch`. A primitive that loads its own options cannot be rendered in a
 *    test, in a story, or on a marketing page, and it turns a design review
 *    into an integration test.
 * 2. **Nothing here imports from `src/server`.** Not even a type. The Worker
 *    bundle and the browser bundle share this directory, and one accidental
 *    type import from a module that also has a runtime side is how a D1 binding
 *    ends up in the client graph.
 *
 * Anything that needs data takes it as a prop, and the composition happens in
 * `src/components/app` or in a route.
 */

export { Avatar, AvatarGroup, avatarVariants } from './avatar'
export type { AvatarProps, AvatarGroupProps } from './avatar'

export { Badge, badgeVariants } from './badge'
export type { BadgeProps } from './badge'

export { Breadcrumb, Breadcrumbs } from './breadcrumbs'
export type { BreadcrumbProps, BreadcrumbsProps } from './breadcrumbs'

export { Button, buttonVariants } from './button'
export type { ButtonProps, ButtonSize, ButtonVariant } from './button'

export { Calendar, RangeCalendar } from './calendar'
export type { CalendarProps, RangeCalendarProps } from './calendar'

export { Card, CardBody, CardFooter, CardHeader, cardVariants } from './card'
export type { CardProps, CardHeaderProps } from './card'

export { Checkbox, CheckboxGroup } from './checkbox'
export type { CheckboxProps, CheckboxGroupProps } from './checkbox'

export { ComboBox, ComboBoxItem, ComboBoxSection } from './combobox'
export type { ComboBoxProps } from './combobox'

export { DateInput, DatePicker, DateRangePicker } from './date-picker'
export type { DatePickerProps, DateRangePickerProps } from './date-picker'

export {
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Modal,
} from './dialog'
export type { DialogProps, DialogHeaderProps, ModalProps } from './dialog'

export { Accordion, Disclosure, DisclosurePanel } from './disclosure'
export type { AccordionProps, DisclosureProps } from './disclosure'

export {
  Drawer,
  DrawerBody,
  DrawerDialog,
  DrawerFooter,
  DrawerHeader,
  DrawerTrigger,
} from './drawer'
export type { DrawerProps } from './drawer'

export { EmptyState } from './empty-state'
export type { EmptyStateProps } from './empty-state'

export { Description, FieldError, FieldGroup, Label, fieldRow } from './field'
export type {
  DescriptionProps,
  FieldErrorProps,
  FieldGroupProps,
  LabelProps,
} from './field'

export { Form, FormActions, FormSection } from './form'
export type { FormProps, FormSectionProps } from './form'

export { GridList, GridListItem, GridListMoveButton } from './grid-list'
export type { GridListProps, GridListItemProps } from './grid-list'

export { Link, linkVariants } from './link'
export type { LinkProps } from './link'

export { ListBox, ListBoxItem, ListBoxSection } from './list-box'
export type { ListBoxProps, ListBoxItemProps } from './list-box'

export {
  Menu,
  MenuItem,
  MenuSection,
  MenuSeparator,
  MenuTrigger,
  SubmenuTrigger,
} from './menu'
export type { MenuProps, MenuItemProps } from './menu'

export { Meter } from './meter'
export type { MeterProps } from './meter'

export { NumberField } from './number-field'
export type { NumberFieldProps } from './number-field'

export { Popover, PopoverDialog, PopoverTrigger } from './popover'
export type { PopoverProps, PopoverDialogProps } from './popover'

export { ProgressBar } from './progress-bar'
export type { ProgressBarProps } from './progress-bar'

export { Radio, RadioGroup } from './radio-group'
export type { RadioProps, RadioGroupProps } from './radio-group'

export { SearchField } from './search-field'
export type { SearchFieldProps } from './search-field'

export { Select, SelectItem, SelectSection } from './select'
export type { SelectProps } from './select'

export { Separator } from './separator'
export type { SeparatorProps } from './separator'

export { Skeleton } from './skeleton'
export type { SkeletonProps } from './skeleton'

export { Slider } from './slider'
export type { SliderProps } from './slider'

export { Spinner } from './spinner'
export type { SpinnerProps } from './spinner'

export { Switch } from './switch'
export type { SwitchProps } from './switch'

export {
  Cell,
  Column,
  Row,
  Table,
  TableBody,
  TableContainer,
  TableEmptyState,
  TableHeader,
} from './table'
export type { CellProps, ColumnProps, RowProps, TableProps } from './table'

export { Tab, TabList, TabPanel, Tabs } from './tabs'
export type { TabProps, TabListProps, TabPanelProps, TabsProps } from './tabs'

export { Input, TextField } from './text-field'
export type {
  InputProps,
  TextFieldProps,
  FieldErrorMessage,
} from './text-field'

export { TextArea, TextAreaField } from './textarea'
export type { TextAreaProps, TextAreaFieldProps } from './textarea'

export { ToastHost, toast } from './toast'
export type { ToastHostProps } from './toast'

export { Toolbar, ToolbarSeparator } from './toolbar'
export type { ToolbarProps } from './toolbar'

export { Tooltip, TooltipTrigger } from './tooltip'
export type { TooltipProps } from './tooltip'

export {
  collectionItemBase,
  composeTw,
  disabledLabelled,
  disabledPlain,
  fieldSizes,
  fieldSurface,
  focusRing,
  focusRingInset,
  focusRingWithin,
  iconBoxes,
  iconSizes,
  layerSurface,
  rowWash,
  rowWashSecondary,
  transitionBase,
  transitionSlow,
} from './shared'
export type { FieldSize } from './shared'
