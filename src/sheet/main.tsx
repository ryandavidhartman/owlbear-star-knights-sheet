import React from "react";
import ReactDOM from "react-dom/client";
import { PluginGate } from "../shared/PluginGate";
import { CharacterSheet } from "./CharacterSheet";
import "./CharacterSheet.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PluginGate>
      <CharacterSheet />
    </PluginGate>
  </React.StrictMode>
);
