"use client"; // Error boundaries must be Client Components

// Root layout (app/layout.tsx) дотор гарсан алдааг барих сан хайрцаг.
// Docs (node_modules/next/dist/docs/.../error.md #Global Error): global-error
// нь root layout-ыг бүрэн орлодог тул өөрийн <html>/<body> тэгтэй байх ёстой.
// Метадата/фонт энд ажиллахгүй тул энгийн систем фонтоор гаргана.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="mn">
      <body
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0f",
          color: "#fff",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          padding: "1rem",
        }}
      >
        <div style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: 8 }}>
            Алдаа гарлаа
          </h1>
          <p style={{ fontSize: "0.875rem", opacity: 0.7, marginBottom: 24 }}>
            Уучлаарай, апп ачаалахад алдаа гарлаа. Дахин оролдоно уу.
          </p>
          <button
            type="button"
            onClick={() => unstable_retry()}
            style={{
              background: "#c0392b",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.875rem",
              padding: "10px 20px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
            }}
          >
            Дахин оролдох
          </button>
          {error.digest ? (
            <p style={{ fontSize: "0.7rem", opacity: 0.4, marginTop: 16 }}>
              Код: {error.digest}
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
