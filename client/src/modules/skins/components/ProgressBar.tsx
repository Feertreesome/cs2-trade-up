import React from "react";

export default function ProgressBar({ text }: { text: string }) {
  return (
    <div
      className="small"
      style={{ marginTop: 8, display: "flex", alignItems: "center" }}
    >
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}
