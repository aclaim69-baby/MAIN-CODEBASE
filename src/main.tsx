import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ToastProvider, GlobalToastRenderer } from "./lib/toastContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/*
      ToastProvider wraps everything so ANY component can call useGlobalToast().
      GlobalToastRenderer is a sibling of <App> — it is NEVER unmounted by any
      page or step transition inside App, guaranteeing the toast stays visible.
    */}
    <ToastProvider>
      <App />
      <GlobalToastRenderer />
    </ToastProvider>
  </StrictMode>
);
