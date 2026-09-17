"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", background: "#f5f6f8", color: "#17191d", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0 }}>
        <main style={{ maxWidth: 440, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 28 }}>Proofwork is temporarily unavailable</h1>
          <p style={{ color: "#5d6470" }}>Nothing was changed. Try again in a moment.</p>
          {error.digest ? <p style={{ fontFamily: "monospace", fontSize: 12, color: "#5d6470" }}>Reference {error.digest}</p> : null}
          <button onClick={reset} style={{ marginTop: 16, background: "#3567e8", color: "#fff", border: 0, borderRadius: 7, padding: "10px 18px", fontSize: 15 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
