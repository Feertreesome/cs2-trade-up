import React from "react";
import { EXTERIORS, type AggGroup } from "../services";
import "./StyleTable.css";

const fmt = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
type SortField = "name" | "price" | "listings";

export default function AggTable({ skins }: { skins: AggGroup[] }) {
  const [field, setField] = React.useState<SortField>("name");
  const [asc, setAsc] = React.useState(true);

  const rows = React.useMemo(() =>
    skins.flatMap((g) =>
      g.exteriors
        .slice()
        .sort((a, b) => EXTERIORS.indexOf(a.exterior) - EXTERIORS.indexOf(b.exterior))
        .map((e) => ({
          baseName: g.baseName,
          exterior: e.exterior,
          sell_listings: e.sell_listings,
          price: e.price,
        })),
    ),
  [skins]);

  const sorted = React.useMemo(() => {
    return [...rows].sort((a, b) => {
      let res = 0;
      if (field === "name") res = a.baseName.localeCompare(b.baseName);
      if (field === "price") res = (a.price ?? 0) - (b.price ?? 0);
      if (field === "listings") res = a.sell_listings - b.sell_listings;
      return asc ? res : -res;
    });
  }, [rows, field, asc]);

  const handle = (f: SortField) => {
    if (field === f) setAsc(!asc); else { setField(f); setAsc(true); }
  };
  const arrow = (f: SortField) => field === f ? (asc ? "▲" : "▼") : "";

  return (
    <div className="tableContainer">
      <table className="table table-striped mt-2">
        <thead>
          <tr>
            <th
              className="text-start"
              style={{ cursor: "pointer" }}
              onClick={() => handle("name")}
            >
              Skin {arrow("name")}
            </th>
            <th className="text-start">Exterior</th>
            <th
              style={{ cursor: "pointer" }}
              onClick={() => handle("listings")}
            >
              Listings {arrow("listings")}
            </th>
            <th style={{ cursor: "pointer" }} onClick={() => handle("price")}>
              Price {arrow("price")}
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={`${r.baseName}-${r.exterior}-${i}`}>
              <td>{r.baseName}</td>
              <td>{r.exterior}</td>
              <td>{r.sell_listings}</td>
              <td>{fmt(r.price)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
