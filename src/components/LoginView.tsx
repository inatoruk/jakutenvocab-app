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
      <div className="w-full max-w-md bg-white dark:bg-gray-900 border border-gray-200/80 dark:border-gray-800/80 rounded-3xl shadow-xl p-8 space-y-8 animate-slide-up">
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
              <svg className="w-5 h-5" viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
                <g transform="matrix(1, 0, 0, 1, 0, 0)">
                  <path d="M21.35,11.1H12v2.7h5.38C17,15.12,15.65,16,14,16.51V18.3h2.38c2.39-2.2,3.77-5.44,3.77-9.3A8.44,8.44,0,0,0,21.35,11.1Z" fill="#4285f4" />
                  <path d="M12,20.5a8.21,8.21,0,0,0,5.7-2.1L15.32,16.6a5.1,5.1,0,0,1-7.82-2.7H5.06v1.92A8.5,8.5,0,0,0,12,20.5Z" fill="#34a853" />
                  <path d="M7.5,13.9a5.15,5.15,0,0,1,0-3.3V8.68H5.06a8.5,8.5,0,0,0,0,6.64Z" fill="#fbbc05" />
                  <path d="M12,6.75a4.7,4.7,0,0,1,3.31,1.3l2.47-2.47A8.25,8.25,0,0,0,12,3.5a8.5,8.5,0,0,0-6.94,3.58L7.5,9A5.1,5.1,0,0,1,12,6.75Z" fill="#ea4335" />
                </g>
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
