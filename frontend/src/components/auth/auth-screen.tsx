"use client";

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  LockKeyholeIcon,
  UserRoundPlusIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FlickeringGrid } from "@/components/ui/flickering-grid";
import Galaxy from "@/components/ui/galaxy";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { login, register } from "@/core/auth/api";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type AuthTab = "login" | "register";

export function AuthScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const queryMode = searchParams.get("mode") === "register" ? "register" : "login";

  const [activeTab, setActiveTab] = useState<AuthTab>(queryMode);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoginLoading, setIsLoginLoading] = useState(false);

  const [registerName, setRegisterName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [isRegisterLoading, setIsRegisterLoading] = useState(false);

  useEffect(() => {
    setActiveTab(queryMode);
  }, [queryMode]);

  function updateTab(value: string) {
    const nextTab: AuthTab = value === "register" ? "register" : "login";
    setActiveTab(nextTab);
    setLoginError(null);
    setRegisterError(null);
    router.replace(nextTab === "register" ? "/login?mode=register" : "/login");
  }

  async function handleLoginSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoginError(null);
    setIsLoginLoading(true);
    try {
      await login(loginEmail, loginPassword);
      router.push("/workspace");
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : t.auth.loginFailed);
    } finally {
      setIsLoginLoading(false);
    }
  }

  async function handleRegisterSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRegisterError(null);
    if (registerPassword !== confirmPassword) {
      setRegisterError(t.auth.passwordMismatchError);
      return;
    }
    if (registerPassword.length < 8) {
      setRegisterError(t.auth.passwordTooShortError);
      return;
    }

    setIsRegisterLoading(true);
    try {
      await register(registerEmail, registerPassword, registerName);
      router.push("/workspace");
    } catch (err) {
      setRegisterError(
        err instanceof Error ? err.message : t.auth.registrationFailed,
      );
    } finally {
      setIsRegisterLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04060b] text-white">
      <div className="absolute inset-0 z-0 bg-black/30">
        <Galaxy
          mouseRepulsion={false}
          starSpeed={0.15}
          density={0.45}
          glowIntensity={0.25}
          twinkleIntensity={0.28}
          speed={0.45}
        />
      </div>
      <FlickeringGrid
        className="absolute inset-0 z-0 opacity-30"
        squareSize={4}
        gridGap={5}
        color="#8cc6ff"
        maxOpacity={0.22}
        flickerChance={0.22}
      />
      <div className="absolute inset-0 z-0 bg-[radial-gradient(120%_120%_at_80%_0%,rgba(109,141,255,0.24)_0%,rgba(4,6,11,0)_55%),radial-gradient(120%_120%_at_0%_100%,rgba(25,211,178,0.2)_0%,rgba(4,6,11,0)_48%)]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl items-center px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid w-full gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden rounded-3xl border border-white/15 bg-black/35 p-8 backdrop-blur-md lg:flex lg:flex-col lg:justify-between">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-cyan-300/10 px-3 py-1 text-xs font-medium tracking-[0.18em] text-cyan-100 uppercase">
                OpenAgents
              </p>
              <h1 className="mt-6 text-4xl leading-tight font-semibold text-white">
                {t.auth.heroTitle}
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/70">
                {t.auth.heroDescription}
              </p>
            </div>

            <ul className="space-y-4 text-sm text-white/80">
              {[
                t.auth.heroFeatureThreads,
                t.auth.heroFeatureSkills,
                t.auth.heroFeatureJwt,
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-cyan-200" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-3xl border border-white/15 bg-[#0d1322]/82 p-6 shadow-[0_24px_80px_rgba(3,8,18,0.65)] backdrop-blur-md sm:p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <Link href="/" className="text-3xl font-semibold tracking-tight">
                  OpenAgents
                </Link>
                <p className="mt-2 text-sm text-white/60">
                  {t.auth.panelSubtitle}
                </p>
              </div>
              <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-100">
                {t.auth.badge}
              </span>
            </div>

            <Tabs value={activeTab} onValueChange={updateTab}>
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl bg-white/5 p-1">
                <TabsTrigger
                  value="login"
                  className={cn(
                    "h-9 rounded-lg text-white/70",
                    "data-[state=active]:border-white/20 data-[state=active]:bg-white/10 data-[state=active]:text-white",
                  )}
                >
                  <LockKeyholeIcon className="size-4" />
                  {t.auth.signInTab}
                </TabsTrigger>
                <TabsTrigger
                  value="register"
                  className={cn(
                    "h-9 rounded-lg text-white/70",
                    "data-[state=active]:border-white/20 data-[state=active]:bg-white/10 data-[state=active]:text-white",
                  )}
                >
                  <UserRoundPlusIcon className="size-4" />
                  {t.auth.registerTab}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="login" className="mt-6">
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  {loginError && (
                    <div className="rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-sm text-red-100">
                      {loginError}
                    </div>
                  )}

                  <div>
                    <label htmlFor="login-email" className="mb-2 block text-sm text-white/75">
                      {t.auth.emailLabel}
                    </label>
                    <Input
                      id="login-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder={t.auth.loginEmailPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="login-password"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.passwordLabel}
                    </label>
                    <Input
                      id="login-password"
                      type="password"
                      autoComplete="current-password"
                      required
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder={t.auth.loginPasswordPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isLoginLoading}
                    className="mt-2 h-11 w-full rounded-lg bg-white text-black hover:bg-white/90"
                  >
                    {isLoginLoading ? t.auth.signingIn : t.auth.signInAction}
                    <ArrowRightIcon className="size-4" />
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-white/60">
                  {t.auth.newHere}{" "}
                  <button
                    type="button"
                    onClick={() => updateTab("register")}
                    className="cursor-pointer font-medium text-cyan-200 hover:text-cyan-100"
                  >
                    {t.auth.createAccountLink}
                  </button>
                </p>
              </TabsContent>

              <TabsContent value="register" className="mt-6">
                <form onSubmit={handleRegisterSubmit} className="space-y-4">
                  {registerError && (
                    <div className="rounded-lg border border-red-300/30 bg-red-300/10 px-3 py-2 text-sm text-red-100">
                      {registerError}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="register-name"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.nameLabel}
                    </label>
                    <Input
                      id="register-name"
                      type="text"
                      autoComplete="name"
                      required
                      value={registerName}
                      onChange={(e) => setRegisterName(e.target.value)}
                      placeholder={t.auth.registerNamePlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="register-email"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.emailLabel}
                    </label>
                    <Input
                      id="register-email"
                      type="email"
                      autoComplete="email"
                      required
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      placeholder={t.auth.registerEmailPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="register-password"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.passwordLabel}
                    </label>
                    <Input
                      id="register-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      placeholder={t.auth.registerPasswordPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="confirm-password"
                      className="mb-2 block text-sm text-white/75"
                    >
                      {t.auth.confirmPasswordLabel}
                    </label>
                    <Input
                      id="confirm-password"
                      type="password"
                      autoComplete="new-password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={t.auth.confirmPasswordPlaceholder}
                      className="h-11 rounded-lg border-white/20 bg-white/5 text-white placeholder:text-white/40 focus-visible:border-white/35 focus-visible:ring-white/20"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={isRegisterLoading}
                    className="mt-2 h-11 w-full rounded-lg bg-cyan-300 text-[#041422] hover:bg-cyan-200"
                  >
                    {isRegisterLoading
                      ? t.auth.creatingAccount
                      : t.auth.createAccountAction}
                    <ArrowRightIcon className="size-4" />
                  </Button>
                </form>

                <p className="mt-4 text-center text-sm text-white/60">
                  {t.auth.alreadyHaveAccount}{" "}
                  <button
                    type="button"
                    onClick={() => updateTab("login")}
                    className="cursor-pointer font-medium text-cyan-200 hover:text-cyan-100"
                  >
                    {t.auth.signInLink}
                  </button>
                </p>
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>
    </div>
  );
}
