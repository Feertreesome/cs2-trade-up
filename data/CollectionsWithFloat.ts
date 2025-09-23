export interface CovertFloatRange {
  /** Базовое название скина без указания износа. */
  baseName: string;
  /** Минимальное возможное значение float для данного скина. */
  minFloat: number;
  /** Максимальное возможное значение float для данного скина. */
  maxFloat: number;
}

export interface CollectionFloatCatalogEntry {
  /** Удобный идентификатор коллекции (kebab-case). */
  id: string;
  /** Человекочитаемое название коллекции. */
  name: string;
  /** Список Covert-предметов и их диапазонов float. */
  covert: CovertFloatRange[];
}

/**
 * Минимальный справочник с наиболее популярными коллекциями.
 * В реальном приложении файл должен содержать все актуальные коллекции CS2.
 */
export const COLLECTIONS_WITH_FLOAT: CollectionFloatCatalogEntry[] = [
  {
    id: "the-arms-deal-collection",
    name: "The Arms Deal Collection",
    covert: [
      { baseName: "AK-47 | Case Hardened", minFloat: 0, maxFloat: 1 },
      { baseName: "AWP | Lightning Strike", minFloat: 0, maxFloat: 0.08 },
    ],
  },
  {
    id: "the-huntsman-collection",
    name: "The Huntsman Collection",
    covert: [
      { baseName: "M4A4 | Howl", minFloat: 0, maxFloat: 0.4 },
      { baseName: "AK-47 | Vulcan", minFloat: 0, maxFloat: 0.7 },
    ],
  },
  {
    id: "the-operations-phoenix",
    name: "The Phoenix Collection",
    covert: [
      { baseName: "AWP | Asiimov", minFloat: 0.18, maxFloat: 1 },
      { baseName: "AK-47 | Redline", minFloat: 0.1, maxFloat: 0.7 },
    ],
  },
  {
    id: "the-breakout-collection",
    name: "The Breakout Collection",
    covert: [
      { baseName: "M4A1-S | Cyrex", minFloat: 0, maxFloat: 1 },
      { baseName: "P90 | Asiimov", minFloat: 0, maxFloat: 0.8 },
    ],
  },
];

export const COLLECTIONS_WITH_FLOAT_MAP = new Map(
  COLLECTIONS_WITH_FLOAT.map((entry) => [entry.id, entry] as const),
);
