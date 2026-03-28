"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

interface Field {
  name: string;
  label: string;
  type: string;
  placeholder?: string;
  minLength?: number;
}

interface AuthFormProps {
  title: string;
  subtitle: string;
  fields: Field[];
  submitLabel: string;
  footerText: string;
  footerLinkHref: string;
  footerLinkLabel: string;
  onSubmit: (data: Record<string, string>) => Promise<string | null>;
  successMessage?: string;
}

export default function AuthForm({
  title,
  subtitle,
  fields,
  submitLabel,
  footerText,
  footerLinkHref,
  footerLinkLabel,
  onSubmit,
  successMessage,
}: AuthFormProps) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((f) => [f.name, ""]))
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const err = await onSubmit(values);
      if (err) {
        setError(err);
      } else {
        setSuccess(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "calc(100vh - 64px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem 1rem",
      }}
    >
      <div
        className="card"
        style={{ width: "100%", maxWidth: "420px", padding: "2.5rem" }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "2rem" }}>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 800,
              letterSpacing: "-0.5px",
              marginBottom: "0.375rem",
              background: "linear-gradient(135deg, #00ff9d, #00d4ff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            {title}
          </h1>
          <p style={{ color: "#8888aa", fontSize: "0.875rem" }}>{subtitle}</p>
        </div>

        {success && successMessage ? (
          <div
            style={{
              background: "rgba(0,255,157,0.08)",
              border: "1px solid rgba(0,255,157,0.25)",
              borderRadius: "8px",
              padding: "1rem",
              textAlign: "center",
              color: "#00ff9d",
              fontSize: "0.9rem",
            }}
          >
            {successMessage}
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {fields.map((field) => (
              <div key={field.name} style={{ marginBottom: "1rem" }}>
                <label
                  htmlFor={field.name}
                  style={{
                    display: "block",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    color: "#8888aa",
                    marginBottom: "0.375rem",
                    letterSpacing: "0.03em",
                    textTransform: "uppercase",
                  }}
                >
                  {field.label}
                </label>
                <input
                  id={field.name}
                  type={field.type}
                  placeholder={field.placeholder}
                  minLength={field.minLength}
                  required
                  value={values[field.name]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [field.name]: e.target.value }))
                  }
                  style={{
                    width: "100%",
                    background: "#12122a",
                    border: "1px solid #2a2a50",
                    borderRadius: "8px",
                    padding: "0.625rem 0.875rem",
                    color: "#f0f0ff",
                    fontSize: "0.9375rem",
                    outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "#00ff9d";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "#2a2a50";
                  }}
                />
              </div>
            ))}

            {error && (
              <div
                style={{
                  background: "rgba(255, 80, 80, 0.08)",
                  border: "1px solid rgba(255, 80, 80, 0.3)",
                  borderRadius: "8px",
                  padding: "0.75rem",
                  color: "#ff8080",
                  fontSize: "0.875rem",
                  marginBottom: "1rem",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{
                width: "100%",
                padding: "0.75rem",
                fontSize: "0.9375rem",
                opacity: loading ? 0.7 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Please wait…" : submitLabel}
            </button>
          </form>
        )}

        <p
          style={{
            textAlign: "center",
            marginTop: "1.5rem",
            fontSize: "0.875rem",
            color: "#8888aa",
          }}
        >
          {footerText}{" "}
          <Link
            href={footerLinkHref}
            style={{ color: "#00ff9d", textDecoration: "none", fontWeight: 600 }}
          >
            {footerLinkLabel}
          </Link>
        </p>
      </div>
    </div>
  );
}
