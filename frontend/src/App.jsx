import { HashRouter, Routes, Route } from "react-router-dom"
import { ThemeProvider } from "@/components/ThemeProvider"
import { ScrapeProvider } from "@/contexts/ScrapeContext"
import { Toaster } from "sonner"
import Layout from "./Layout"
import Dashboard from "@/pages/Dashboard"
import ScrapePage from "@/pages/ScrapePage"
import HistoryPage from "@/pages/HistoryPage"
import FilesPage from "@/pages/FilesPage"
import SettingsPage from "@/pages/SettingsPage"

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <ScrapeProvider>
        <HashRouter>
          <Toaster
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              style: { fontFamily: "inherit" },
              duration: 5000,
            }}
          />
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<Dashboard />} />
              <Route path="scrape" element={<ScrapePage />} />
              <Route path="history" element={<HistoryPage />} />
              <Route path="files" element={<FilesPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </HashRouter>
      </ScrapeProvider>
    </ThemeProvider>
  )
}

export default App
