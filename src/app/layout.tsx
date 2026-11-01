import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "创业立项赛博沙盘 | Cloud-Native 3D Situational Awareness & Copilot",
  description: "多 Agent 协同的创业立项压力测试台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-cyan-500/30">
        {children}
      </body>
    </html>
  );
}
