import React from "react";
import { EXTERIORS, type AggGroup } from "../services";

const fmt = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

export default function AggTable({ skins }: { skins: AggGroup[] }) {
  return (
    <table className="table" style={{ marginTop: 8 }}>
      <thead>
      <tr>
        <th style={{textAlign:'left'}}>Skin</th>
        <th style={{textAlign:'left'}}>Exterior</th>
        <th>Listings</th>
        <th>Price</th>
      </tr>
      </thead>
      <tbody>
      {skins.map((g) =>
        g.exteriors
          .sort((a,b) => EXTERIORS.indexOf(a.exterior) - EXTERIORS.indexOf(b.exterior))
          .map((e, i) => (
            <tr key={`${g.baseName}-${e.exterior}-${i}`}>
              <td>{g.baseName}</td>
              <td>{e.exterior}</td>
              <td>{e.sell_listings}</td>
              <td>{fmt(e.price)}</td>
            </tr>
          ))
      )}
      </tbody>
    </table>
  );
}
