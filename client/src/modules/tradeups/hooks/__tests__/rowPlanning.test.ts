import { describe, expect, it } from "vitest";

import type { CollectionInputSummary } from "../../services/api";
import { planRowsForCollection } from "../rowPlanning";

describe("planRowsForCollection", () => {
  it("fills rows with the cheapest input supporting the desired float", () => {
    const inputs: CollectionInputSummary[] = [
      {
        baseName: "Example",
        marketHashName: "Example MW",
        exterior: "Minimal Wear",
        price: 3,
      },
      {
        baseName: "Example",
        marketHashName: "Example FT Budget",
        exterior: "Field-Tested",
        price: 1.5,
      },
      {
        baseName: "Example",
        marketHashName: "Example FT Premium",
        exterior: "Field-Tested",
        price: 2,
      },
    ];

    const { rows, missingNames } = planRowsForCollection({
      collectionTag: "collection",
      collectionId: null,
      selectedCollectionId: null,
      inputs,
      options: {
        target: {
          exterior: "Minimal Wear",
          minFloat: 0,
          maxFloat: 0.8,
        },
      },
    });

    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((row) => row.marketHashName))).toEqual(
      new Set(["Example FT Budget"]),
    );
    rows.forEach((row) => {
      expect(row.float).toBe("0.18750");
      expect(row.collectionId).toBe("steam-tag:collection");
    });
    expect(missingNames).toEqual([]);
  });
});
