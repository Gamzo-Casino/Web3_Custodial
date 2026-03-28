"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import AuthForm from "@/components/AuthForm";

export default function LoginPage() {
  const router = useRouter();

  async function handleLogin(data: Record<string, string>) {
    const result = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });

    if (result?.error) {
      if (result.error.includes("Too many")) return result.error;
      return "Invalid email or password.";
    }

    router.push("/dashboard");
    router.refresh();
    return null;
  }

  return (
    <AuthForm
      title="Welcome back"
      subtitle="Sign in to your Gamzo account"
      fields={[
        { name: "email", label: "Email", type: "email", placeholder: "you@example.com" },
        { name: "password", label: "Password", type: "password", placeholder: "••••••••", minLength: 8 },
      ]}
      submitLabel="Sign In"
      footerText="Don't have an account?"
      footerLinkHref="/signup"
      footerLinkLabel="Sign up"
      onSubmit={handleLogin}
    />
  );
}
