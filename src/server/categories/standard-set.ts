/**
 * The standard category set — typed data, no SQL, no I/O.
 *
 * A generic household-budget taxonomy original to this repository. Plan `26-S1`'s presets import
 * or extend this table and never redefine it. The write that applies it lives in
 * `src/server/repos/categories.ts` (`seedStandardCategories`).
 *
 * Hues are lowercase `#rrggbb` literals of the eight `CATEGORY_HUES`; this file does not import
 * `palette.ts`, which pulls chart encoding into the Worker. The seed tests assert the membership.
 */

import type { CategoryIconName } from '#/components/app/categories/icon-names'
import type { Locale } from '#/lib/i18n'
import type { CategoryKind } from '#/lib/enums'

export interface StandardCategory {
  readonly slug: string
  readonly parentSlug: string | null
  readonly kind: Exclude<CategoryKind, 'both'>
  readonly hue: string
  readonly icon: CategoryIconName
  readonly names: Record<Locale, string>
}

const BLUE = '#0d6abb'
const GREEN = '#0f7b62'
const TEAL = '#0a646a'
const CRIMSON = '#a60d47'
const VIOLET = '#9724b5'
const ORANGE = '#b1440c'
const OLIVE = '#436f0a'
const GOLD = '#625106'

export const STANDARD_CATEGORIES: ReadonlyArray<StandardCategory> = [
  {
    slug: 'housing',
    parentSlug: null,
    kind: 'expense',
    hue: BLUE,
    icon: 'house',
    names: { en: 'Housing', pl: 'Mieszkanie' },
  },
  {
    slug: 'rent',
    parentSlug: 'housing',
    kind: 'expense',
    hue: BLUE,
    icon: 'receipt',
    names: { en: 'Rent or mortgage', pl: 'Czynsz lub rata kredytu' },
  },
  {
    slug: 'utilities',
    parentSlug: 'housing',
    kind: 'expense',
    hue: BLUE,
    icon: 'plug',
    names: { en: 'Utilities', pl: 'Media i opłaty' },
  },
  {
    slug: 'internet-phone',
    parentSlug: 'housing',
    kind: 'expense',
    hue: BLUE,
    icon: 'wifi',
    names: { en: 'Internet and phone', pl: 'Internet i telefon' },
  },
  {
    slug: 'home-maintenance',
    parentSlug: 'housing',
    kind: 'expense',
    hue: BLUE,
    icon: 'wrench',
    names: { en: 'Repairs and upkeep', pl: 'Naprawy i remonty' },
  },
  {
    slug: 'food',
    parentSlug: null,
    kind: 'expense',
    hue: GREEN,
    icon: 'utensils',
    names: { en: 'Food', pl: 'Jedzenie' },
  },
  {
    slug: 'groceries',
    parentSlug: 'food',
    kind: 'expense',
    hue: GREEN,
    icon: 'shopping-cart',
    names: { en: 'Groceries', pl: 'Zakupy spożywcze' },
  },
  {
    slug: 'dining-out',
    parentSlug: 'food',
    kind: 'expense',
    hue: GREEN,
    icon: 'coffee',
    names: { en: 'Restaurants and cafés', pl: 'Restauracje i kawiarnie' },
  },
  {
    slug: 'transport',
    parentSlug: null,
    kind: 'expense',
    hue: TEAL,
    icon: 'car',
    names: { en: 'Transport', pl: 'Transport' },
  },
  {
    slug: 'fuel',
    parentSlug: 'transport',
    kind: 'expense',
    hue: TEAL,
    icon: 'fuel',
    names: { en: 'Fuel', pl: 'Paliwo' },
  },
  {
    slug: 'public-transport',
    parentSlug: 'transport',
    kind: 'expense',
    hue: TEAL,
    icon: 'bus',
    names: { en: 'Public transport', pl: 'Komunikacja miejska' },
  },
  {
    slug: 'car-servicing',
    parentSlug: 'transport',
    kind: 'expense',
    hue: TEAL,
    icon: 'wrench',
    names: { en: 'Car servicing', pl: 'Serwis samochodu' },
  },
  {
    slug: 'health',
    parentSlug: null,
    kind: 'expense',
    hue: CRIMSON,
    icon: 'heart-pulse',
    names: { en: 'Health', pl: 'Zdrowie' },
  },
  {
    slug: 'medical',
    parentSlug: 'health',
    kind: 'expense',
    hue: CRIMSON,
    icon: 'heart-pulse',
    names: { en: 'Doctors and treatment', pl: 'Lekarze i leczenie' },
  },
  {
    slug: 'pharmacy',
    parentSlug: 'health',
    kind: 'expense',
    hue: CRIMSON,
    icon: 'heart-pulse',
    names: { en: 'Pharmacy', pl: 'Apteka' },
  },
  {
    slug: 'shopping',
    parentSlug: null,
    kind: 'expense',
    hue: VIOLET,
    icon: 'shirt',
    names: { en: 'Shopping', pl: 'Zakupy' },
  },
  {
    slug: 'clothing',
    parentSlug: 'shopping',
    kind: 'expense',
    hue: VIOLET,
    icon: 'shirt',
    names: { en: 'Clothing', pl: 'Odzież' },
  },
  {
    slug: 'electronics',
    parentSlug: 'shopping',
    kind: 'expense',
    hue: VIOLET,
    icon: 'smartphone',
    names: { en: 'Electronics', pl: 'Elektronika' },
  },
  {
    slug: 'gifts',
    parentSlug: 'shopping',
    kind: 'expense',
    hue: VIOLET,
    icon: 'gift',
    names: { en: 'Gifts', pl: 'Prezenty' },
  },
  {
    slug: 'leisure',
    parentSlug: null,
    kind: 'expense',
    hue: ORANGE,
    icon: 'film',
    names: { en: 'Leisure', pl: 'Wypoczynek i rozrywka' },
  },
  {
    slug: 'entertainment',
    parentSlug: 'leisure',
    kind: 'expense',
    hue: ORANGE,
    icon: 'music',
    names: { en: 'Entertainment', pl: 'Rozrywka' },
  },
  {
    slug: 'subscriptions',
    parentSlug: 'leisure',
    kind: 'expense',
    hue: ORANGE,
    icon: 'receipt',
    names: { en: 'Subscriptions', pl: 'Subskrypcje' },
  },
  {
    slug: 'sport',
    parentSlug: 'leisure',
    kind: 'expense',
    hue: ORANGE,
    icon: 'dumbbell',
    names: { en: 'Sport', pl: 'Sport' },
  },
  {
    slug: 'travel',
    parentSlug: 'leisure',
    kind: 'expense',
    hue: ORANGE,
    icon: 'plane',
    names: { en: 'Travel', pl: 'Podróże' },
  },
  {
    slug: 'education',
    parentSlug: null,
    kind: 'expense',
    hue: OLIVE,
    icon: 'graduation-cap',
    names: { en: 'Education', pl: 'Edukacja' },
  },
  {
    slug: 'courses',
    parentSlug: 'education',
    kind: 'expense',
    hue: OLIVE,
    icon: 'book',
    names: { en: 'Courses and books', pl: 'Kursy i książki' },
  },
  {
    slug: 'family',
    parentSlug: null,
    kind: 'expense',
    hue: GOLD,
    icon: 'baby',
    names: { en: 'Family and pets', pl: 'Rodzina i zwierzęta' },
  },
  {
    slug: 'children',
    parentSlug: 'family',
    kind: 'expense',
    hue: GOLD,
    icon: 'baby',
    names: { en: 'Children', pl: 'Dzieci' },
  },
  {
    slug: 'pets',
    parentSlug: 'family',
    kind: 'expense',
    hue: GOLD,
    icon: 'dog',
    names: { en: 'Pets', pl: 'Zwierzęta' },
  },
  {
    slug: 'finance',
    parentSlug: null,
    kind: 'expense',
    hue: BLUE,
    icon: 'landmark',
    names: { en: 'Money and fees', pl: 'Finanse i opłaty' },
  },
  {
    slug: 'bank-fees',
    parentSlug: 'finance',
    kind: 'expense',
    hue: BLUE,
    icon: 'coins',
    names: { en: 'Bank fees', pl: 'Opłaty bankowe' },
  },
  {
    slug: 'insurance',
    parentSlug: 'finance',
    kind: 'expense',
    hue: BLUE,
    icon: 'shield',
    names: { en: 'Insurance', pl: 'Ubezpieczenia' },
  },
  {
    slug: 'taxes',
    parentSlug: 'finance',
    kind: 'expense',
    hue: BLUE,
    icon: 'landmark',
    names: { en: 'Taxes', pl: 'Podatki' },
  },
  {
    slug: 'other-expenses',
    parentSlug: null,
    kind: 'expense',
    hue: TEAL,
    icon: 'receipt',
    names: { en: 'Other', pl: 'Inne' },
  },
  {
    slug: 'salary',
    parentSlug: null,
    kind: 'income',
    hue: GREEN,
    icon: 'briefcase',
    names: { en: 'Salary', pl: 'Wynagrodzenie' },
  },
  {
    slug: 'other-income',
    parentSlug: null,
    kind: 'income',
    hue: OLIVE,
    icon: 'coins',
    names: { en: 'Other income', pl: 'Pozostałe przychody' },
  },
]
