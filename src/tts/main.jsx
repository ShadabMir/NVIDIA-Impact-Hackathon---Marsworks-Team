import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TtsDemo from "./TtsDemo";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <TtsDemo />
  </StrictMode>,
);
