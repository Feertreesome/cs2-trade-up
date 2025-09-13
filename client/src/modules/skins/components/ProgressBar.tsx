import React from "react";

export default function ProgressBar({ text }: { text: string }) {
  return (
    <div className="small" style={{ marginTop: 8 }}>
      {text}
    </div>
  );
}
