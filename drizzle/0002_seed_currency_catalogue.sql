-- Seeds the global `currencies` catalogue.
--
-- A data migration rather than a schema one, produced with `drizzle-kit generate --custom` so the
-- journal owns it like any other. It exists because `organization_currencies.currency_code` is a
-- foreign key onto this table: until it has rows, a workspace cannot hold a base currency, and
-- without a base currency no `ref_amount_minor` can be written and no account can be created. An
-- empty catalogue is therefore not a cosmetic gap, it is a dead product.
--
-- The values are the projection of `src/lib/money/currencies.ts`, which stays the single source of
-- truth for `digits` because the browser needs it too. `INSERT OR IGNORE` leaves `is_disabled`
-- alone on any row an admin has already hidden — hidden, never deleted, because accounts and
-- historical transactions denominated in a currency must keep formatting correctly forever.
insert or ignore into `currencies` (`code`, `name`, `digits`, `numeric_code`, `is_disabled`) values
  ('PLN', 'Polish złoty', 2, 985, 0),
  ('EUR', 'Euro', 2, 978, 0),
  ('USD', 'US dollar', 2, 840, 0),
  ('GBP', 'Pound sterling', 2, 826, 0),
  ('CHF', 'Swiss franc', 2, 756, 0),
  ('CZK', 'Czech koruna', 2, 203, 0),
  ('SEK', 'Swedish krona', 2, 752, 0),
  ('NOK', 'Norwegian krone', 2, 578, 0),
  ('DKK', 'Danish krone', 2, 208, 0),
  ('HUF', 'Hungarian forint', 2, 348, 0),
  ('UAH', 'Ukrainian hryvnia', 2, 980, 0),
  ('RON', 'Romanian leu', 2, 946, 0),
  ('BGN', 'Bulgarian lev', 2, 975, 0),
  ('ISK', 'Icelandic króna', 0, 352, 0),
  ('RSD', 'Serbian dinar', 2, 941, 0),
  ('BAM', 'Bosnia-Herzegovina convertible mark', 2, 977, 0),
  ('MKD', 'Macedonian denar', 2, 807, 0),
  ('ALL', 'Albanian lek', 2, 8, 0),
  ('MDL', 'Moldovan leu', 2, 498, 0),
  ('GEL', 'Georgian lari', 2, 981, 0),
  ('BYN', 'Belarusian rouble', 2, 933, 0),
  ('RUB', 'Russian rouble', 2, 643, 0),
  ('TRY', 'Turkish lira', 2, 949, 0),
  ('CAD', 'Canadian dollar', 2, 124, 0),
  ('AUD', 'Australian dollar', 2, 36, 0),
  ('NZD', 'New Zealand dollar', 2, 554, 0),
  ('JPY', 'Japanese yen', 0, 392, 0),
  ('CNY', 'Chinese yuan', 2, 156, 0),
  ('HKD', 'Hong Kong dollar', 2, 344, 0),
  ('SGD', 'Singapore dollar', 2, 702, 0),
  ('KRW', 'South Korean won', 0, 410, 0),
  ('INR', 'Indian rupee', 2, 356, 0),
  ('IDR', 'Indonesian rupiah', 2, 360, 0),
  ('MYR', 'Malaysian ringgit', 2, 458, 0),
  ('THB', 'Thai baht', 2, 764, 0),
  ('VND', 'Vietnamese dong', 0, 704, 0),
  ('PHP', 'Philippine peso', 2, 608, 0),
  ('ILS', 'Israeli new shekel', 2, 376, 0),
  ('AED', 'UAE dirham', 2, 784, 0),
  ('SAR', 'Saudi riyal', 2, 682, 0),
  ('QAR', 'Qatari riyal', 2, 634, 0),
  ('KWD', 'Kuwaiti dinar', 3, 414, 0),
  ('BHD', 'Bahraini dinar', 3, 48, 0),
  ('OMR', 'Omani rial', 3, 512, 0),
  ('JOD', 'Jordanian dinar', 3, 400, 0),
  ('TND', 'Tunisian dinar', 3, 788, 0),
  ('MAD', 'Moroccan dirham', 2, 504, 0),
  ('EGP', 'Egyptian pound', 2, 818, 0),
  ('ZAR', 'South African rand', 2, 710, 0),
  ('BRL', 'Brazilian real', 2, 986, 0),
  ('MXN', 'Mexican peso', 2, 484, 0),
  ('ARS', 'Argentine peso', 2, 32, 0),
  ('CLP', 'Chilean peso', 0, 152, 0),
  ('COP', 'Colombian peso', 2, 170, 0),
  ('PEN', 'Peruvian sol', 2, 604, 0),
  ('UYU', 'Uruguayan peso', 2, 858, 0)
;
