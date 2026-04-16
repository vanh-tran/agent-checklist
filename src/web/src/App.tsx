import { useBoard } from "./hooks/useBoard";
import { Board } from "./components/Board";
import { ConnectionIndicator } from "./components/ConnectionIndicator";
import { ResetButton } from "./components/ResetButton";

export default function App() {
  const { board, connected } = useBoard();
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agent Checklist</h1>
          <p className="text-sm text-neutral-500">Live view of every running coding agent.</p>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionIndicator connected={connected} />
          <ResetButton />
        </div>
      </header>
      <Board state={board} />
    </div>
  );
}
