import {
  Baby,
  Book,
  Briefcase,
  Bus,
  Car,
  Coffee,
  Coins,
  Dog,
  Dumbbell,
  Film,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  House,
  Landmark,
  Music,
  PiggyBank,
  Plane,
  Plug,
  Receipt,
  Scissors,
  Shield,
  Shirt,
  ShoppingCart,
  Smartphone,
  Tag,
  TrendingUp,
  Utensils,
  Wifi,
  Wrench,
} from 'lucide-react'

import { CATEGORY_ICON_NAMES } from './icon-names'

import type { ComponentType } from 'react'
import type { CategoryIconName } from './icon-names'

/**
 * The glyph behind each icon name.
 *
 * `Record<CategoryIconName, …>` is the whole point: adding a name to `./icon-names` without adding
 * its glyph here is a compile error, and a `lucide-react` release that renames an export breaks
 * this file rather than rendering a blank square in somebody's category list.
 */
const GLYPHS: Record<
  CategoryIconName,
  ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
> = {
  'shopping-cart': ShoppingCart,
  utensils: Utensils,
  house: House,
  car: Car,
  bus: Bus,
  fuel: Fuel,
  'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap,
  shirt: Shirt,
  gift: Gift,
  plane: Plane,
  dumbbell: Dumbbell,
  film: Film,
  music: Music,
  book: Book,
  baby: Baby,
  dog: Dog,
  wrench: Wrench,
  plug: Plug,
  wifi: Wifi,
  smartphone: Smartphone,
  briefcase: Briefcase,
  'piggy-bank': PiggyBank,
  landmark: Landmark,
  receipt: Receipt,
  coins: Coins,
  'trending-up': TrendingUp,
  shield: Shield,
  scissors: Scissors,
  coffee: Coffee,
}

export { CATEGORY_ICON_NAMES }
export type { CategoryIconName }

export interface CategoryIconProps {
  /** A stored icon name, or `null` for a category that has never been given one. */
  readonly name: string | null
  readonly className?: string
}

/**
 * A category's glyph — always decorative.
 *
 * `aria-hidden`, without exception: the category's **name** is the accessible label everywhere
 * this appears, and an icon that also announced itself would make every row read its subject
 * twice. An unknown stored name falls back to a neutral tag rather than rendering nothing, so a
 * row never collapses by a few pixels because of a value the catalogue no longer knows.
 */
export function CategoryIcon({ name, className }: CategoryIconProps) {
  const Glyph =
    name !== null && Object.hasOwn(GLYPHS, name)
      ? GLYPHS[name as CategoryIconName]
      : Tag
  return <Glyph className={className} aria-hidden />
}
