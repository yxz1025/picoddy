import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { tokens } from "./store/appStore";
import App from "./App.tsx";

// 注入设计变量
const styleEl = document.createElement("style");
styleEl.textContent = tokens;
document.head.appendChild(styleEl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
