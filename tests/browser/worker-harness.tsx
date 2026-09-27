// Test-only build entry. Never included in the production application.
import { createRoot } from "react-dom/client";
import { WorkerHarness } from "./WorkerHarness";
createRoot(document.getElementById("root")!).render(<WorkerHarness />);
