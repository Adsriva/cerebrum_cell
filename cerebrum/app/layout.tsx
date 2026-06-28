import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cerebrum — Stock Idea Notebook",
  description: "Personal stock research notebook with live NSE data, sectoral heatmap, and AI-assisted verdicts.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('cerebrum_theme');if(t==='dark')document.documentElement.classList.add('dark');}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
