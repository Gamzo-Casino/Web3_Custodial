"use client";

import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import AuthForm from "@/components/AuthForm";

export default function SignupPage() {
  const router = useRouter();

  async function handleSignup(data: Record<string, string>) {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        password: data.password,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      const errVal = json.error;
      if (typeof errVal === "string") return errVal;
      // Zod field errors
      const msgs = Object.values(errVal as Record<string, string[]>)
        .flat()
        .join(". ");
      return msgs || "Signup failed.";
    }

    // Auto sign-in after successful signup
    await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });

    router.push("/dashboard");
    router.refresh();
    return null;
  }

  return (
    <AuthForm
      title="Create account"
      subtitle={`Sign up and get 1,000 free credits`}
      fields={[
        { name: "name", label: "Display Name", type: "text", placeholder: "Lucky Player" },
        { name: "email", label: "Email", type: "email", placeholder: "you@example.com" },
        { name: "password", label: "Password", type: "password", placeholder: "Min 8 characters", minLength: 8 },
      ]}
      submitLabel="Create Account"
      footerText="Already have an account?"
      footerLinkHref="/login"
      footerLinkLabel="Sign in"
      onSubmit={handleSignup}
    />
  );
}
