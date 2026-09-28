import React from "react";
import { createRoot } from "react-dom/client";
import { WaveSliceApp } from "./ui/WaveSliceApp";
import "./ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WaveSliceApp />
  </React.StrictMode>,
);
