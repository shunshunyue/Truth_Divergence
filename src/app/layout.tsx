import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "真相偏差",
  description: "AI 驱动的沉浸式推理游戏框架。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
