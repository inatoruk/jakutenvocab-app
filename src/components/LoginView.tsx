"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import Image from "next/image";
import appIcon from "@/app/icon.png";

export default function LoginView() {
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  async function handleGoogleLogin() {
    try {
      setIsLoggingIn(true);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          // ログイン後のリダイレクト先を現在のオリジン（例: http://localhost:3000）にする
          redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (error) throw error;
    } catch (error: any) {
      alert("ログインに失敗しました: " + (error.message || error));
      setIsLoggingIn(false);
    }
  }

  return (
    <div className="min-h-dvh w-full flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-950 transition-colors duration-300">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800/80 rounded-3xl shadow-xl p-8 space-y-8 animate-zoom-in">
        {/* ロゴ・アプリ情報 */}
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="relative w-24 h-24 overflow-hidden rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800/80">
            <Image src={appIcon} alt="弱点単語集アイコン" fill className="object-cover" />
          </div>
          <div className="space-y-4">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              弱点単語集
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              あなた専用の、弱点特化型単語帳。<br />
              ログインして学習を開始しましょう。
            </p>
          </div>
        </div>

        {/* ログインボタン */}
        <div className="space-y-4 pt-2">
          <button
            onClick={handleGoogleLogin}
            disabled={isLoggingIn}
            className="w-full flex items-center justify-center gap-3 px-5 py-3.5 border border-gray-300 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-semibold text-sm shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700/80 active:bg-gray-100 dark:active:bg-gray-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-md cursor-pointer"
          >
            {isLoggingIn ? (
              <div className="w-5 h-5 border-2 border-gray-500 dark:border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-5 h-5" viewBox="0 0 24 24" version="1.1" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285f4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34a853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#fbbc05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#ea4335" />
              </svg>
            )}
            <span>Google でサインイン</span>
          </button>
        </div>

        {/* フッター */}
        <div className="text-center pt-2">
          <p className="text-xs text-gray-400 dark:text-gray-500">
            ログインすることで、利用規約およびプライバシーポリシーに同意したものとみなされます。
          </p>
        </div>
      </div>
    </div>
  );
}
