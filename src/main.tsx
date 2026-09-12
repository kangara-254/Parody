import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { initSentry, SentryErrorBoundary } from "./lib/sentry";
import "./styles.css";

initSentry();

function ErrorFallback() {
  return (
    <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
      <h1>Something went wrong.</h1>
      <p>The error has been reported automatically. Please refresh the page.</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </SentryErrorBoundary>
  </StrictMode>
);
