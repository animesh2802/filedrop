import type { Metadata } from "next"
import "./globals.css"
import { StreamSaverInit } from "@/components/StreamSaverInit"

export const metadata: Metadata = {
  title: "FileDrop",
  description: "Fast peer-to-peer file transfers",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen">
        <StreamSaverInit />
        {children}
      </body>
    </html>
  )
}