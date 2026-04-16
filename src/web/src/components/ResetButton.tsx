import React, { useState } from "react";

export function ResetButton() {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!window.confirm("Clear every agent from the board?")) return;
    setBusy(true);
    try {
      await fetch("/api/board/clear", { method: "POST" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="rounded border border-neutral-300 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50"
    >
      {busy ? "\u2026" : "Reset board"}
    </button>
  );
}
