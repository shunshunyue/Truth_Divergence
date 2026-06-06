import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "今天事真多",
  description: "AI 驱动的沉浸式推理游戏。",
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
