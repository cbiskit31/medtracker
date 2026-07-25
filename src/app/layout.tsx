import type { Metadata } from "next";
import { Quicksand, Inter } from "next/font/google";
import "./globals.css";
import Script from "next/script";

const quicksand = Quicksand({
  variable: "--font-heading",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MedTracker",
  description: "Medication management for you and your family",
  manifest: "/manifest.json",
};

export const viewport = {
  themeColor: "#0d9488",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${quicksand.variable} ${inter.variable} antialiased`}>
        <Script src="https://accounts.google.com/gsi/client" strategy="afterInteractive" />
        {children}
      </body>
    </html>
  );
}