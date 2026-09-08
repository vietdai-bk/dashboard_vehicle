import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { getState } from "./stores/store";
import "./styles/global.css";

// Hook debug: gõ __vd.state() trong DevTools để xem store hiện tại (read-only).
declare global {
  interface Window { __vd?: { state: () => unknown } }
}
window.__vd = { state: () => getState() };

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
