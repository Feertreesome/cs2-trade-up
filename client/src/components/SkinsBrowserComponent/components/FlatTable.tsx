import React from "react";
import { parseExterior } from "../services/utils";

type Item = { market_hash_name: string; sell_listings: number; price?: number | null };

export default function FlatTable({ items }: { items: Item[] }) {
  const fmt = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);
  return (
    <table className="table" style={{ marginTop: 8 }}>
      <thead>
      <tr>
        <th style={{textAlign:'left'}}>Market hash name</th>
        <th>Exterior</th>
        <th>Listings</th>
        <th>Price</th>
      </tr>
      </thead>
      <tbody>
      {items.map((x, i) => (
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
