import type { Metadata, Viewport } from "next";
import { Outfit, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/context/theme-provider";
import { RoleProvider } from "@/context/role-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

// Outfit everywhere, headings included; Geist Mono for codes (DESIGN.md).
const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LAF Operating System",
  description: "Little Ark Foundation — operations management prototype",
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${outfit.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <RoleProvider>
            <TooltipProvider>
              {children}
              <Toaster />
            </TooltipProvider>
          </RoleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
