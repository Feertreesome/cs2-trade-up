import React from "react";
import { parseExterior } from "../services";

type Item = { market_hash_name: string; sell_listings: number; price?: number | null };
type SortField = "name" | "price" | "listings";

export default function FlatTable({ items }: { items: Item[] }) {
  const [field, setField] = React.useState<SortField>("name");
  const [asc, setAsc] = React.useState(true);

  const fmt = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

  const sorted = React.useMemo(() => {
    return [...items].sort((a, b) => {
      let res = 0;
      if (field === "name") res = a.market_hash_name.localeCompare(b.market_hash_name);
      if (field === "price") res = (a.price ?? 0) - (b.price ?? 0);
      if (field === "listings") res = a.sell_listings - b.sell_listings;
      return asc ? res : -res;
    });
  }, [items, field, asc]);

  const handle = (f: SortField) => {
    if (field === f) setAsc(!asc); else { setField(f); setAsc(true); }
  };
  const arrow = (f: SortField) => field === f ? (asc ? "▲" : "▼") : "";

  return (
    <table className="table table-striped mt-2">
      <thead>
      <tr>
        <th className="text-start" style={{cursor:"pointer"}} onClick={() => handle("name")}>Market hash name {arrow("name")}</th>
        <th className="text-start">Exterior</th>
        <th style={{cursor:"pointer"}} onClick={() => handle("listings")}>Listings {arrow("listings")}</th>
        <th style={{cursor:"pointer"}} onClick={() => handle("price")}>Price {arrow("price")}</th>
      </tr>
      </thead>
      <tbody>
      {sorted.map((x, i) => (
        <tr key={i}>
          <td>{x.market_hash_name}</td>
          <td>{parseExterior(x.market_hash_name)}</td>
          <td>{x.sell_listings}</td>
          <td>{fmt(x.price)}</td>
        </tr>
      ))}
      </tbody>
    </table>
  );
}
