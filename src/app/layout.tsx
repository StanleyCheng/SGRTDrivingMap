import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Archivo, Instrument_Serif } from "next/font/google";
import { I18nProvider } from "@/components/i18n-provider";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SG Real-Time Traffic Info",
  description:
    "Live map of Singapore red-light cameras, speed enforcement cameras and LTA traffic snapshot cameras — official government open data, bilingual EN/繁中.",
  applicationName: "SG Real-Time Traffic Info",
  appleWebApp: { title: "SG Traffic Info" },
};

export const viewport: Viewport = {
  themeColor: "#dceee4",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-mode={process.env.NEXT_PUBLIC_STATIC_MODE === "1" ? "static" : "server"}
      className={`${archivo.variable} ${instrument.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
