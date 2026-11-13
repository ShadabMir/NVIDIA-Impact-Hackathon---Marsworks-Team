import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./agent.css";
import AgentApp from "./AgentApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AgentApp />
  </StrictMode>,
);
